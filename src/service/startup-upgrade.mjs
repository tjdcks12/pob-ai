// A newly unzipped release must not silently reuse an older service's UI.
// Use that service's verified updater so its launcher, data and open PoB bridge survive.
import { compareVersions, VERSION } from '../update/updater.mjs';
import { callService, serviceInfo } from './client.mjs';

export async function upgradeRunningService(info, { log = () => {} } = {}) {
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
  const result = await callService(info, 'update.apply', { restart: !busy });
  if (busy) {
    log('The update is prepared. Apply it in Settings after the AI turn or character refresh finishes.');
    return info;
  }
  if (!result.result?.restarting) throw new Error('Apply the newer release in Settings, then restart PoB AI.');
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const current = await serviceInfo();
    if (current) {
      try {
        const response = await fetch(`http://127.0.0.1:${current.port}/api/status`, {
          headers: { authorization: `Bearer ${current.token}` }, signal: AbortSignal.timeout(1500),
        });
        const next = await response.json();
        if (response.ok && /^\d+\.\d+\.\d+$/.test(next.version ?? '') && compareVersions(next.version, VERSION) >= 0) return { ...current, restarted: true };
      } catch { /* the old service may have closed between health and status */ }
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('The update was requested. Restart PoB AI if the previous version is still shown.');
}
