// A newly unzipped release must not silently reuse an older service's UI.
// Use that service's verified updater so its launcher, data and open PoB bridge survive.
import { compareVersions, VERSION } from '../update/updater.mjs';
import { callService, serviceInfo } from './client.mjs';

export async function upgradeRunningService(info, { log = () => {}, hops = 0 } = {}) {
  const read = async route => {
    const response = await fetch(`http://127.0.0.1:${info.port}${route}`, {
      headers: { authorization: `Bearer ${info.token}` }, signal: AbortSignal.timeout(3000),
    });
    if (response.status === 404 && route === '/api/character-sync') return { ok: false, error: { code: 'NOT_FOUND' } };
    if (!response.ok) throw new Error(`Service check answered ${response.status}.`);
    return response.json();
  };
  const status = await read('/api/status');
  if (!/^\d+\.\d+\.\d+$/.test(status.version ?? '') || compareVersions(VERSION, status.version) <= 0) return info;
  const [agents, sync] = await Promise.all([read('/api/agent/sessions'), read('/api/character-sync')]);
  const busy = agents.ok !== true || agents.sessions?.some(session => session.running)
    || sync.running === true || (sync.ok !== true && sync.error?.code !== 'NOT_FOUND');
  let result;
  try { result = await callService(info, 'update.apply', { restart: !busy }); }
  catch (error) { throw Object.assign(error, { restartRequested: !busy }); }
  if (busy) {
    log('The update is prepared. Apply it in Settings after the AI turn or character refresh finishes.');
    return info;
  }
  if (!result.result?.restarting) throw new Error('Apply the newer release in Settings, then restart PoB AI.');
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const current = await serviceInfo();
    if (current) {
      let next;
      try {
        const response = await fetch(`http://127.0.0.1:${current.port}/api/status`, {
          headers: { authorization: `Bearer ${current.token}` }, signal: AbortSignal.timeout(1500),
        });
        const value = await response.json();
        if (response.ok && /^\d+\.\d+\.\d+$/.test(value.version ?? '')) next = value;
      } catch { /* the old service may have closed between health and status */ }
      if (next && compareVersions(next.version, VERSION) >= 0) return { ...current, restarted: true };
      // Older releases first apply any update already prepared, even if it predates this ZIP.
      // Continue from that intermediate service instead of leaving its old UI on screen.
      if (next && compareVersions(next.version, status.version) > 0) {
        if (hops >= 2) throw Object.assign(new Error('Apply the latest update in Settings to finish upgrading PoB AI.'), { restartRequested: true });
        try { return { ...await upgradeRunningService(current, { log, hops: hops + 1 }), restarted: true }; }
        catch (error) { throw Object.assign(error, { restartRequested: true }); }
      }
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw Object.assign(new Error('The update was requested. Restart PoB AI if the previous version is still shown.'), { restartRequested: true });
}
