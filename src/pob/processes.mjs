// Running PoB windows, to tell the one PoB AI opened from a plain one (PoB's updater starts PoB
// again without the shim after a "basic" self-update).
import { execFile } from 'node:child_process';
import path from 'node:path';
import { EXE_NAME } from './locate.mjs';

const run = (file, args) => new Promise(resolve => {
  execFile(file, args, { windowsHide: true, encoding: 'utf8' }, (error, stdout) => resolve(error ? '' : stdout));
});

/** @returns {Promise<{ pid: number, exe: string, commandLine: string, shim: boolean }[]>} */
export async function listPobProcesses(install) {
  const script = `Get-CimInstance Win32_Process -Filter "Name='${EXE_NAME}'" | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress`;
  const out = (await run('powershell.exe', ['-NoProfile', '-Command', script])).trim();
  if (!out) return [];
  const rows = [].concat(JSON.parse(out));
  const exe = path.join(install.dir, EXE_NAME).toLowerCase();
  return rows
    .filter(row => String(row.ExecutablePath ?? '').toLowerCase() === exe)
    .map(row => ({ pid: row.ProcessId, exe: row.ExecutablePath, commandLine: row.CommandLine ?? '', shim: /shim\.lua/i.test(row.CommandLine ?? '') }));
}

const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** Asks a PoB window to close (PoB saves its settings), and ends it if it does not. */
export async function closePob(pid, { graceMs = 10000 } = {}) {
  await run('taskkill.exe', ['/PID', String(pid)]);
  const deadline = Date.now() + graceMs;
  while (alive(pid) && Date.now() < deadline) await new Promise(r => setTimeout(r, 250));
  if (alive(pid)) await run('taskkill.exe', ['/F', '/PID', String(pid)]);
}
