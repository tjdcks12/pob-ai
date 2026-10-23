// Runs the user's installed agent CLI (Claude Code or Codex) in non-interactive mode for each
// chat turn, streams its progress to the panel and keeps the conversation going with --resume.
// Several chats (panel tabs) can answer at the same time; each chat runs one turn at a time.
// A turn keeps running when the panel disconnects; only POST /api/agent/stop, deleting the chat
// or closing the service ends it early (the whole process tree, so .cmd shims leave nothing behind).
//
// Failures include a cause code and bounded, scrubbed CLI diagnostics for the panel and saved chat.
//   AGENT_MISSING       no executable found, or the chosen file is gone
//   AGENT_NOT_RUNNABLE  the executable could not be started or does not answer --version
//   AGENT_OUTDATED      the Codex CLI predates the supported thread/item JSON protocol
//   AGENT_SIGNED_OUT    the CLI ended without an answer and reported a sign-in problem
//   AGENT_FAILED        the CLI ended without an answer for another reason
//   AGENT_PATH_INVALID  a chosen path is not an existing absolute .exe, .cmd or .bat file
//   BUSY                this chat is still answering (or a file dialog is already open)
//   IMAGE_INVALID, IMAGE_TOO_MANY, IMAGE_TOO_LARGE, IMAGE_QUOTA, MODEL_INVALID, EFFORT_INVALID, BAD_REQUEST
//
// Endpoints (all behind the service token; errors are { ok: false, error: { code, diagnostic? } }):
//   GET    /api/agent/providers
//          -> { ok, providers: [{ id, label, command, source: 'custom'|'env'|'auto', available }] }
//   GET    /api/agent/providers/:id/models[?refresh=1]
//          -> { ok, models: [{ id, name, efforts: [..], defaultEffort|null }], defaultEffort: 'medium' }
//          Codex: read from its models_cache.json. Claude: asked once per executable over the
//          stream-json `initialize` control request (no sign-in or model call), then cached.
//          An empty list means "use the CLI's own default model".
//   POST   /api/agent/providers/:id/path   { path }   -> { ok, provider } | AGENT_PATH_INVALID, AGENT_NOT_RUNNABLE
//   DELETE /api/agent/providers/:id/path               -> { ok, provider }  (back to env / automatic discovery)
//   POST   /api/agent/providers/:id/pick   { title }  -> { ok, provider } | { ok: true, cancelled: true }
//          Opens the native file dialog (title already translated by the panel), then saves like /path.
//   POST   /api/agent/providers/:id/login             -> { ok }  Opens the CLI's own sign-in in a console window.
//   GET    /api/agent/sessions
//          -> { ok, sessions: [{ id, provider, title, createdAt, updatedAt, model, effort, turns, running }] }
//          Least recently used first; at most 50 are kept (older chats and their images are removed).
//   GET    /api/agent/sessions/:id         -> { ok, session: { ..., messages: [...] } }
//          user message:      { role: 'user', text, at, images?: [{ id, name, mediaType }] }
//          assistant message: { role: 'assistant', text, at, phases: [..], error?: code, delivery?: 'interrupted' }
//          (chats saved before phases have `tools`, a list of raw commands)
//   GET    /api/agent/sessions/:id/images/:imageId  -> the image bytes (content-type image/*)
//   GET    /api/agent/sessions/:id/stream  -> event stream of the turn that is running now: `start`, the
//          current `phase`, every text so far (full, not partial), then live events until `end`.
//          When nothing is running it sends only { type: 'end', sessionId, running: false }.
//   DELETE /api/agent/sessions/:id         -> { ok }  Stops a running turn and deletes the chat and its images.
//   POST   /api/agent/chat  { message, sessionId?, provider?, model?, effort?, fullAccess?, locale?, images?: [{ name, dataUrl }] }
//          -> event stream (text/event-stream, one JSON object per `data:` line); 400/409 JSON before it starts.
//          No sessionId starts a chat with `provider` (default claude). `model`/`effort` given on any message
//          are kept for the following turns of that chat; null goes back to the CLI default model / medium.
//          fullAccess is a boolean, defaults to false, and is remembered only for that chat.
//          Images: up to 4 PNG, JPEG, GIF or WebP data URLs, 5 MB each, 64 MB per chat. `message` may be
//          empty when images are attached.
//   POST   /api/agent/stop  { sessionId }  -> { ok, stopped }
//
// Events on a chat stream:
//   { type: 'start', sessionId, provider, model, effort, images }  images: the attachments as saved
//   { type: 'phase', phase }   inspect | calculate | lookup | compare | import | apply | show | writing | stopping
//   { type: 'text', id, text, partial: true }  append `text` to the message `id` (Claude streams these)
//   { type: 'text', id, text }                 the whole message `id`; replaces earlier pieces of it
//          The answer is every message joined with a blank line, in the order the ids first appeared.
//   { type: 'error', code, diagnostic? }
//   { type: 'end', sessionId, delivery?: 'interrupted' }
import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { findCommand } from '../commands/registry.mjs';
import { readJson, statePath, writeJson } from '../state.mjs';
import { agentWorkspace } from './instructions.mjs';
import { agentDiagnostic, classifyFailure, redactDiagnosticText } from './diagnostics.mjs';
export { classifyFailure } from './diagnostics.mjs';
import {
  DEFAULT_EFFORT, PROVIDERS, clearPath, codexModels, detectProviders, killTree, listModels, openLogin,
  pickPath, resolveProvider, setPath, spawnCli, validEffort, validModel, probeVersion, codexVersionSupported, MIN_CODEX_VERSION,
} from './providers.mjs';

const BIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../bin');
const SESSIONS_FILE = () => statePath('agent', 'sessions.json');
const IMAGES_DIR = id => statePath('agent', 'sessions', id, 'images');
const POB_TOOLS = ['Bash(pob:*)', 'Bash(pob *)', 'PowerShell(pob:*)', 'PowerShell(pob *)'];
const MAX_SESSIONS = 50;

const coded = (code, status = 400, diagnostic) => Object.assign(new Error(code), { code, status, diagnostic });

// ---- progress phases --------------------------------------------------------------------------

const IMPORTS = new Set(['build.import', 'build.open', 'build.load_xml', 'account.import', 'party.import', 'tree.url_import']);
const COMPARES = new Set(['calc.whatif', 'calc.whatif_english', 'calc.compare', 'calc.compare_xml', 'calc.node_power']);
const LOOKUPS = new Set(['tree.search', 'tree.node', 'gems.search', 'items.uniques', 'items.bases', 'items.trade', 'items.trade_query', 'engine.ops', 'character.classes']);

/** Names the step a shell command belongs to, so the panel never shows raw commands. */
export function phaseFor(command) {
  const match = String(command ?? '').match(/\bpob(?:\.mjs|\.cmd)?\s+([a-z-]+)(?:\s+([a-z-]+))?/);
  if (!match) return 'inspect';
  const [, group, action] = match;
  const found = (action && findCommand(`${group}.${action}`.replace(/-/g, '_'))) || findCommand(group.replace(/-/g, '_'));
  if (!found) return 'inspect';
  const name = found.name;
  if (name.startsWith('ui.')) return 'show';
  if (IMPORTS.has(name)) return 'import';
  if (found.mutates) return 'apply';
  if (COMPARES.has(name)) return 'compare';
  if (name.startsWith('calc.')) return 'calculate';
  if (LOOKUPS.has(name)) return 'lookup';
  return 'inspect';
}

// ---- CLI output ---------------------------------------------------------------------------------

/**
 * Turns one Claude stream-json line into internal events. `state` carries the id of the message
 * being streamed (from message_start) between calls.
 *   { type: 'session', providerSessionId } | { type: 'text', id, text, partial? } | { type: 'tool', command }
 *   | { type: 'result', ok, text, providerSessionId }
 */
export function parseClaudeLine(message, state = {}) {
  const out = [];
  if (message.type === 'system' && message.subtype === 'init') out.push({ type: 'session', providerSessionId: message.session_id });
  if (message.type === 'stream_event') {
    const event = message.event ?? {};
    if (event.type === 'message_start') state.messageId = event.message?.id ?? 'message';
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
      out.push({ type: 'text', id: state.messageId ?? 'message', text: event.delta.text, partial: true });
    }
  }
  // Claude reports API failures (expired sign-in, overload) as a made-up assistant message; never show it.
  if (message.type === 'assistant' && (message.error || message.is_api_error_message)) {
    out.push({ type: 'result', ok: false, text: [message.error, ...(message.message?.content ?? []).map(p => p.text)].filter(Boolean).join(': ') });
  } else if (message.type === 'assistant') {
    const content = message.message?.content ?? [];
    const text = content.filter(p => p.type === 'text').map(p => p.text).join('\n');
    if (text.trim()) out.push({ type: 'text', id: message.message?.id ?? state.messageId ?? 'message', text });
    for (const part of content) {
      if (part.type === 'tool_use') out.push({ type: 'tool', command: part.input?.command ?? part.name });
    }
  }
  if (message.type === 'result') out.push({ type: 'result', ok: !message.is_error, text: message.result, providerSessionId: message.session_id });
  return out;
}

