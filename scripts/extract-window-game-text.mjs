// Complete display-only game text for PoB. Item-import packs deliberately include only the
// published crafting pool; unique/passive modifiers need the full official CSD instead.
// node scripts/extract-window-game-text.mjs <poe2way folder> [--ggpk <Content.ggpk>]
// Reads the installation and the existing GGPK extractor; never changes either repository.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

const [webArg, ...args] = process.argv.slice(2);
if (!webArg) throw Error('Usage: node scripts/extract-window-game-text.mjs <poe2way folder> [--ggpk <Content.ggpk>]');
const web = path.resolve(webArg);
const ggpk = args.includes('--ggpk') ? args[args.indexOf('--ggpk') + 1] : process.env.POE2_GGPK ?? 'C:/Kakaogames/Path of Exile2/Content.ggpk';
const output = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/window-game-text');
const fromWeb = member => import(pathToFileURL(path.join(web, member)));
const { FileLoader, getFileInfo } = await import(pathToFileURL(createRequire(path.join(web, 'package.json')).resolve('pathofexile-dat/bundles.js')));
const { GgpkBundleLoader } = await fromWeb('scripts/game-data/lib/ggpk.mjs');
const { createTables } = await fromWeb('scripts/game-data/lib/tables.mjs');
const { parseStatDescriptions, stripMarkup } = await fromWeb('scripts/game-data/lib/stat-text.mjs');
const { serializeDescription } = await fromWeb('scripts/game-data/localization.mjs');
const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const registry = await readJson(path.join(web, 'src/lib/i18n/locale-registry.json'));
const schemaBytes = await fs.readFile(path.join(web, '.game-work/schema.min.json'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const before = await fs.stat(ggpk);
const game = await GgpkBundleLoader.open(ggpk);
const members = new Map(), packs = {};
let indexSha256;
try {
  const loader = await FileLoader.create(game);
  indexSha256 = hash(await game.fetchFile('_.index.bin'));
  const strict = {
    async getFileContents(member) {
      if (!members.has(member)) {
        if (!getFileInfo(member, loader.index.bundlesInfo, loader.index.filesInfo)) throw Error(`Missing GGPK member: ${member}`);
        const bytes = await loader.getFileContents(member);
        members.set(member, { bytes, sha256: hash(bytes) });
      }
      return members.get(member).bytes;
    },
    async tryGetFileContents(member) {
      return getFileInfo(member, loader.index.bundlesInfo, loader.index.filesInfo) ? this.getFileContents(member) : null;
    },
  };
  const descriptions = [], seen = new Set();
  const readCsd = async member => {
    if (seen.has(member)) return;
    seen.add(member);
    const text = new TextDecoder('utf-16le').decode(await strict.getFileContents(member));
    parseStatDescriptions(text).descriptions.forEach((desc, position) => descriptions.push({ desc, member, position }));
    for (const match of text.matchAll(/^include "([^"]+)"/gm)) await readCsd(match[1].toLowerCase());
  };
  for (const file of ['stat_descriptions.csd', 'passive_skill_stat_descriptions.csd', 'map_stat_descriptions.csd', 'tablet_stat_descriptions.csd', 'sanctum_relic_stat_descriptions.csd']) await readCsd(`data/statdescriptions/${file}`);
  const { table } = createTables(strict, JSON.parse(schemaBytes), { strictLocale: true });
  for (const locale of registry) {
    const strings = await table('ClientStrings', locale.gameFolder);
    const strings2 = await table('ClientStrings2', locale.gameFolder);
    const flavour = await table('FlavourText', locale.gameFolder);
    const values = t => Object.fromEntries(t.col('Id').map((id, i) => [id, stripMarkup(t.col('Text')[i] ?? '')]).filter(([, text]) => text));
    packs[locale.id] = {
      clientStringsById: { ...values(strings), ...values(strings2) },
      flavourById: values(flavour),
      statTemplates: descriptions.map(({ desc, member, position }) => serializeDescription(desc, member, position, locale.csdLanguage)).filter(Boolean),
    };
  }
} finally { await game.close(); }
const after = await fs.stat(ggpk);
if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw Error('GGPK changed during extraction');
const source = {
  schemaVersion: 1, indexSha256, schemaSha256: hash(schemaBytes),
  members: [...members].map(([member, { sha256 }]) => ({ path: member, sha256 })).sort((a, b) => a.path.localeCompare(b.path)),
  locales: {},
};
await fs.mkdir(output, { recursive: true });
for (const [locale, pack] of Object.entries(packs)) {
  const bytes = gzipSync(JSON.stringify(pack), { level: 9 });
  await fs.writeFile(path.join(output, `${locale}.json.gz`), bytes);
  source.locales[locale] = { sha256: hash(bytes), bytes: bytes.length, descriptions: pack.statTemplates.length, flavour: Object.keys(pack.flavourById).length };
}
await fs.writeFile(path.join(output, 'source.json'), JSON.stringify(source, null, 2) + '\n');
console.log(JSON.stringify(source.locales, null, 2));
