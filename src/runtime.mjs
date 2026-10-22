// Runs registry commands against the PoB window when it is connected, otherwise against
// the headless engine, whose current build is kept in the data folder between calls.
import fs from 'node:fs';
import { COMMANDS, findCommand, validateArgs } from './commands/registry.mjs';
import { Engine } from './engine/engine.mjs';
import { locatePob } from './pob/locate.mjs';
import { readJson, statePath, writeJson } from './state.mjs';

export class CommandError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export class Runtime {
  /** @param {{ bridge?: import('./live/bridge-server.mjs').BridgeServer, log?: (line: string) => void }} options */
  constructor({ bridge, log = () => {} } = {}) {
    this.bridge = bridge;
    this.log = log;
    this.engine = null;
    this.sessionFile = statePath('session', 'current.xml');
    this.queue = Promise.resolve();
  }

  install() {
    if (!this.cachedInstall) this.cachedInstall = locatePob();
    return this.cachedInstall;
  }

  async #engine() {
    if (this.engine) return this.engine;
    this.engine = new Engine(this.install(), { log: this.log });
    await this.engine.start();
    if (fs.existsSync(this.sessionFile)) {
      try {
        const meta = readJson(statePath('session', 'meta.json'), {});
        await this.engine.call('build.load', { xml: fs.readFileSync(this.sessionFile, 'utf8'), name: meta.name, file: meta.file });
      } catch (error) {
        this.log(`Could not restore the headless session build: ${error.message}`);
      }
    }
    return this.engine;
  }

  get liveConnected() { return Boolean(this.bridge?.connected); }

  /** Commands run one at a time so a build never sees two edits interleaved. */
  run(name, args = {}, options = {}) {
    const job = this.queue.then(() => this.#run(name, args, options));
    this.queue = job.catch(() => {});
    return job;
  }

  async #run(name, rawArgs, { target } = {}) {
    const command = findCommand(name);
    if (!command) throw new CommandError('UNKNOWN_COMMAND', `Unknown command: ${name}. Run \`pob help\` for the list.`);
    const args = validateArgs(command, rawArgs);
    if (command.local) {
      // Node-side commands call other commands inside the same queue slot; queuing them
      // again would wait for this very job.
      const nested = Object.create(this, { run: { value: (n, a = {}, o = {}) => this.#run(n, a, { target, ...o }) } });
      return command.local(args, nested);
    }
    const live = target === 'headless' ? false : this.liveConnected;
    if (command.live && !live) {
      throw new CommandError('LIVE_REQUIRED', `${command.name} needs the PoB window. Start it with \`pob open\`.`);
    }
    if (live) {
      const result = await this.bridge.call(command.op ?? command.name, args, { timeoutMs: command.timeoutMs });
      return { target: 'live', result };
    }
    const engine = await this.#engine();
    const result = await engine.call(command.op ?? command.name, args);
    if (command.mutates) await this.#saveSession(engine);
    return { target: 'headless', result: this.#realPaths(engine, result) };
  }

  /** The engine sees PoB through an ASCII junction; report the user's real folder instead. */
  #realPaths(engine, result) {
    const real = this.install().dir;
    if (!engine.root || engine.root === real) return result;
    const fwd = p => p.split('\\').join('/');
    let text = JSON.stringify(result);
    for (const [from, to] of [[fwd(engine.root), fwd(real)], [engine.root, real]]) {
      text = text.split(JSON.stringify(from).slice(1, -1)).join(JSON.stringify(to).slice(1, -1));
    }
    return JSON.parse(text);
  }

  async #saveSession(engine) {
    const { xml, name, file } = await engine.call('build.xml', {});
    fs.mkdirSync(statePath('session'), { recursive: true });
    fs.writeFileSync(this.sessionFile, xml);
    writeJson(statePath('session', 'meta.json'), { name, file });
  }

  close() { this.engine?.stop(); }
}


export { COMMANDS };
