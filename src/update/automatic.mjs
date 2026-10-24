// Download updates without interrupting PoB or an AI conversation. Restart is always a user action.
import { readConfig } from '../state.mjs';
import { applyUpdate, checkForUpdate, installedUpdate, updateCheckDue, updateUrl, UPDATE_CHECK_MS, VERSION } from './updater.mjs';

export function createAutomaticUpdater({ onChange = () => {}, log = () => {}, fetchImpl = fetch, intervalMs = UPDATE_CHECK_MS, autoStart = true } = {}) {
  let closed = false, checking, downloading;
  const pending = installedUpdate();
  let state = pending ? { phase: 'ready', current: VERSION, installed: pending.version, latest: pending.version, available: false, restartNeeded: true } : null;
  const publish = next => { if (!closed) { state = next; onChange(next); } };
  const automatic = () => readConfig().autoDownloadUpdates !== false;

  function download() {
    if (downloading) return downloading;
    publish({ ...state, phase: 'downloading', available: true, progress: null });
    downloading = applyUpdate({ fetchImpl, onProgress: progress => publish({ ...state, phase: 'downloading', progress }) })
      .then(result => {
        publish({ ...state, phase: result.restartNeeded ? 'ready' : 'none', current: VERSION, installed: result.installed,
          latest: result.installed, available: false, restartNeeded: result.restartNeeded, progress: null });
        return result;
      }).catch(error => { publish({ ...state, phase: 'error', progress: null }); throw error; })
      .finally(() => { downloading = null; });
    return downloading;
  }

  function check(force = false) {
    if (closed) return Promise.resolve(state);
    if (checking) return checking;
    if (downloading) return downloading.then(() => state);
    if (!force && !updateCheckDue()) return Promise.resolve(state);
    const before = state;
    publish({ ...state, phase: 'checking', current: VERSION });
    checking = checkForUpdate({ fetchImpl }).then(async update => {
      publish({ ...update, latest: update.restartNeeded && !update.available ? update.installed : update.latest,
        phase: update.available ? 'available' : update.restartNeeded ? 'ready' : 'none' });
      if (update.available && automatic()) await download();
      return state;
    }).catch(error => {
      // A prepared update stays usable offline. Quiet checks do not replace it with an error.
      if (state?.phase === 'checking') publish(before?.restartNeeded ? before : { phase: 'checkError', current: VERSION });
      log(`update check: ${error.message}`);
      if (force) throw error;
      return state;
    }).finally(() => { checking = null; });
    return checking;
  }

  if (state) onChange(state);
  const timer = setInterval(() => { void check(); }, intervalMs);
  timer.unref?.();
  if (autoStart && updateUrl()) queueMicrotask(() => { void check(true).catch(() => {}); });
  return { check, download, get state() { return state; }, close() { closed = true; clearInterval(timer); } };
}
