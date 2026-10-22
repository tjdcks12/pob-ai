// Headless PoB engine: a child process running the user's PoB without a window.
import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { asciiPath } from '../pob/locate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ADAPTER_DIR = path.resolve(here, '../../adapter');
const WORKER = path.join(here, 'worker.mjs');

export class Engine {
  /** @param {{ dir: string }} install result of locatePob() */
  constructor(install, { log = () => {} } = {}) {
    this.install = install;
    this.log = log;
    this.nextId = 1;
    this.pending = new Map();
    this.ready = null;
  }

  start() {
    if (this.ready) return this.ready;
    const root = asciiPath(this.install.dir);
    this.root = root;
    const adapter = asciiPath(ADAPTER_DIR);
    this.child = spawn(process.execPath, [WORKER, root, adapter], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    readline.createInterface({ input: this.child.stderr }).on('line', line => this.log(line));
    this.ready = new Promise((resolve, reject) => {
      this.pending.set(0, { resolve, reject });
      this.child.once('exit', code => {
        const error = Object.assign(new Error(`PoB engine stopped (exit ${code}).`), { code: 'ENGINE_EXIT' });
        for (const { reject: fail } of this.pending.values()) fail(error);
        this.pending.clear();
        this.ready = null;
      });
    });
    readline.createInterface({ input: this.child.stdout }).on('line', line => {
      let message;
      try { message = JSON.parse(line); } catch { this.log(`engine: ${line}`); return; }
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.ok) waiter.resolve(message.result);
      else waiter.reject(Object.assign(new Error(message.error?.message || 'PoB engine error'), message.error));
    });
    return this.ready;
  }

  /** Runs one adapter operation, e.g. call('build.summary', {}). */
  async call(op, args = {}) {
    await this.start();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(JSON.stringify({ id, op, args }) + '\n');
    });
  }

  stop() {
    this.child?.stdin.end();
    this.child = null;
    this.ready = null;
  }
}
