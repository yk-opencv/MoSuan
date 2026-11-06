param([switch]$SkipWebBuild, [switch]$RunNativeTests)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$toolsRoot = Join-Path $projectRoot '.local\android-tools'
$env:JAVA_HOME = Join-Path $toolsRoot 'jdk'
$env:ANDROID_HOME = Join-Path $toolsRoot 'sdk'
$env:GRADLE_USER_HOME = Join-Path $toolsRoot 'gradle-cache'
if (-not (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME 'bin\java.exe'))) { throw 'Run scripts/setup-android.ps1 -Component jdk first' }
if (-not (Test-Path -LiteralPath (Join-Path $env:ANDROID_HOME 'platforms\android-36\android.jar'))) { throw 'Run scripts/setup-android.ps1 -Component sdk first' }
if (-not $SkipWebBuild) { & npm.cmd run build; if ($LASTEXITCODE -ne 0) { throw 'Web build failed' } }
& npx.cmd cap sync android
if ($LASTEXITCODE -ne 0) { throw 'Native asset sync failed' }
$signingRoot = Join-Path $projectRoot '.local\android-signing'
New-Item -ItemType Directory -Path $signingRoot -Force | Out-Null
$env:MOSUAN_KEYSTORE = Join-Path $signingRoot 'mosuan-release.p12'
$env:MOSUAN_PASSWORD_FILE = Join-Path $signingRoot 'password'
if (-not (Test-Path -LiteralPath $env:MOSUAN_PASSWORD_FILE)) {
  $random = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($random)
  [IO.File]::WriteAllText($env:MOSUAN_PASSWORD_FILE,[Convert]::ToBase64String($random))
}
if (-not (Test-Path -LiteralPath $env:MOSUAN_KEYSTORE)) {
  & (Join-Path $env:JAVA_HOME 'bin\keytool.exe') -genkeypair -keystore $env:MOSUAN_KEYSTORE -storetype PKCS12 -storepass:file $env:MOSUAN_PASSWORD_FILE -keypass:file $env:MOSUAN_PASSWORD_FILE -alias mosuan -keyalg RSA -keysize 3072 -validity 3650 -dname 'CN=Mosuan Local Build, O=Mosuan, C=CN'
  if ($LASTEXITCODE -ne 0) { throw 'APK signing key creation failed' }
}
$sdkProperty = 'sdk.dir=' + $env:ANDROID_HOME.Replace([char]92, [char]47)
[IO.File]::WriteAllText((Join-Path $projectRoot 'android\local.properties'),$sdkProperty + "`n")
Push-Location -LiteralPath (Join-Path $projectRoot 'android')
try {
  $localGradle = Join-Path $toolsRoot 'gradle\gradle-8.14.3\bin\gradle.bat'
  $gradleArguments = @('--no-daemon','--no-watch-fs','--console=plain','--max-workers=2')
  if ($env:MOSUAN_MAVEN_MIRROR) { $gradleArguments += @('--init-script',(Join-Path $PSScriptRoot 'android-mirror.gradle')) }
  if ($RunNativeTests) { $gradleArguments += ':app:testReleaseUnitTest' }
  $gradleArguments += 'assembleRelease'
  if (Test-Path -LiteralPath $localGradle) { & $localGradle @gradleArguments }
  else { & .\gradlew.bat @gradleArguments }
  if ($LASTEXITCODE -ne 0) { throw 'Android build failed' }
} finally { Pop-Location }
$outputRoot = Join-Path $projectRoot 'artifacts\android'
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
$appVersion = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
$apk = Join-Path $outputRoot ("mosuan-$appVersion-android.apk")
Copy-Item -LiteralPath (Join-Path $projectRoot 'android\app\build\outputs\apk\release\app-release.apk') -Destination $apk -Force
$env:JAVA_HOME = Join-Path $toolsRoot 'jdk'
& (Join-Path $env:ANDROID_HOME 'build-tools\36.0.0\apksigner.bat') verify --verbose $apk
if ($LASTEXITCODE -ne 0) { throw 'APK signature validation failed' }
$hash = (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText(($apk + '.sha256'),$hash + '  ' + [IO.Path]::GetFileName($apk) + "`n")
Write-Output "Verified APK: $apk"
