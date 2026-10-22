// Runs registry commands against the PoB window when it is connected, otherwise against
// the headless engine, whose current build is kept in the data folder between calls.
import fs from 'node:fs';
import { COMMANDS, findCommand, validateArgs } from './commands/registry.mjs';
import { Engine } from './engine/engine.mjs';
import { locatePob } from './pob/locate.mjs';
import { localizeResult, normalizeLocale, searchLocalized, toEnglish } from './i18n/terms.mjs';
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

  /** Forgets the install found earlier (PoB updated itself); the engine restarts on next use. */
  refreshInstall() {
    this.cachedInstall = null;
    this.engine?.stop();
    this.engine = null;
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

  /**
   * Commands run one at a time so a build never sees two edits interleaved. Game names may be
   * given in any supported language; with options.lang, results also carry localized names.
   */
  run(name, args = {}, options = {}) {
    const job = this.queue.then(async () => {
      const outcome = await this.#run(name, translateArgs(name, args), options);
      const lang = normalizeLocale(options.lang);
      return lang && lang !== 'en' ? { ...outcome, result: localizeResult(outcome.result, lang), lang } : outcome;
    });
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


// Arguments that name game things, and the kind of name each one is.
const NAME_ARGS = { node: 'passive', removeNode: 'passive', notable: 'passive', gem: 'name', name: 'name', base: 'name', class: 'name', ascendancy: 'name', rune: 'name' };
const SEARCH_ARGS = { 'tree.search': ['text', 'passive'], 'gems.search': ['text', 'name'], 'items.uniques': ['text', 'name'], 'items.bases': ['text', 'name'], 'items.runes': ['search', 'name'] };
// `name` only names a game thing for these commands (elsewhere it is a build or set name).
const GAME_NAME_COMMANDS = new Set(['items.add_unique', 'calc.whatif', 'calc.whatif_english']);

/** Localized names -> what PoB reads. Unknown or ASCII text passes through unchanged. */
export function translateArgs(name, args) {
  const out = { ...args };
  for (const [key, kind] of Object.entries(NAME_ARGS)) {
    if (key === 'name' && !GAME_NAME_COMMANDS.has(name)) continue;
    if (typeof out[key] !== 'string') continue;
    const hit = toEnglish(out[key], kind);
    if (hit) out[key] = hit.ids?.length === 1 ? String(hit.ids[0]) : hit.english;
  }
  if (Array.isArray(out.gems)) out.gems = out.gems.map(g => toEnglish(g, 'name')?.english ?? g);
  const search = SEARCH_ARGS[name];
  if (search && typeof out[search[0]] === 'string') {
    const found = searchLocalized(out[search[0]], search[1]);
    if (found) {
      out.match = search[1] === 'passive' ? found.ids.map(String) : found.names;
      out[search[0]] = '';
    }
  }
  return out;
}

export { COMMANDS };
