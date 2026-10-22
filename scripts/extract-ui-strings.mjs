// Collects PoB's own interface text (labels, buttons, section titles, sidebar and Calcs rows,
// configuration options) from a PoB install into data/ui/source.json, the list translators work from.
//   node scripts/extract-ui-strings.mjs "<PoB folder>"
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pob = process.argv[2];
if (!pob || !fs.existsSync(path.join(pob, 'Launch.lua'))) {
  console.error('Usage: node scripts/extract-ui-strings.mjs "<PoB folder>"');
  process.exit(2);
}

const clean = text => text.replace(/\^x[0-9a-fA-F]{6}/g, '').replace(/\^\d/g, '').replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim();
const keep = text => /[A-Za-z]{2,}/.test(text) && text.length <= 70 && !/%[sdf]|\{\d|(?<!\.)\.\.(?!\.)|\\|^[A-Z_]+$|^https?:/.test(text);

const strings = new Map();
const add = (raw, where) => {
  const text = clean(raw).replace(/:$/, '');
  if (!keep(text)) return;
  if (!strings.has(text)) strings.set(text, new Set());
  strings.get(text).add(where);
};

const files = [];
for (const dir of ['Classes', 'Modules']) {
  for (const name of fs.readdirSync(path.join(pob, dir))) if (name.endsWith('.lua')) files.push(path.join(dir, name));
}
const patterns = [
  /\blabel\s*=\s*"([^"\n]+)"/g,
  /Control\(\s*(?:\{[^{}]*\}|nil)\s*,\s*\{[^{}]*\}\s*,\s*"([^"\n]+)"/g,
  /SectionControl\([^"\n]*?\{[^{}]*\}\s*,\s*"([^"\n]+)"/g,
  /DrawString\([^"\n]*"(?:LEFT|RIGHT_X|CENTER_X)"\s*,\s*\d+\s*,\s*"[A-Z ]+"\s*,\s*"([^"\n]+)"/g,
  /\bsection\s*=\s*"([^"\n]+)"/g,
  /\btitle\s*=\s*"([^"\n]+)"/g,
];
// Looser places where labels also appear; only text that looks like a visible label is kept
// (not lower-case words glued into sentences, internal keys or file names).
const labelPatterns = [
  /new\("\w*Control",\s*(?:\{[^{}]*\}|nil)\s*,\s*\{[^{}]*\}\s*,\s*"([^"\n]+)"/g, // PoB 0.23+: new("ButtonControl", anchor, rect, "Label")
  /\band\s+"([^"\n]+)"\s+or\s+"([^"\n]+)"/g, // cond and "Hide X" or "Show X"
  /\bor\s+"([^"\n]+)"\s*$/gm, // … or "Check for Update"
];
const looksLikeLabel = text => /^[A-Z(<]/.test(text) && !/^[A-Za-z]+[A-Z]\w*$/.test(text) && !/\.\w+$|^\w+\.\w+/.test(text);
for (const file of files) {
  const text = fs.readFileSync(path.join(pob, file), 'utf8');
  const where = file.replace(/\\/g, '/');
  for (const pattern of patterns) for (const m of text.matchAll(pattern)) add(m[1], where);
  for (const pattern of labelPatterns) for (const m of text.matchAll(pattern)) for (const label of m.slice(1)) if (label && looksLikeLabel(label)) add(label, where);
}
// Item slot names, tab names and other short words drawn from tables.
for (const word of ['Tree', 'Skills', 'Items', 'Calcs', 'Configuration', 'Notes', 'Party', 'Compare', 'Import/Export Build',
  'Weapon 1', 'Weapon 2', 'Weapon 1 Swap', 'Weapon 2 Swap', 'Helmet', 'Body Armour', 'Gloves', 'Boots', 'Amulet', 'Ring 1', 'Ring 2', 'Ring 3', 'Belt',
  'Charm 1', 'Charm 2', 'Charm 3', 'Flask 1', 'Flask 2', 'Main Skill', 'Current build']) add(word, 'built-in');

const out = [...strings].sort((a, b) => a[0].localeCompare(b[0])).map(([text, where]) => ({ text, where: [...where].slice(0, 3) }));
const target = process.env.OUT || path.join(root, 'data', 'ui', 'source.json');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify({ pobVersion: fs.readFileSync(path.join(pob, 'manifest.xml'), 'utf8').match(/number="([^"]+)"/)?.[1], strings: out }, null, 1));
console.log(`${out.length} strings -> ${path.relative(root, target)}`);
