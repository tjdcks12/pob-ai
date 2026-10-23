// Builds the small .NET Framework / Edge WebView2 window shell on Windows.
// The pinned SDK is fetched from NuGet; the Evergreen runtime is supplied by Windows.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = '1.0.4314.35';
const sha256 = '90778deb1b77e36292828b4b5833c9255c27533f40e0ddd55891ae718944edc4';
const sdk = path.join(root, '.state', 'webview2-sdk-' + version);
const bin = path.join(root, 'desktop', 'bin');
if (process.platform !== 'win32') throw new Error('The panel shell is built on Windows.');
fs.mkdirSync(sdk, { recursive: true });
fs.mkdirSync(bin, { recursive: true });
const zip = path.join(sdk, 'sdk.zip');
if (!fs.existsSync(zip) || createHash('sha256').update(fs.readFileSync(zip)).digest('hex') !== sha256) {
  const response = await fetch('https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/' + version + '/microsoft.web.webview2.' + version + '.nupkg');
  if (!response.ok) throw new Error('WebView2 SDK download: ' + response.status);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== sha256) throw new Error('WebView2 SDK checksum mismatch.');
  fs.writeFileSync(zip, bytes);
}
const quote = value => "'" + value.replaceAll("'", "''") + "'";
execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Expand-Archive -LiteralPath ' + quote(zip) + ' -DestinationPath ' + quote(sdk) + ' -Force'], { windowsHide: true });
const core = path.join(sdk, 'lib/net462/Microsoft.Web.WebView2.Core.dll');
const forms = path.join(sdk, 'lib/net462/Microsoft.Web.WebView2.WinForms.dll');
for (const file of [core, forms, path.join(sdk, 'runtimes/win-x64/native/WebView2Loader.dll')])
  fs.copyFileSync(file, path.join(bin, path.basename(file)));
for (const name of ['LICENSE.txt', 'NOTICE.txt']) fs.copyFileSync(path.join(sdk, name), path.join(bin, 'WebView2-' + name));
const compiler = path.join(process.env.SystemRoot || 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
execFileSync(compiler, [
  '/nologo', '/target:winexe', '/platform:x64', '/optimize+', '/out:' + path.join(bin, 'pob-ai-panel.exe'),
  '/win32manifest:' + path.join(root, 'desktop/app.manifest'), '/win32icon:' + path.join(root, 'desktop/icon.ico'),
  '/reference:System.dll', '/reference:System.Core.dll', '/reference:System.Drawing.dll',
  '/reference:System.Windows.Forms.dll', '/reference:System.Web.Extensions.dll', '/reference:' + core, '/reference:' + forms,
  path.join(root, 'desktop/Panel.cs'),
], { windowsHide: true, stdio: 'inherit' });
console.log('Built desktop/bin/pob-ai-panel.exe');
