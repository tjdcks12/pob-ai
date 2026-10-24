// Settings-only controller. Merely opening settings reads cached account metadata;
// character downloads and file writes require the explicit opt-in switch.
export function characterSyncSettings({ api, t, locale }) {
  const $ = id => document.getElementById(id);
  let status = { enabled: false, intervalSeconds: 120, phase: 'off' }, context = {}, busy = false;
  const accept = next => { if ((next.revision ?? 0) >= (status.revision ?? 0)) status = next; };
  const phaseKeys = { off: 'syncOff', ready: 'syncReady', refreshing: 'syncRefreshing', updated: 'syncUpdated', unchanged: 'syncUnchanged',
    waiting: 'syncWaiting', restart: 'syncRestart', signIn: 'syncSignIn', unsaved: 'syncUnsaved', differentBuild: 'syncDifferentBuild', changed: 'syncChanged', skillChanged: 'syncSkillChanged', recovery: 'syncRecovery', error: 'syncError' };
  const errorKeys = { UNSAVED: 'syncUnsaved', NOT_SIGNED_IN: 'syncSignIn', LIVE_REQUIRED: 'syncWaiting',
    RESTART_REQUIRED: 'syncRestart', CHARACTER_REQUIRED: 'syncSelectCharacter', SYNC_BUSY: 'syncRefreshing' };
  function render() {
    const blocked = busy || status.running;
    $('sync-enabled').checked = status.enabled;
    $('sync-enabled').disabled = blocked;
    $('sync-character').disabled = blocked || status.enabled;
    $('sync-interval').disabled = blocked || status.enabled;
    $('sync-list').disabled = blocked || !context.available || !context.signedIn;
    $('sync-now').disabled = blocked || !status.enabled;
    $('sync-interval').value = String(status.intervalSeconds ?? 120);
    const minutes = new Intl.NumberFormat(locale(), { style: 'unit', unit: 'minute', unitDisplay: 'long' });
    for (const option of $('sync-interval').options) option.textContent = minutes.format(Number(option.value) / 60);
    const file = status.enabled ? status.file : context.file;
    $('sync-file').textContent = file || '—';
    $('sync-file').title = file || '';
    const phase = status.phase === 'recovery' || status.enabled ? status.phase : context.available === false ? context.phase : 'off';
    $('sync-status').textContent = t(phaseKeys[phase] ?? 'syncError') + (status.lastSuccessAt && status.enabled
      ? ' · ' + new Date(status.lastSuccessAt).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) : '');
  }
  async function loadContext(reload = false) {
    const reply = await api('/api/character-sync/context' + (reload ? '?reload=1' : ''));
    if (!reply.ok) return;
    context = reply;
    const select = $('sync-character'), chosen = status.character || select.value || reply.suggestedCharacter;
    select.replaceChildren();
    select.add(new Option(t('syncSelectCharacter'), ''));
    for (const character of reply.characters ?? []) select.add(new Option(`${character.name} · ${character.level} · ${character.league}`, character.name));
    if (chosen && [...select.options].some(option => option.value === chosen)) select.value = chosen;
    render();
  }
  async function action(path, body) {
    busy = true; render();
    try {
      const reply = await api(path, body);
      if (reply.ok) accept(reply);
      else $('sync-status').textContent = t(errorKeys[reply.error?.code] ?? 'syncError');
      return reply.ok;
    } finally { busy = false; $('sync-enabled').checked = status.enabled; }
  }
  $('sync-enabled').addEventListener('change', async e => {
    const ok = await action('/api/character-sync', { enabled: e.target.checked, character: $('sync-character').value, intervalSeconds: Number($('sync-interval').value) });
    if (ok) render(); else {
      // Preserve the useful error text while restoring control availability.
      const message = $('sync-status').textContent; render(); $('sync-status').textContent = message;
    }
  });
  $('sync-interval').addEventListener('change', () => { status.intervalSeconds = Number($('sync-interval').value); });
  $('sync-list').addEventListener('click', async () => { busy = true; render(); try { await loadContext(true); } finally { busy = false; render(); } });
  $('sync-now').addEventListener('click', async () => { await action('/api/character-sync/refresh', {}); render(); });
  return {
    async load() { const reply = await api('/api/character-sync'); if (reply.ok) accept(reply); await loadContext(); render(); },
    update(next) { accept(next); render(); }, render,
  };
}
