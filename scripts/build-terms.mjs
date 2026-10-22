// Builds data/terms/<locale>.json.gz: official game names in the ten client languages, keyed the
// way PoB keys them, so the CLI can show and accept names in the user's language.
//   node scripts/build-terms.mjs --passives <folder with <locale>.json passive tree text>
// Sources: the item language packs in data/items/locales (bases, gems, uniques, skills, classes)
// and passive tree text extracted from the game client ({ nodes: { id: [name, ...stats] } }).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCALES = ['en', 'ko', 'ja', 'zh-Hant', 'ru', 'de', 'fr', 'es', 'pt-BR', 'th'];
const argv = process.argv.slice(2);
const passivesDir = argv[argv.indexOf('--passives') + 1];
if (!argv.includes('--passives') || !passivesDir) {
  console.error('Usage: node scripts/build-terms.mjs --passives <folder>');
  process.exit(2);
}

const packDir = path.join(root, 'data', 'items', 'locales');
const loadPack = locale => {
  const file = fs.readdirSync(packDir).find(n => n.startsWith(`${locale}.`) && n.endsWith('.json.gz'));
  return JSON.parse(gunzipSync(fs.readFileSync(path.join(packDir, file)))).pack;
};
const en = loadPack('en');
const enPassives = JSON.parse(fs.readFileSync(path.join(passivesDir, 'en.json'), 'utf8'));
const usable = name => typeof name === 'string' && name.trim() && !/^(DNT|WIP|NULL|\[)/.test(name);

const outDir = path.join(root, 'data', 'terms');
fs.mkdirSync(outDir, { recursive: true });
for (const locale of LOCALES) {
  const pack = loadPack(locale);
  const passives = JSON.parse(fs.readFileSync(path.join(passivesDir, `${locale}.json`), 'utf8'));
  // English name -> localized name, joined on the game's own ids.
  const names = {};
  const join = (enTable, locTable) => {
    for (const [id, enName] of Object.entries(enTable ?? {})) {
      const local = locTable?.[id];
      if (usable(enName) && usable(local) && !(enName in names)) names[enName] = local;
    }
  };
  join(en.namesByMetadataId, pack.namesByMetadataId);
  join(en.uniqueNamesById, pack.uniqueNamesById);
  join(en.skillNamesById, pack.skillNamesById);
  join(en.characterNamesById, pack.characterNamesById);
  join(en.ascendancyNamesById, pack.ascendancyNamesById);
  join(en.classesById, pack.classesById);
  join(enPassives.characters, passives.characters);
  join(enPassives.ascendancies, passives.ascendancies);
  const doc = { locale, source: { gameBuild: 'see data/items/locale-registry.json' }, names, passives: passives.nodes };
  const file = path.join(outDir, `${locale}.json.gz`);
  fs.writeFileSync(file, gzipSync(JSON.stringify(doc), { level: 9 }));
  console.log(`${locale}: ${Object.keys(names).length} names, ${Object.keys(passives.nodes).length} passives, ${fs.statSync(file).size} bytes`);
}
