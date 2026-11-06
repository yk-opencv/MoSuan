param([ValidateSet('jdk','sdk','gradle')][string]$Component)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$env:NODE_USE_ENV_PROXY = '1'
$projectRoot = Split-Path -Parent $PSScriptRoot
$toolsRoot = Join-Path $projectRoot '.local\android-tools'
$downloadRoot = Join-Path $toolsRoot 'downloads'
New-Item -ItemType Directory -Force -Path $downloadRoot | Out-Null

function Get-Archive([string]$Url, [string]$Name, [string]$Sha1 = '') {
  if ([IO.Path]::GetFileName($Name) -ne $Name) { throw 'Archive name must be a filename' }
  $archivePath = Join-Path $downloadRoot $Name
  if ($Sha1 -and (Test-Path -LiteralPath $archivePath) -and (Get-FileHash -LiteralPath $archivePath -Algorithm SHA1).Hash.ToLowerInvariant() -ne $Sha1.ToLowerInvariant()) {
    Move-Item -LiteralPath $archivePath -Destination ($archivePath + '.rejected-' + [DateTime]::UtcNow.Ticks) -Force
  }
  if (-not (Test-Path -LiteralPath $archivePath)) {
    Write-Host "Downloading $Name"
    & node (Join-Path $PSScriptRoot 'download-tool.mjs') $Url $archivePath | ForEach-Object { Write-Host $_ }
    if ($LASTEXITCODE -ne 0) { throw "Download failed: $Name" }
  }
  if ($Sha1 -and (Get-FileHash -LiteralPath $archivePath -Algorithm SHA1).Hash.ToLowerInvariant() -ne $Sha1.ToLowerInvariant()) { throw "Checksum mismatch: $Name" }
  return $archivePath
}
if ($Component -eq 'jdk') {
  $jdkTarget = Join-Path $toolsRoot 'jdk'
  if (Test-Path -LiteralPath (Join-Path $jdkTarget 'bin\javac.exe')) { Write-Output 'Local JDK already available'; exit 0 }
  $packages = Invoke-RestMethod -Uri 'https://api.azul.com/metadata/v1/zulu/packages/?java_version=21&os=windows&arch=x86_64&archive_type=zip&java_package_type=jdk&release_status=ga&availability_types=CA&latest=true'
  $jdkPackage = $packages | Where-Object { $_.name -notmatch '-fx-' } | Select-Object -First 1
  $archive = Get-Archive $jdkPackage.download_url $jdkPackage.name
  $staging = Join-Path $toolsRoot 'jdk-extracted'
  Expand-Archive -LiteralPath $archive -DestinationPath $staging -Force
  $jdkSource = Get-ChildItem -LiteralPath $staging -Directory | Select-Object -First 1
  $resolvedSource = [IO.Path]::GetFullPath($jdkSource.FullName)
  $resolvedTarget = [IO.Path]::GetFullPath($jdkTarget)
  if (-not $resolvedSource.StartsWith($toolsRoot + '\') -or -not $resolvedTarget.StartsWith($toolsRoot + '\')) { throw 'Toolchain path escaped workspace' }
  Move-Item -LiteralPath $resolvedSource -Destination $resolvedTarget
  $jdkPackage | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $toolsRoot 'jdk-source.json') -Encoding UTF8
  & (Join-Path $jdkTarget 'bin\java.exe') -version
} elseif ($Component -eq 'sdk') {
  $sdkRoot = Join-Path $toolsRoot 'sdk'
  [xml]$repository = (Invoke-WebRequest -Uri 'https://dl.google.com/android/repository/repository2-3.xml' -UseBasicParsing).Content
  $manifest = @()
  foreach ($packageId in @('platforms;android-36','build-tools;36.0.0','platform-tools')) {
    $package = $repository.SelectSingleNode("//*[local-name()='remotePackage'][@path='$packageId']")
    $archives = @($package.archives.archive)
    $selected = $archives | Where-Object { -not $_.'host-os' -or $_.'host-os' -eq 'windows' } | Select-Object -First 1
    $name = [string]$selected.complete.url
    $hash = [string]$selected.complete.checksum.'#text'
    $destination = Join-Path $sdkRoot ($packageId.Replace(';','\'))
    if (-not (Test-Path -LiteralPath (Join-Path $destination 'source.properties'))) {
      $archive = Get-Archive ('https://dl.google.com/android/repository/' + $name + '?checksum=' + $hash) ($hash.Substring(0,8) + '-' + $name) $hash
      $staging = Join-Path $toolsRoot ('sdk-extracted-' + $packageId.Replace(';','-'))
      Expand-Archive -LiteralPath $archive -DestinationPath $staging -Force
      $source = Get-ChildItem -LiteralPath $staging -Directory | Select-Object -First 1
      $resolvedSource = [IO.Path]::GetFullPath($source.FullName)
      $resolvedTarget = [IO.Path]::GetFullPath($destination)
      if (-not $resolvedSource.StartsWith($toolsRoot + '\') -or -not $resolvedTarget.StartsWith($toolsRoot + '\')) { throw 'Toolchain path escaped workspace' }
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
      Move-Item -LiteralPath $resolvedSource -Destination $resolvedTarget
    }
    $manifest += @{id=$packageId;url=('https://dl.google.com/android/repository/' + $name);sha1=$hash}
  }
  $manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $toolsRoot 'sdk-source.json') -Encoding UTF8
  Write-Output 'Local Android SDK ready (API 36, build-tools 36.0.0, platform-tools)'
} else {
  $gradleTarget = Join-Path $toolsRoot 'gradle'
  if (Test-Path -LiteralPath (Join-Path $gradleTarget 'gradle-8.14.3\bin\gradle.bat')) { Write-Output 'Local Gradle already available'; exit 0 }
  $hashResponse = Invoke-WebRequest -Uri 'https://downloads.gradle.org/distributions/gradle-8.14.3-bin.zip.sha256' -UseBasicParsing
  $expectedHash = if ($hashResponse.Content -is [byte[]]) { [Text.Encoding]::ASCII.GetString($hashResponse.Content).Trim() } else { ([string]$hashResponse.Content).Trim() }
  $gradleArchive = Join-Path $downloadRoot 'gradle-8.14.3-bin.zip'
  $gradleSource = if ($env:MOSUAN_GRADLE_SOURCE) { $env:MOSUAN_GRADLE_SOURCE } else { 'https://downloads.gradle.org/distributions/gradle-8.14.3-bin.zip' }
  if (-not (Test-Path -LiteralPath $gradleArchive)) { & node (Join-Path $PSScriptRoot 'download-tool.mjs') $gradleSource $gradleArchive; if ($LASTEXITCODE -ne 0) { throw 'Gradle download failed' } }
  if ((Get-FileHash -LiteralPath $gradleArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) { throw 'Gradle checksum mismatch' }
  Expand-Archive -LiteralPath $gradleArchive -DestinationPath $gradleTarget -Force
  @{url=$gradleSource;sha256=$expectedHash} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $toolsRoot 'gradle-source.json') -Encoding UTF8
  Write-Output 'Local Gradle 8.14.3 ready (official SHA256 verified)'
}
