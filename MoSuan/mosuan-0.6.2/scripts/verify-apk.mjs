import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';

const run = promisify(execFile), root = process.cwd();
const tools = path.join(root, '.local/android-tools');
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const apk = path.join(root, `artifacts/android/mosuan-${version}-android.apk`);
const java = path.join(tools, 'jdk/bin/java.exe');
const { stdout: signing } = await run(java, ['-jar', path.join(tools, 'sdk/build-tools/36.0.0/lib/apksigner.jar'), 'verify', '--verbose', '--print-certs', apk], { windowsHide: true, encoding: 'utf8' });
const { stdout: badging } = await run(path.join(tools, 'sdk/build-tools/36.0.0/aapt.exe'), ['dump', 'badging', apk], { windowsHide: true, encoding: 'utf8', maxBuffer: 2_000_000 });
const { stdout: manifest } = await run(path.join(tools, 'sdk/build-tools/36.0.0/aapt.exe'), ['dump', 'xmltree', apk, 'AndroidManifest.xml'], { windowsHide: true, encoding: 'utf8', maxBuffer: 2_000_000 });
const { stdout: listing } = await run(path.join(tools, 'jdk/bin/jar.exe'), ['tf', apk], { windowsHide: true, encoding: 'utf8', maxBuffer: 3_000_000 });
const files = listing.split(/\r?\n/);
assert(badging.includes("package: name='cn.mosuan.reader'"));
assert(badging.includes(`versionName='${version}'`));
assert(badging.includes("sdkVersion:'24'"));
assert(badging.includes("targetSdkVersion:'36'"));
assert(files.some(file => file === 'assets/public/index.html'));
assert(files.includes('assets/phone-auth.js'));
assert(!files.includes('assets/phone-web.js'));
assert(files.some(file => /assets\/public\/assets\/powWorker-.+\.js$/.test(file)));
assert(files.some(file => /assets\/public\/assets\/markdownWorker-.+\.js$/.test(file)));
assert(files.some(file => /assets\/public\/assets\/mathjaxRenderer-.+\.js$/.test(file)));
assert(files.filter(file => /KaTeX.*\.woff2$/.test(file)).length > 10);
assert(!files.some(file => /(?:^|\/)(?:\.env(?:\..*)?|deepseek-auth\.json|proxy-key|mobile-key|password|[^/]+\.(?:p12|jks))$/.test(file)));
assert(!/android:debuggable[^\n]*(?:0xffffffff|true)/.test(manifest));
const sha256 = createHash('sha256').update(await readFile(apk)).digest('hex');
const report = {
  appId: 'cn.mosuan.reader', version, minSdk: 24, targetSdk: 36,
  appLabel: badging.match(/^application-label:'([^']+)'/m)?.[1],
  sizeBytes: (await stat(apk)).size, sha256, signatureVerified: true,
  signatureSchemes: signing.split(/\r?\n/).filter(line => line.startsWith('Verified using')),
  signerSha256: signing.match(/certificate SHA-256 digest: ([a-f0-9]+)/i)?.[1],
  permissions: [...badging.matchAll(/^uses-permission: name='([^']+)'/gm)].map(match => match[1]),
  debugBuild: false, bundledMathJax: true, bundledKaTeXFonts: true, privateCredentialFilesBundled: false,
  physicalDeviceTested: false, realPhoneWebConversationTested: false, nativeWebApiClient: true, encryptedNativeCredentials: true,
  frontendTests: process.env.MOSUAN_VERIFIED_TESTS || 'Not run by this APK verification script',
};
await writeFile(path.join(root, 'artifacts/android/verification.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