/** The same for one `codex exec --json` line. Codex sends whole messages, never pieces. */
export function parseCodexLine(message) {
  const out = [];
  if (message.type === 'thread.started') out.push({ type: 'session', providerSessionId: message.thread_id });
  const item = message.item;
  if (item && message.type === 'item.started' && item.type === 'command_execution') out.push({ type: 'tool', command: item.command });
  if (item && message.type === 'item.completed' && item.type === 'agent_message' && item.text) out.push({ type: 'text', id: item.id, text: item.text });
  if (message.type === 'turn.completed') out.push({ type: 'result', ok: true });
  if (message.type === 'turn.failed' || message.type === 'error') out.push({ type: 'result', ok: false, text: message.error?.message ?? message.message });
  return out;
}

// ---- launching a turn ---------------------------------------------------------------------------

/** The effort sent to the CLI: the chosen one, else medium unless the chosen Codex model lacks it. */
export function effortFor({ provider, model, effort }, catalog = []) {
  if (effort) return effort;
  const info = provider === 'codex' && model ? catalog.find(m => m.id === model) : null;
  return info?.efforts.length && !info.efforts.includes(DEFAULT_EFFORT) ? null : DEFAULT_EFFORT;
}

/**
 * Command line and stdin for one turn.
 * turn: { provider, providerSessionId?, model?, effort?, fullAccess?, locale?, text, images?: [{ path, mediaType }] }
 */
export function buildTurn(turn, { catalog = [], readFile = fs.readFileSync } = {}) {
  const note = turn.locale ? `The user's interface language is ${turn.locale}. Reply in that language unless they write in another one.` : '';
  const effort = effortFor(turn, catalog);
  const images = turn.images ?? [];
  let text = String(turn.text ?? '');
  if (turn.provider === 'claude') {
    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages'];
    if (turn.fullAccess === true) args.push('--dangerously-skip-permissions');
    else args.push('--permission-mode', 'dontAsk', '--allowedTools', ...POB_TOOLS, '--disallowedTools', 'Edit', 'Write', 'NotebookEdit');
    if (note) args.push('--append-system-prompt', note);
    if (turn.providerSessionId) args.push('--resume', turn.providerSessionId);
    if (turn.model) args.push('--model', turn.model);
    if (effort) args.push('--effort', effort);
    // Images go in as base64 content blocks, like poe2way's claude_message.
    const content = images.map(image => ({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: readFile(image.path).toString('base64') } }));
    if (text) content.push({ type: 'text', text });
    const input = `${JSON.stringify({ type: 'user', session_id: turn.providerSessionId ?? '', parent_tool_use_id: null, message: { role: 'user', content } })}\n`;
    return { args, input };
  }
  // `exec resume` has no -s/--sandbox, so the sandbox is set with -c for both forms.
  // Older supported CLIs accept shared exec options only before the resume subcommand.
  const args = ['exec'];
  for (const image of images) args.push('-i', image.path); // each followed by a flag, so `-` stays the prompt
  args.push('--json', '--skip-git-repo-check');
  if (turn.fullAccess === true) args.push('--dangerously-bypass-approvals-and-sandbox');
  else args.push('-c', 'sandbox_mode="workspace-write"', '-c', 'sandbox_workspace_write.network_access=true');
  if (turn.model) args.push('-m', turn.model);
  if (effort) args.push('-c', `model_reasoning_effort="${effort}"`);
  if (turn.providerSessionId) args.push('resume', turn.providerSessionId);
  args.push('-');
  if (note && !turn.providerSessionId) text = `${note}\n\n${text}`;
  return { args, input: text };
}

// ---- images -------------------------------------------------------------------------------------

