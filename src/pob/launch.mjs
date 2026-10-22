// Starts the user's PoB window with the PoB AI shim as its entry script.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { ADAPTER_DIR } from '../engine/engine.mjs';
import { readConfig } from '../state.mjs';
import { EXE_NAME } from './locate.mjs';

/**
 * @param {{ dir: string }} install
 * @param {{ port: number, token: string }} bridge
 * @param {{ buildFile?: string }} options
 */
export function launchPob(install, bridge, { buildFile } = {}) {
  const args = [path.join(ADAPTER_DIR, 'shim.lua')];
  if (buildFile) args.push(buildFile);
  const child = spawn(path.join(install.dir, EXE_NAME), args, {
    cwd: install.dir,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, POBAI_BRIDGE_PORT: String(bridge.port), POBAI_BRIDGE_TOKEN: bridge.token, POBAI_THEME: readConfig().pobTheme ?? '' },
  });
  child.unref();
  return child;
}
