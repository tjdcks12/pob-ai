import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readConfig, statePath, updateConfig } from '../state.mjs';

const paused = new Map([
  ['LIVE_REQUIRED', 'waiting'], ['NOT_SIGNED_IN', 'signIn'], ['UNSAVED', 'unsaved'],
  ['SYNC_BUILD_CHANGED', 'differentBuild'], ['SYNC_FILE_CHANGED', 'changed'],
  ['UNKNOWN_OPERATION', 'restart'], ['UNKNOWN_OP', 'restart'],
  ['SYNC_SKILL_CHANGED', 'skillChanged'],
  ['SYNC_ROLLBACK_FAILED', 'recovery'],
]);
export class CharacterSync {
  constructor({ runtime, read = readConfig, write = updateConfig, broadcast = () => {}, now = Date.now,
    timer = setTimeout, cancel = clearTimeout, autoStart = true, backup } = {}) {
    Object.assign(this, { runtime, read, write, broadcast, now, timer, cancel });
    this.backup = backup ?? (file => {
      const bytes = fs.readFileSync(file);
      const key = createHash('sha256').update(file.toLowerCase()).digest('hex');
      const target = statePath('backups', 'character-sync', key + '.xml');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const temp = target + '.tmp'; fs.writeFileSync(temp, bytes); fs.renameSync(temp, target);
      return target;
    });
    const initial = read().characterSync;
    this.state = { phase: initial?.recoveryRequired ? 'recovery' : initial?.enabled ? 'ready' : 'off', running: false, revision: 0 };
    this.generation = 0;
    if (autoStart) this.schedule();
  }
  config() {
    const saved = this.read().characterSync ?? {};
    return { enabled: saved.enabled === true, character: typeof saved.character === 'string' ? saved.character : '',
      file: typeof saved.file === 'string' ? saved.file : '', characterId: saved.characterId,
      intervalSeconds: [60, 120, 300, 600].includes(saved.intervalSeconds) ? saved.intervalSeconds : 120 };
  }
  status() { return { ...this.config(), ...this.state }; }
  emit(patch) { Object.assign(this.state, patch); this.state.revision++; this.broadcast('character-sync', this.status()); }
  async context(reload = false) {
    try { return (await this.runtime.run('account.sync_context', { reload }, { target: 'live' })).result; }
    catch (error) { return { available: false, phase: paused.get(error.code) ?? 'restart' }; }
  }
  async configure(patch) {
    if (this.inflight && patch.enabled !== false) throw Object.assign(new Error('Refresh is running'), { code: 'SYNC_BUSY' });
    const current = this.config();
    const intervalSeconds = patch.intervalSeconds ?? current.intervalSeconds;
    if (![60, 120, 300, 600].includes(intervalSeconds)) throw Object.assign(new Error('Invalid refresh interval'), { code: 'BAD_INTERVAL' });
    let next = { ...current, intervalSeconds, enabled: patch.enabled === true, recoveryRequired: false };
    if (next.enabled) {
      let context = await this.context();
      if (!context.characters?.length && context.signedIn) context = await this.context(true);
      if (!context.available) throw Object.assign(new Error('Reconnect PoB to use character refresh'), { code: context.phase === 'waiting' ? 'LIVE_REQUIRED' : 'RESTART_REQUIRED' });
      if (!context.signedIn) throw Object.assign(new Error('Sign in to Path of Exile in PoB first'), { code: 'NOT_SIGNED_IN' });
      if (!context.file || context.unsaved) throw Object.assign(new Error('Save the open PoB build first'), { code: 'UNSAVED' });
      const character = patch.character || current.character || context.suggestedCharacter;
      const selected = context.characters?.find(entry => entry.name === character);
      if (!selected) throw Object.assign(new Error('Select a character from the account'), { code: 'CHARACTER_REQUIRED' });
      next = { ...next, file: context.file, character: selected.name, characterId: selected.id };
    }
    this.generation++;
    this.write({ characterSync: next });
    this.failures = 0;
    this.emit({ phase: next.enabled ? 'ready' : 'off', error: undefined, retryAt: undefined,
      file: next.file, character: next.character, snapshotHash: undefined, fileHash: undefined });
    this.schedule(next.enabled ? 0 : undefined);
    return this.status();
  }
  schedule(delay) {
    if (this.timeout) this.cancel(this.timeout);
    this.timeout = null;
    const config = this.config();
    if (this.closed || !config.enabled) return;
    const wait = delay ?? Math.max(config.intervalSeconds * 1000, (this.state.retryAt ?? 0) - this.now());
    this.timeout = this.timer(() => { this.timeout = null; void this.refresh(); }, wait);
    this.timeout?.unref?.();
  }
  refresh() {
    if (this.inflight) return this.inflight;
    const config = this.config(), generation = this.generation;
    if (!config.enabled || !config.file || !config.character || this.closed) return Promise.resolve(this.status());
    this.inflight = (async () => {
      this.emit({ running: true, phase: 'refreshing', lastAttemptAt: this.now() });
      try {
        const context = await this.context();
        if (!context.available) throw Object.assign(new Error('PoB is not ready'), { code: context.phase === 'waiting' ? 'LIVE_REQUIRED' : 'UNKNOWN_OPERATION' });
        if (!context.signedIn) throw Object.assign(new Error('Sign-in required'), { code: 'NOT_SIGNED_IN' });
        if (context.unsaved) throw Object.assign(new Error('Unsaved changes'), { code: 'UNSAVED' });
        if (context.file?.replaceAll('\\', '/').toLowerCase() !== config.file.replaceAll('\\', '/').toLowerCase()) throw Object.assign(new Error('Another build is open'), { code: 'SYNC_BUILD_CHANGED' });
        if (generation !== this.generation || !this.config().enabled) return this.status();
        this.backup(config.file);
        const previous = this.state.file === config.file && this.state.character === config.character ? this.state : {};
        const { result } = await this.runtime.run('account.refresh', { file: config.file, character: config.character,
          ...(config.characterId ? { characterId: config.characterId } : {}),
          ...(previous.snapshotHash ? { previousHash: previous.snapshotHash, previousFileHash: previous.fileHash } : {}) }, { target: 'live' });
        if (generation === this.generation) {
          this.failures = 0;
          this.emit({ phase: result.unchanged ? 'unchanged' : 'updated', lastSuccessAt: this.now(), error: undefined,
            retryAt: undefined,
            file: config.file, character: config.character, snapshotHash: result.snapshotHash, fileHash: result.fileHash });
          if (!result.unchanged) this.broadcast('build-changed', { command: 'account.refresh', file: result.file });
        }
      } catch (error) {
        if (generation === this.generation) {
          const phase = paused.get(error.code) ?? 'error';
          if (phase === 'recovery') this.write({ characterSync: { ...config, enabled: false, recoveryRequired: true } });
          this.failures = phase === 'error' ? (this.failures ?? 0) + 1 : 0;
          this.emit({ phase, error: error.code ?? 'REFRESH_FAILED', retryAt: this.failures
            ? this.now() + Math.min(1800000, config.intervalSeconds * 1000 * 2 ** Math.min(this.failures, 5)) : undefined });
        }
      } finally { this.emit({ running: false }); }
      return this.status();
    })().finally(() => { this.inflight = null; this.schedule(); });
    return this.inflight;
  }
  close() { this.closed = true; this.generation++; if (this.timeout) this.cancel(this.timeout); this.timeout = null; }
}
