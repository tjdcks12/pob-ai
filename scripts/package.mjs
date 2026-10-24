// Builds the Windows release:
//   dist/pob-ai-<version>-win-x64.zip  unzip anywhere and run "PoB AI.exe" (Node.js included)
//   dist/latest.json                   the manifest `pob update` reads
//
//   node scripts/package.mjs [--update-url <url of latest.json>] [--notes "…"] [--node-dir <folder>]
//
// --update-url is baked into the release so it can find its own updates; for GitHub releases use
// https://github.com/<owner>/<repo>/releases/latest/download/latest.json and upload both files.
// --node-dir is a Node.js Windows build (node.exe and LICENSE), e.g. an unpacked node-v22-win-x64.zip;
// it defaults to the Node.js running this script.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const option = name => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const dist = path.join(root, 'dist');
const stage = path.join(dist, 'stage');
const top = path.join(stage, 'PoB AI');
const zipName = `pob-ai-${version}-win-x64.zip`;
const latestZipName = 'pob-ai-latest-win-x64.zip';
execFileSync(process.execPath, [path.join(root, 'scripts/build-panel.mjs')], { stdio: 'inherit', windowsHide: true });

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(top, { recursive: true });

const copy = (from, to = from, filter = () => true) => {
  fs.cpSync(path.join(root, from), path.join(top, to), { recursive: true, filter: src => filter(path.relative(root, src).split(path.sep).join('/')) });
};
for (const file of ['PoB AI.exe', 'PoB AI.cmd', 'launcher.mjs', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md', 'README.ko.md']) copy(file);
for (const dir of ['bin', 'src', 'adapter', 'ui']) copy(dir);
copy('desktop/bin', 'desktop/bin');
copy('data', 'data', rel => !rel.startsWith('data/ui/glossary') && !/\.part\d*\.json$/.test(rel));
copy('docs', 'docs');

// koffi: only the Windows x64 binary of its prebuilt set.
const koffi = 'node_modules/koffi';
for (const item of ['package.json', 'index.js', 'indirect.js', 'lib', 'LICENSE.txt', 'build/koffi/win32_x64']) {
  if (fs.existsSync(path.join(root, koffi, item))) copy(`${koffi}/${item}`);
}
// Native terminal only for Antigravity's Windows OAuth input. Include x64 prebuilds and licenses.
for (const item of ['package.json', 'lib', 'LICENSE', 'prebuilds/win32-x64']) {
  copy(`node_modules/node-pty/${item}`, `node_modules/node-pty/${item}`, rel => !/\.(?:pdb|map)$|\.test\.js$/.test(rel) && !rel.includes('/conpty/'));
}
copy('node_modules/node-addon-api/LICENSE.md', 'node_modules/node-addon-api/LICENSE.md');

const release = { ...pkg };
delete release.scripts;
release.pobAi = { ...release.pobAi, updateUrl: option('update-url') ?? 'https://github.com/tjdcks12/pob-ai/releases/latest/download/latest.json' };
fs.writeFileSync(path.join(top, 'package.json'), `${JSON.stringify(release, null, 2)}\n`);

const nodeDir = option('node-dir') ?? path.dirname(process.execPath);
fs.mkdirSync(path.join(top, 'runtime', 'node'), { recursive: true });
fs.copyFileSync(path.join(nodeDir, 'node.exe'), path.join(top, 'runtime', 'node', 'node.exe'));
const nodeVersion = execFileSync(path.join(nodeDir, 'node.exe'), ['-v'], { encoding: 'utf8' }).trim();
if (fs.existsSync(path.join(nodeDir, 'LICENSE'))) {
  fs.copyFileSync(path.join(nodeDir, 'LICENSE'), path.join(top, 'runtime', 'node', 'LICENSE'));
} else {
  console.warn(`warning: ${nodeDir} has no Node.js LICENSE file; use --node-dir with an official Node.js zip for a public release.`);
  fs.writeFileSync(path.join(top, 'runtime', 'node', 'LICENSE.txt'), `Node.js ${nodeVersion} is licensed under the MIT license; it includes third-party components under their own licenses.\nFull text: https://raw.githubusercontent.com/nodejs/node/${nodeVersion}/LICENSE\n`);
}

const zip = path.join(dist, zipName);
fs.rmSync(zip, { force: true });
const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
execFileSync(tar, ['-a', '-c', '-f', zip, '-C', stage, 'PoB AI']);
fs.copyFileSync(zip, path.join(dist, latestZipName));
fs.rmSync(stage, { recursive: true, force: true });

const bytes = fs.readFileSync(zip);
const manifest = {
  version,
  url: zipName,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  size: bytes.length,
  node: nodeVersion,
  notes: option('notes') ?? null,
  publishedAt: new Date().toISOString(),
};
fs.writeFileSync(path.join(dist, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`${path.relative(root, zip)}  ${(bytes.length / 1048576).toFixed(1)} MB  sha256 ${manifest.sha256}`);
console.log(`${path.relative(root, path.join(dist, 'latest.json'))}`);
