// Refreshes the game text PoB AI bundles after a game patch:
//   data/items/  item language packs and name tables, the same files poe2way-overlay ships
//   data/terms/  official names per language (rebuilt by build-terms.mjs)
//
//   node scripts/sync-game-data.mjs <poe2way-overlay folder> <poe2way folder>
//
// Run it after poe2way's GGPK update has refreshed both repositories, then `npm test`.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [overlay, web] = process.argv.slice(2).map(p => p && path.resolve(p));
if (!overlay || !web || !fs.existsSync(path.join(overlay, 'src', 'features', 'item', 'locale-registry.json'))) {
  console.error('Usage: node scripts/sync-game-data.mjs <poe2way-overlay folder> <poe2way folder>');
  process.exit(2);
}
const passives = path.join(web, 'public', 'db', 'passive-tree', 'text');
if (!fs.existsSync(path.join(passives, 'en.json'))) {
  console.error(`No passive tree text in ${passives}`);
  process.exit(2);
}

const hash = file => fs.existsSync(file) ? createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null;
const changed = [];
const copy = (from, to) => {
  if (hash(from) === hash(to)) return;
  fs.copyFileSync(from, to);
  changed.push(path.relative(root, to));
};

const items = path.join(root, 'data', 'items');
copy(path.join(overlay, 'src', 'features', 'item', 'locale-registry.json'), path.join(items, 'locale-registry.json'));
for (const name of ['base-hints.json', 'base-names.json', 'name-identities.json']) {
  copy(path.join(overlay, 'src', 'features', 'pob', name), path.join(items, name));
}

// Packs are named <locale>.<hash>.json.gz; drop the ones the new registry no longer uses.
const packsFrom = path.join(overlay, 'public', 'game-data', 'locales');
const packsTo = path.join(items, 'locales');
const packs = fs.readdirSync(packsFrom).filter(n => n.endsWith('.json.gz'));
for (const name of packs) copy(path.join(packsFrom, name), path.join(packsTo, name));
for (const name of fs.readdirSync(packsTo)) {
  if (!packs.includes(name)) { fs.rmSync(path.join(packsTo, name)); changed.push(`removed ${path.relative(root, path.join(packsTo, name))}`); }
}

execFileSync(process.execPath, [path.join(root, 'scripts', 'build-terms.mjs'), '--passives', passives], { stdio: 'inherit' });

console.log(changed.length ? `Updated:\n  ${changed.join('\n  ')}` : 'data/items is already up to date.');
console.log('Next: npm test, then commit data/items and data/terms.');
