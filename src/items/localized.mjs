// Locale-pack route: rebuilds the item in English from official IDs (base metadata IDs, unique
// name IDs, stat description identities). Works for every locale the packs cover, offline.
// Roll ranges, modifier names and tags are not kept on this route.
import { gameLocale, localizedClassName, localizedItemName, localizedUniqueNames, normalizeItemStructure } from './localization.mjs';
import { parseItem } from './parse.mjs';
import { chooseBase, readBaseEvidence, toAscii } from './convert.mjs';

const PROPERTY = { quality: 'Quality', ar: 'Armour', ev: 'Evasion Rating', es: 'Energy Shield', ward: 'Ward', block: 'Block chance', spirit: 'Spirit', phys: 'Physical Damage', ele: 'Elemental Damage', chaos: 'Chaos Damage', crit: 'Critical Hit Chance', aps: 'Attacks per Second' };
const KINDS = { prefix: 'Prefix Modifier', suffix: 'Suffix Modifier', implicit: 'Implicit Modifier', enchant: 'Enhancement', rune: 'Rune Modifier', unique: 'Unique Modifier', crafted: 'Crafted Modifier', skill: 'Unique Modifier' };
const KO_RARITY = { 일반: 'Normal', 마법: 'Magic', 희귀: 'Rare', 고유: 'Unique' };

/** English output is produced from canonical IDs, never by translating a translated name. */
export function localizedPobText(raw, locale) {
  if (!gameLocale(locale) || !gameLocale('en')) return undefined;
  const result = { text: '', status: 'ok', language: locale, mods: { total: 0, converted: 0 }, dropped: [], notes: [], lines: [] };
  const item = parseItem(raw);
  const block = (code, reason, detail) => ({ ...result, status: 'blocked', blockedCode: code, blockedReason: reason, notes: [...result.notes, ...(detail ? [detail] : [])] });
  if (!item) return block('notItem', 'Could not read this as an item copy');
  const englishHead = normalizeItemStructure(raw, locale).split(/\r?\n/u);
  const rarity = locale === 'ko' ? KO_RARITY[item.rarity ?? ''] : item.rarityId;
  result.rarity = rarity;
  if (!rarity) return block('noRarity', 'Unknown rarity');
  if (!['Normal', 'Magic', 'Rare', 'Unique'].includes(rarity)) return block('notGear', 'Not a PoB equipment item');
  const candidates = [...new Set((item.baseMetadataIds ?? []).map(id => localizedItemName(id, 'en')).filter(Boolean))];
  if (!candidates.length) return block('noBase', 'No official base identity for this base name', item.baseType);
  let base = candidates[0];
  if (candidates.length > 1) {
    const choice = chooseBase(candidates, readBaseEvidence(englishHead));
    result.baseChoice = { candidates, decided: choice.decided, by: choice.by };
    result.baseAlternatives = candidates;
    if (!choice.decided) return block('noBase', 'Several possible bases', candidates.join(' / '));
    base = choice.pick;
  }
  result.baseName = base;
  const keep = (from, to, kind) => result.lines.push({ from, to: toAscii(to), kind });
  const separator = () => keep('--------', '--------', 'separator');
  const englishClass = localizedClassName(item.classId ?? item.itemClass ?? '', 'en');
  if (englishClass) keep(item.itemClass ?? '', `Item Class: ${englishClass}`, 'head');
  keep(item.rarity ?? rarity, `Rarity: ${rarity}`, 'head');
  if (rarity === 'Rare') keep(item.name ?? '', 'Rare Item', 'head');
  if (rarity === 'Unique') {
    const names = item.name ? localizedUniqueNames(item.name, locale, 'en') : [];
    keep(item.name ?? '', names.length === 1 ? names[0] : 'Unique Item', 'head');
    if (names.length !== 1) { result.status = 'partial'; result.notes.push('Could not resolve the unique name to one official identity'); }
  }
  keep(item.baseType, base, 'head');
  separator();
  for (const property of item.properties) {
    const label = property.key && PROPERTY[property.key];
    if (label) keep(`${property.label}: ${property.value}`, `${label}: ${property.value}${property.augmented ? ' (augmented)' : ''}`, 'property');
  }
  if (item.sockets?.length) { separator(); keep('Sockets', `Sockets: ${item.sockets.join(' ')}`, 'property'); }
  if (rarity === 'Unique' && item.requirements?.level !== undefined) { separator(); keep(item.requirements.text, `Requires Level ${item.requirements.level}`, 'requirement'); }
  if (item.itemLevel !== undefined) { separator(); keep('Item Level', `Item Level: ${item.itemLevel}`, 'property'); }
  for (const mod of item.mods) {
    const converted = [];
    for (let n = 0; n < mod.lines.length; n++) {
      const line = mod.lines[n];
      const span = line.canonical?.status === 'resolved' ? line.canonicalSpan ?? 1 : 1;
      result.mods.total += span;
      const english = line.canonical?.status === 'resolved' ? line.canonical.english : locale === 'en' ? line.text : undefined;
      if (english && !/[^\x00-\x7F]/u.test(toAscii(english))) {
        result.mods.converted += span;
        converted.push({ from: mod.lines.slice(n, n + span).map(l => l.raw).join('\n'), to: toAscii(english), kind: 'mod' });
      } else {
        result.dropped.push(line.raw);
        converted.push({ from: line.raw, kind: 'mod', note: line.canonical?.status === 'ambiguous' ? 'Official stat mapping is ambiguous' : line.canonical?.status === 'unsupported' ? 'Official stat mapping is not supported' : 'No official stat mapping' });
      }
      n += span - 1;
    }
    if (converted.some(line => line.to)) {
      separator();
      const kind = mod.corruption ? 'Corruption Enhancement' : KINDS[mod.kind ?? ''];
      if (kind) keep('', `{ ${mod.origin === 'fractured' ? 'Fractured ' : mod.origin === 'desecrated' ? 'Desecrated ' : mod.mark === 'crafted' ? 'Crafted ' : ''}${kind}${mod.tier ? ` (Tier: ${mod.tier})` : ''} }`, 'header');
    }
    result.lines.push(...converted);
  }
  for (const [active, label] of [[item.doubleCorrupted, 'Twice Corrupted'], [item.corrupted && !item.doubleCorrupted, 'Corrupted'], [item.unidentified, 'Unidentified'], [item.mirrored, 'Mirrored'], [item.sanctified, 'Sanctified'], [item.fractured, 'Fractured Item']]) if (active) { separator(); keep(label, label, 'flag'); }
  result.text = result.lines.flatMap(line => line.to === undefined ? [] : [line.to]).join('\r\n');
  if (result.dropped.length) result.status = 'partial';
  return result;
}
