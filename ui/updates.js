// The same update state drives the agent banner and the settings window.
export function updatePresentation(update) {
  const phase = update?.phase ?? (update?.restartNeeded ? 'ready' : update?.available ? 'available' : 'none');
  const received = update?.progress?.received, total = update?.progress?.total;
  const percent = Number.isFinite(received) && Number.isFinite(total) && total > 0 ? Math.min(100, Math.max(0, Math.floor(received * 100 / total))) : null;
  return {
    phase, visible: ['available', 'downloading', 'ready', 'error'].includes(phase),
    busy: ['checking', 'downloading'].includes(phase),
    text: { checking: 'checkingUpdates', available: 'updateAvailable', downloading: 'updateDownloading', ready: 'updateReady', error: 'updateFailed', checkError: 'updateCheckFailed', none: 'upToDate' }[phase] ?? 'upToDate',
    action: phase === 'ready' ? 'restartToUpdate' : phase === 'error' ? 'retry' : 'updateNow',
    vars: { version: update?.latest ?? '', progress: percent === null ? '' : `${percent}%` },
  };
}
