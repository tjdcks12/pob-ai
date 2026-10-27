// A rare glove copy for any locale, assembled from the official GGPK strings in the packs.
import { gameLocale, gameLocaleRegistry } from '../../../src/items/localization.mjs';

const unmark = s => s.replace(/\[(?:[^|\]]*\|)?([^|\]]+)\]/g, '$1');
const replacement = (s, values) => {
  let implicit = 0;
  return unmark(s).replace(/\{(\d*)(?::([^}]*))?\}/g, (_all, id, spec = '') => {
    const value = values[id || String(implicit++)];
    return `${spec.startsWith('+') && !value.startsWith('-') ? '+' : ''}${value}`;
  });
};

/** A rare glove copy assembled from each locale's own game strings (on `baseId`, or the first unambiguous base) */
export function localeFixture(locale, baseId) {
  const pack = gameLocale(locale), en = gameLocale('en'), strings = pack.clientStringsById;
  const bases = gameLocaleRegistry().basesByMetadataId;
  const id = baseId ?? Object.keys(bases).find(key => bases[key].classId === 'Gloves' && !!pack.namesByMetadataId[key] && !pack.namesByMetadataId[key].includes('{') && new Set(Object.entries(pack.namesByMetadataId).filter(([, name]) => name === pack.namesByMetadataId[key]).map(([id]) => en.namesByMetadataId[id])).size === 1);
  const life = pack.statTemplates.find(desc => desc.stats.length === 1 && desc.stats[0] === 'base_maximum_life').variants.find(v => v.conditions[0] === '#');
  const raw = [
    `${unmark(strings.ItemDisplayStringClass)}: ${unmark(pack.classesById.Gloves)}`,
    `${unmark(strings.ItemDisplayStringRarity)}: ${unmark(strings.ItemDisplayStringRare)}`,
    'Fixture Rare', unmark(pack.namesByMetadataId[id]), '--------',
    `${unmark(strings.Quality)}: +20% (augmented)`,
    `${unmark(strings.ItemDisplayArmourEvasionRating)}: 364 (augmented)`, '--------',
    `${unmark(strings.ItemPopupRequirements)}: ${unmark(strings.Level)} 75, 94 ${unmark(strings.DexterityShort)}`, '--------',
    `${unmark(strings.ItemDisplayStringSockets)}: S J`, '--------',
    `${unmark(strings.ItemDisplayStringItemLevel)}: 86`, '--------',
    `{ ${replacement(strings.ModDescriptionLinePrefix, { 0: 'Fixture' })}${replacement(strings.ModDescriptionLineTier, { 0: '2' })} }`,
    replacement(life.text, { 0: '92' }), '--------', unmark(strings.ItemPopupCorrupted),
  ].join('\n');
  return { raw, base: unmark(en.namesByMetadataId[id]) };
}
