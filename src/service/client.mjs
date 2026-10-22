// Finds the running PoB AI service and calls it. The address and token live in the data folder.
import { readJson, statePath } from '../state.mjs';

export const SERVICE_FILE = () => statePath('service.json');

/** Returns { port, token } when a service answers, otherwise null. */
export async function serviceInfo() {
  const info = readJson(SERVICE_FILE(), null);
  if (!info?.port || !info?.token) return null;
  try {
    const response = await fetch(`http://127.0.0.1:${info.port}/api/health`, {
      headers: { authorization: `Bearer ${info.token}` }, signal: AbortSignal.timeout(1500),
    });
    return response.ok ? info : null;
  } catch { return null; }
}

export async function callService(info, command, args, target) {
  const response = await fetch(`http://127.0.0.1:${info.port}/api/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${info.token}` },
    body: JSON.stringify({ command, args, target }),
  });
  const body = await response.json();
  if (!body.ok) throw Object.assign(new Error(body.error?.message ?? 'Service error'), body.error ?? {});
  const { ok: _ok, ...outcome } = body;
  return outcome;
}
