// Turns item text from the game client (any supported language) into what PoB reads.
import { convertItemText, itemTextLanguage } from './convert.mjs';
import { loadTradeData } from './trade-data.mjs';

let tradeData = null;

/** Korean copies convert best through the official trade stat lists (cached for a day). */
async function koreanTradeData(log) {
  if (tradeData) return tradeData;
  try {
    tradeData = await loadTradeData();
    for (const warning of tradeData.warnings ?? []) log?.(warning);
  } catch (error) {
    log?.(`Trade stat lists unavailable, using the offline language pack: ${error.message}`);
    tradeData = undefined;
  }
  return tradeData;
}

/**
 * Returns { text, conversion } where conversion is null for English input. Throws when the text
 * cannot become a PoB item; partial conversions list the dropped lines so the user can be told.
 */
export async function prepareItemText(raw, { log } = {}) {
  const language = itemTextLanguage(raw);
  if (language === 'en' || language === 'unknown') return { text: raw, conversion: null };
  const trade = language === 'ko' ? await koreanTradeData(log) : undefined;
  const result = convertItemText(raw, trade ? { trade } : {});
  if (result.status === 'blocked') {
    throw Object.assign(new Error(`This ${language} item cannot be converted for PoB: ${result.blockedReason}`), { code: 'ITEM_NOT_CONVERTED', details: { language, blockedCode: result.blockedCode } });
  }
  return {
    text: result.text,
    conversion: { language, status: result.status, base: result.baseName, converted: result.mods.converted, total: result.mods.total,
      dropped: result.dropped.length ? result.dropped : undefined, notes: result.notes.length ? result.notes : undefined },
  };
}
