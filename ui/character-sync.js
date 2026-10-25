// Settings-only controller. Merely opening settings reads cached account metadata;
// character downloads and file writes require the explicit opt-in switch.
export function characterSyncSettings({ api, t, locale }) {
  const $ = id => document.getElementById(id);
  let status = { enabled: false, intervalSeconds: 120, phase: 'off' }, context = {}, busy = false;
  let requestedEnabled, draftCharacter, draftInterval, errorKey, optionsKey, contextRevision = 0, loading;
  const accept = next => { if ((next.revision ?? 0) >= (status.revision ?? 0)) status = next; };
  const phaseKeys = { off: 'syncOff', ready: 'syncReady', refreshing: 'syncRefreshing', updated: 'syncUpdated', unchanged: 'syncUnchanged',
    waiting: 'syncWaiting', restart: 'syncRestart', signIn: 'syncSignIn', unsaved: 'syncUnsaved', differentBuild: 'syncDifferentBuild', changed: 'syncChanged', skillChanged: 'syncSkillChanged', recovery: 'syncRecovery', error: 'syncError' };
  const errorKeys = { UNSAVED: 'syncUnsaved', NOT_SIGNED_IN: 'syncSignIn', LIVE_REQUIRED: 'syncWaiting',
    RESTART_REQUIRED: 'syncRestart', CHARACTER_REQUIRED: 'syncSelectCharacter', SYNC_BUSY: 'syncRefreshing' };
  function render() {
    const blocked = busy || status.running === true;
    $('sync-enabled').checked = requestedEnabled ?? status.enabled;
    $('sync-enabled').disabled = blocked;
    $('sync-character').disabled = blocked || status.enabled;
    $('sync-interval').disabled = blocked || status.enabled;
    $('sync-list').disabled = blocked || !context.available || !context.signedIn;
    $('sync-now').disabled = blocked || !status.enabled;
    const interval = String(status.enabled ? status.intervalSeconds ?? 120 : draftInterval ?? status.intervalSeconds ?? 120);
    if ($('sync-interval').value !== interval) $('sync-interval').value = interval;
    const minutes = new Intl.NumberFormat(locale(), { style: 'unit', unit: 'minute', unitDisplay: 'long' });
    for (const option of $('sync-interval').options) { const label = minutes.format(Number(option.value) / 60); if (option.textContent !== label) option.textContent = label; }
    const file = status.enabled ? status.file : context.file;
    $('sync-file').textContent = file || '—';
    $('sync-file').title = file || '';
    const phase = status.phase === 'recovery' || status.enabled ? status.phase : context.available === false ? context.phase
      : context.available && !context.signedIn ? 'signIn' : context.unsaved ? 'unsaved' : 'off';
    $('sync-status').textContent = t(errorKey ?? phaseKeys[phase] ?? 'syncError') + (!errorKey && status.lastSuccessAt && status.enabled
      ? ' · ' + new Date(status.lastSuccessAt).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) : '');
    const select = $('sync-character'), characters = context.characters ?? [];
    const key = JSON.stringify([t('syncSelectCharacter'), characters]);
    if (key !== optionsKey) {
      const options = [new Option(t('syncSelectCharacter'), ''), ...characters.map(character => new Option(`${character.name} · ${character.level} · ${character.league}`, character.name))];
      select.replaceChildren();
      for (const option of options) select.add(option);
      optionsKey = key;
    }
    const chosen = (status.enabled ? status.character : draftCharacter ?? status.character) || context.suggestedCharacter || '';
    const value = [...select.options].some(option => option.value === chosen) ? chosen : '';
    if (select.value !== value) select.value = value;
  }
  async function loadContext(reload = false) {
    const revision = ++contextRevision;
    const reply = await api('/api/character-sync/context' + (reload ? '?reload=1' : ''));
    if (!reply.ok || revision !== contextRevision) return;
    context = reply;
    render();
  }
  async function action(path, body) {
    if (busy) return false;
    requestedEnabled = typeof body.enabled === 'boolean' ? body.enabled : undefined;
    errorKey = undefined;
    busy = true; render();
    try {
      const reply = await api(path, body);
      if (reply.ok) { accept(reply); draftCharacter = undefined; draftInterval = undefined; }
      else errorKey = errorKeys[reply.error?.code] ?? 'syncError';
      return reply.ok;
    } catch { errorKey = 'syncError'; return false; }
    finally { busy = false; requestedEnabled = undefined; render(); }
  }
  $('sync-enabled').addEventListener('change', async e => {
    await action('/api/character-sync', { enabled: e.target.checked, character: $('sync-character').value, intervalSeconds: Number($('sync-interval').value) });
  });
  $('sync-character').addEventListener('change', () => { draftCharacter = $('sync-character').value; errorKey = undefined; });
  $('sync-interval').addEventListener('change', () => { draftInterval = Number($('sync-interval').value); errorKey = undefined; });
  $('sync-list').addEventListener('click', async () => { if (busy) return; busy = true; errorKey = undefined; render(); try { await loadContext(true); } catch { errorKey = 'syncError'; } finally { busy = false; render(); } });
  $('sync-now').addEventListener('click', async () => { await action('/api/character-sync/refresh', {}); });
  return {
    load() {
      loading ??= (async () => { try { const reply = await api('/api/character-sync'); if (reply.ok) accept(reply); await loadContext(); }
        catch { errorKey = 'syncError'; } finally { render(); } })().finally(() => { loading = undefined; });
      return loading;
    },
    update(next) { accept(next); if (['updated', 'ready'].includes(next.phase)) errorKey = undefined; render(); }, render,
  };
}