const IMAGE_TYPES = {
  'image/png': { ext: 'png', ok: b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/jpeg': { ext: 'jpg', ok: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/gif': { ext: 'gif', ok: b => /^GIF8[79]a/.test(b.subarray(0, 6).toString('latin1')) },
  'image/webp': { ext: 'webp', ok: b => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
};
const MAX_IMAGE = 5 * 1024 * 1024;
const MAX_IMAGES_PER_CHAT = 64 * 1024 * 1024;

/** Checks attached data URLs (count, type by content, size) and decodes them. Never takes paths. */
export function prepareImages(inputs) {
  if (inputs == null) return [];
  if (!Array.isArray(inputs)) throw coded('IMAGE_INVALID');
  if (inputs.length > 4) throw coded('IMAGE_TOO_MANY');
  return inputs.map(input => {
    const name = typeof input?.name === 'string' && input.name.length <= 512 && !/[\x00-\x1f]/.test(input.name) ? input.name : 'image';
    const dataUrl = String(input?.dataUrl ?? '');
    if (dataUrl.length > Math.ceil(MAX_IMAGE / 3) * 4 + 64) throw coded('IMAGE_TOO_LARGE');
    const match = dataUrl.match(/^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=\s]+)$/);
    const type = match && IMAGE_TYPES[match[1]];
    if (!type) throw coded('IMAGE_INVALID');
    const bytes = Buffer.from(match[2], 'base64');
    if (!bytes.length) throw coded('IMAGE_INVALID');
    if (bytes.length > MAX_IMAGE) throw coded('IMAGE_TOO_LARGE');
    if (!type.ok(bytes)) throw coded('IMAGE_INVALID');
    const id = createHash('sha256').update(bytes).digest('hex');
    return { id, name, mediaType: match[1], file: `${id}.${type.ext}`, bytes };
  });
}

function saveImages(dir, prepared) {
  if (!prepared.length) return;
  fs.mkdirSync(dir, { recursive: true });
  const used = fs.readdirSync(dir).reduce((sum, f) => sum + fs.statSync(path.join(dir, f)).size, 0);
  const added = prepared.filter(p => !fs.existsSync(path.join(dir, p.file))).reduce((sum, p) => sum + p.bytes.length, 0);
  if (used + added > MAX_IMAGES_PER_CHAT) throw coded('IMAGE_QUOTA');
  for (const p of prepared) if (!fs.existsSync(path.join(dir, p.file))) fs.writeFileSync(path.join(dir, p.file), p.bytes);
}

const imageFile = (sessionId, image) => path.join(IMAGES_DIR(sessionId), `${image.id}.${IMAGE_TYPES[image.mediaType].ext}`);

// ---- the hub ------------------------------------------------------------------------------------

