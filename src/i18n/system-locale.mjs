import { execFileSync } from 'node:child_process';
import { matchLocale, resolveLocale } from '../../ui/locale.js';

let cached;
/** Windows display language, independent of the browser's preferred language or regional format. */
export function systemLocale() {
  if (cached) return cached;
  let language;
  if (process.platform === 'win32') {
    try {
      language = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[Globalization.CultureInfo]::CurrentUICulture.Name'],
        { encoding: 'utf8', windowsHide: true, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch { /* Use the runtime locale if Windows cannot answer. */ }
  }
  return cached = matchLocale([language || Intl.DateTimeFormat().resolvedOptions().locale]);
}

export const windowLocale = preference => resolveLocale(preference, systemLocale());