const sse = res => res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
const write = (res, event) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`); };

export class AgentHub {
  constructor(service) {
    this.service = service;
    this.running = new Map(); // session id -> turn
    this.sessions = readJson(SESSIONS_FILE(), []);
  }

  log(line) { this.service?.log?.(line); }

  providers() { return detectProviders(); }

  #save() {
    while (this.sessions.length > MAX_SESSIONS) {
      const index = this.sessions.findIndex(s => !this.running.has(s.id));
      if (index < 0) break;
      const [old] = this.sessions.splice(index, 1);
      fs.rmSync(path.dirname(IMAGES_DIR(old.id)), { recursive: true, force: true });
    }
    writeJson(SESSIONS_FILE(), this.sessions);
  }

  #emit(turn, event) {
    if (event.type === 'phase') turn.phase = event.phase;
    for (const res of turn.listeners) write(res, event);
  }

  #phase(turn, phase) {
    if (turn.phase === phase || (turn.stopping && phase !== 'stopping')) return;
    if (!['writing', 'stopping'].includes(phase) && turn.reply.phases.at(-1) !== phase) turn.reply.phases.push(phase);
    this.#emit(turn, { type: 'phase', phase });
  }

  /** Validates a chat request; everything here fails before the event stream starts. */
  #prepare(body) {
    const message = typeof body.message === 'string' ? body.message : '';
    const images = prepareImages(body.images);
    if (!message.trim() && !images.length) throw coded('BAD_REQUEST');
    let session = body.sessionId ? this.sessions.find(s => s.id === body.sessionId) : null;
    if (body.sessionId && !session) throw coded('NOT_FOUND', 404);
    const provider = session?.provider ?? body.provider ?? 'claude';
    if (!PROVIDERS[provider]) throw coded('BAD_REQUEST');
    if (session && this.running.has(session.id)) throw coded('BUSY', 409);
    const model = body.model !== undefined ? (body.model || null) : (session?.model ?? null);
    const effort = body.effort !== undefined ? (body.effort || null) : (session?.effort ?? null);
    if (body.fullAccess !== undefined && typeof body.fullAccess !== 'boolean') throw coded('BAD_REQUEST');
    const fullAccess = body.fullAccess ?? (session?.fullAccess === true);
    if (model && !validModel(model)) throw coded('MODEL_INVALID');
    if (effort && !validEffort(provider, effort)) throw coded('EFFORT_INVALID');
    const catalog = provider === 'codex' ? codexModels() : [];
    const info = model && catalog.find(m => m.id === model);
    if (info && effort && info.efforts.length && !info.efforts.includes(effort)) throw coded('EFFORT_INVALID');
    return { message, images, session, provider, model, effort, fullAccess, catalog };
  }

  /** Streams one chat turn as server-sent events. */
  async chat(body, res) {
    const { message, images, provider, model, effort, fullAccess, catalog, ...rest } = this.#prepare(body);
    const command = resolveProvider(provider);
    let version = null;
    const diagnostic = extra => agentDiagnostic({ provider, command: command.command, version, ...extra });
    if (!command.available) throw coded('AGENT_MISSING', 400, diagnostic({}));
    version = await probeVersion(command.command);
    if (!version) throw coded('AGENT_NOT_RUNNABLE', 400, diagnostic({}));
    if (provider === 'codex' && !codexVersionSupported(version)) {
      this.log(`agent codex: CLI ${version} needs an update (requires ${MIN_CODEX_VERSION} or newer)`);
      throw coded('AGENT_OUTDATED', 400, diagnostic({ minimumVersion: MIN_CODEX_VERSION }));
    }
    // Version probing awaits a process: another request may start or remove this chat meanwhile.
    if (rest.session && !this.sessions.includes(rest.session)) throw coded('NOT_FOUND', 404);
    if (rest.session && this.running.has(rest.session.id)) throw coded('BUSY', 409);
    let session = rest.session;
    const isNew = !session;
    if (isNew) {
      const now = new Date().toISOString();
      session = { id: randomUUID(), provider, title: (message.trim() || images[0].name).slice(0, 60), createdAt: now, updatedAt: now, messages: [] };
    }
    saveImages(IMAGES_DIR(session.id), images);
    if (isNew) this.sessions.push(session);
    Object.assign(session, { model, effort, fullAccess });

    const attachments = images.map(({ id, name, mediaType }) => ({ id, name, mediaType }));
    const userMessage = { role: 'user', text: message, at: new Date().toISOString(), ...(attachments.length ? { images: attachments } : {}) };
    const reply = { role: 'assistant', text: '', phases: [], at: null };
    const turn = { sessionId: session.id, child: null, listeners: new Set([res]), texts: new Map(), phase: null, stopping: false, reply, start: null };
    this.running.set(session.id, turn);
    res.on('close', () => turn.listeners.delete(res));
    sse(res);
    turn.start = { type: 'start', sessionId: session.id, provider, model, effort, fullAccess, images: attachments };
    this.#emit(turn, turn.start);

    const finish = (extra = {}) => {
      this.running.delete(session.id);
      this.#emit(turn, { type: 'end', sessionId: session.id, ...extra });
      for (const listener of turn.listeners) listener.end();
    };

    const { args, input } = buildTurn({
      provider, providerSessionId: session.providerSessionId, model, effort, fullAccess, locale: body.locale, text: message,
      images: attachments.map(image => ({ path: imageFile(session.id, image), mediaType: image.mediaType })),
    }, { catalog });
    const env = { ...process.env, PATH: `${BIN_DIR}${path.delimiter}${process.env.PATH}`, POB_AI_LOCALE: body.locale ?? '' };
    let child;
    try {
      child = spawnCli(command.command, args, { cwd: agentWorkspace(), env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      this.log(`agent ${provider}: could not start: ${redactDiagnosticText(error.message)}`);
      this.#rollback(session, isNew);
      this.#emit(turn, { type: 'error', code: 'AGENT_NOT_RUNNABLE', diagnostic: diagnostic({ details: [error.message] }) });
      return finish();
    }
    turn.child = child;
    session.messages.push(userMessage);

    const parse = provider === 'claude' ? parseClaudeLine : parseCodexLine;
    const parseState = {};
    const stderr = [];
    const failures = [];
    const events = Object.create(null);
    let spawnError = null;
    let resultOk = null;
    child.on('error', error => { spawnError = error; });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
    readline.createInterface({ input: child.stderr }).on('line', line => { stderr.push(line); if (stderr.length > 40) stderr.shift(); });
    readline.createInterface({ input: child.stdout }).on('line', line => {
      let parsed;
      try { parsed = JSON.parse(line); } catch { events.nonJson = (events.nonJson ?? 0) + 1; return; }
      if (!parsed || typeof parsed !== 'object') { events.unknown = (events.unknown ?? 0) + 1; return; }
      const kind = parsed.type ?? (parsed.msg?.type ? `legacy:${parsed.msg.type}` : 'unknown');
      if (/^[\w.:-]{1,64}$/.test(kind) && (kind in events || Object.keys(events).length < 20)) events[kind] = (events[kind] ?? 0) + 1;
      for (const event of parse(parsed, parseState)) {
        if (event.providerSessionId) session.providerSessionId = event.providerSessionId;
        if (event.type === 'tool') this.#phase(turn, phaseFor(event.command));
        if (event.type === 'text') this.#text(turn, event);
        if (event.type === 'result') {
          resultOk = event.ok;
          if (!event.ok) failures.push(event.text);
          else if (!turn.texts.size && event.text) this.#text(turn, { type: 'text', id: 'result', text: event.text });
        }
      }
    });
    await new Promise(resolve => { child.on('close', resolve); child.on('error', resolve); });

    reply.at = new Date().toISOString();
    reply.text = [...turn.texts.values()].filter(t => t.trim()).join('\n\n');
    let error = null;
    if (turn.stopping) reply.delivery = 'interrupted';
    else if (spawnError) error = 'AGENT_NOT_RUNNABLE';
    else if (!reply.text || resultOk === false || child.exitCode !== 0) error = classifyFailure([...failures, ...stderr], { exitCode: child.exitCode, eventCount: Object.keys(events).length });
    if (error || resultOk === false) {
      this.log(`agent ${provider}: turn ended ${error ?? 'with an error'} (exit ${child.exitCode})${spawnError ? `: ${redactDiagnosticText(spawnError.message)}` : ''}`);
      for (const line of [...failures.filter(Boolean), ...stderr.slice(-5)]) this.log(`agent ${provider}: ${redactDiagnosticText(line).slice(0, 500)}`);
    }
    if (error) {
      reply.error = error;
      reply.diagnostic = diagnostic({ exitCode: child.exitCode, signal: child.signalCode, details: [...failures, ...stderr, spawnError?.message], events });
      this.#emit(turn, { type: 'error', code: error, diagnostic: reply.diagnostic });
    }
    session.messages.push(reply);
    session.updatedAt = reply.at;
    if (this.sessions.includes(session)) { // not deleted while it was answering
      this.sessions = [...this.sessions.filter(s => s !== session), session]; // most recently used last
      this.#save();
    }
    finish(reply.delivery ? { delivery: reply.delivery } : {});
  }

  #text(turn, event) {
    this.#phase(turn, 'writing');
    const previous = turn.texts.get(event.id) ?? '';
    turn.texts.set(event.id, event.partial ? previous + event.text : event.text);
    this.#emit(turn, event.partial ? { type: 'text', id: event.id, text: event.text, partial: true } : { type: 'text', id: event.id, text: event.text });
  }

  #rollback(session, isNew) {
    if (isNew) {
      this.sessions = this.sessions.filter(s => s !== session);
      fs.rmSync(path.dirname(IMAGES_DIR(session.id)), { recursive: true, force: true });
    }
  }

  /** Lets another panel tab follow a running turn. */
  #attach(sessionId, req, res) {
    const turn = this.running.get(sessionId);
    sse(res);
    if (!turn) { write(res, { type: 'end', sessionId, running: false }); return res.end(); }
    write(res, turn.start);
    if (turn.phase) write(res, { type: 'phase', phase: turn.phase });
    for (const [id, text] of turn.texts) write(res, { type: 'text', id, text });
    turn.listeners.add(res);
    req.on('close', () => turn.listeners.delete(res));
  }

  stop(sessionId) {
    const turn = this.running.get(sessionId);
    if (!turn?.child) return false;
    turn.stopping = true;
    this.#phase(turn, 'stopping');
    killTree(turn.child);
    return true;
  }

  async handle(req, res, url, { send, readBody }) {
    const route = `${req.method} ${url.pathname}`;
    const failed = (error, status = 200) => send(res, error.status ?? status, { ok: false, error: { code: error.code ?? 'ERROR', ...(error.diagnostic ? { diagnostic: error.diagnostic } : {}) } });
    if (route === 'GET /api/agent/providers') return send(res, 200, { ok: true, providers: detectProviders({ refresh: true }) });

    const provider = url.pathname.match(/^\/api\/agent\/providers\/([a-z]+)\/(models|path|pick|login)$/);
    if (provider) {
      const [, id, action] = provider;
      if (!PROVIDERS[id]) return send(res, 404, { ok: false, error: { code: 'NOT_FOUND' } });
      try {
        if (action === 'models' && req.method === 'GET') {
          const models = await listModels(id, { refresh: url.searchParams.get('refresh') === '1', cwd: agentWorkspace(), log: line => this.log(line) });
          return send(res, 200, { ok: true, models, defaultEffort: DEFAULT_EFFORT });
        }
        if (action === 'path' && req.method === 'POST') return send(res, 200, { ok: true, provider: await setPath(id, (await readBody(req)).path) });
        if (action === 'path' && req.method === 'DELETE') return send(res, 200, { ok: true, provider: clearPath(id) });
        if (action === 'pick' && req.method === 'POST') {
          const file = await pickPath(id, (await readBody(req)).title);
          return send(res, 200, file ? { ok: true, provider: await setPath(id, file) } : { ok: true, cancelled: true });
        }
        if (action === 'login' && req.method === 'POST') { openLogin(id); return send(res, 200, { ok: true }); }
      } catch (error) {
        if (!error.code) this.log(`agent ${id} ${action}: ${error.stack ?? error}`);
        return failed(error);
      }
    }

    if (route === 'GET /api/agent/sessions') {
      return send(res, 200, { ok: true, sessions: this.sessions.map(({ messages, providerSessionId, ...s }) => ({ ...s, updatedAt: s.updatedAt ?? s.createdAt, model: s.model ?? null, effort: s.effort ?? null, fullAccess: s.fullAccess === true, turns: messages.length, running: this.running.has(s.id) })) });
    }
    const image = url.pathname.match(/^\/api\/agent\/sessions\/([\w-]+)\/images\/([0-9a-f]{64})$/);
    if (image && req.method === 'GET') {
      const found = this.sessions.find(s => s.id === image[1])?.messages.flatMap(m => m.images ?? []).find(i => i.id === image[2]);
      if (!found || !fs.existsSync(imageFile(image[1], found))) return send(res, 404, { ok: false, error: { code: 'NOT_FOUND' } });
      res.writeHead(200, { 'content-type': found.mediaType, 'cache-control': 'private, max-age=86400' });
      return res.end(fs.readFileSync(imageFile(image[1], found)));
    }
    const stream = url.pathname.match(/^\/api\/agent\/sessions\/([\w-]+)\/stream$/);
    if (stream && req.method === 'GET') return this.#attach(stream[1], req, res);
    const match = url.pathname.match(/^\/api\/agent\/sessions\/([\w-]+)$/);
    if (match && req.method === 'GET') {
      const session = this.sessions.find(s => s.id === match[1]);
      return session ? send(res, 200, { ok: true, session: { ...session, fullAccess: session.fullAccess === true, running: this.running.has(session.id) } }) : send(res, 404, { ok: false, error: { code: 'NOT_FOUND' } });
    }
    if (match && req.method === 'DELETE') {
      this.stop(match[1]);
      this.sessions = this.sessions.filter(s => s.id !== match[1]);
      fs.rmSync(path.dirname(IMAGES_DIR(match[1])), { recursive: true, force: true });
      this.#save();
      return send(res, 200, { ok: true });
    }
    if (route === 'POST /api/agent/chat') {
      const body = await readBody(req);
      try { return await this.chat(body, res); } catch (error) {
        if (!error.code) this.log(`agent chat: ${error.stack ?? error}`);
        if (!res.headersSent) return failed(error, 500);
        return res.end();
      }
    }
    if (route === 'POST /api/agent/stop') {
      const body = await readBody(req);
      return send(res, 200, { ok: true, stopped: this.stop(body.sessionId) });
    }
    return send(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: route } });
  }

  close() { for (const turn of this.running.values()) killTree(turn.child, { sync: true }); }
}
