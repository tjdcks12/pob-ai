// Runs the user's installed agent CLI (Claude Code or Codex) in non-interactive mode for each
// chat turn, streams its progress to the panel and keeps the conversation going with --resume.
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { readJson, statePath, writeJson } from '../state.mjs';
import { agentWorkspace } from './instructions.mjs';
import { detectProviders } from './providers.mjs';

const BIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../bin');
const SESSIONS_FILE = () => statePath('agent', 'sessions.json');
const POB_TOOLS = ['Bash(pob:*)', 'Bash(pob *)', 'PowerShell(pob:*)', 'PowerShell(pob *)'];

const quoteForCmd = arg => `"${String(arg).replace(/"/g, '""')}"`;

/** Turns one provider JSON line into panel events. */
export function parseClaudeLine(message) {
  const out = [];
  if (message.type === 'system' && message.subtype === 'init') out.push({ type: 'session', providerSessionId: message.session_id });
  if (message.type === 'assistant') {
    for (const part of message.message?.content ?? []) {
      if (part.type === 'text' && part.text.trim()) out.push({ type: 'text', text: part.text });
      if (part.type === 'tool_use') out.push({ type: 'tool', id: part.id, name: part.name, command: part.input?.command ?? part.input?.description ?? JSON.stringify(part.input) });
    }
  }
  if (message.type === 'user') {
    for (const part of message.message?.content ?? []) {
      if (part.type === 'tool_result') {
        const text = Array.isArray(part.content) ? part.content.map(c => c.text ?? '').join('') : String(part.content ?? '');
        out.push({ type: 'tool-result', id: part.tool_use_id, ok: !part.is_error, preview: text.slice(0, 400) });
      }
    }
  }
  if (message.type === 'result') out.push({ type: 'result', ok: !message.is_error, text: message.result, providerSessionId: message.session_id });
  return out;
}

export function parseCodexLine(message) {
  const out = [];
  if (message.type === 'thread.started') out.push({ type: 'session', providerSessionId: message.thread_id });
  const item = message.item;
  if (item && message.type === 'item.started' && item.type === 'command_execution') out.push({ type: 'tool', id: item.id, name: 'shell', command: item.command });
  if (item && message.type === 'item.completed') {
    if (item.type === 'agent_message' && item.text) out.push({ type: 'text', text: item.text });
    if (item.type === 'command_execution') out.push({ type: 'tool-result', id: item.id, ok: item.exit_code === 0, preview: String(item.aggregated_output ?? '').slice(0, 400) });
  }
  if (message.type === 'turn.completed') out.push({ type: 'result', ok: true });
  if (message.type === 'turn.failed' || message.type === 'error') out.push({ type: 'result', ok: false, text: message.error?.message ?? message.message });
  return out;
}

export class AgentHub {
  constructor(service) {
    this.service = service;
    this.running = new Map();
    this.sessions = readJson(SESSIONS_FILE(), []);
  }

  providers() { return detectProviders(); }

  #save() { writeJson(SESSIONS_FILE(), this.sessions.slice(-50)); }

  #spawn(session, text, locale) {
    const provider = detectProviders().find(p => p.id === session.provider);
    if (!provider?.available) throw Object.assign(new Error(`${session.provider} is not installed.`), { code: 'AGENT_MISSING' });
    const cwd = agentWorkspace();
    const env = { ...process.env, PATH: `${BIN_DIR}${path.delimiter}${process.env.PATH}`, POB_AI_LOCALE: locale ?? '' };
    const note = locale ? `The user's interface language is ${locale}. Reply in that language unless they write in another one.` : '';
    let args;
    if (session.provider === 'claude') {
      args = ['-p', '--output-format', 'stream-json', '--verbose', '--allowedTools', ...POB_TOOLS,
        '--disallowedTools', 'Edit', 'Write', 'NotebookEdit'];
      if (note) args.push('--append-system-prompt', note);
      if (session.providerSessionId) args.push('--resume', session.providerSessionId);
    } else {
      args = session.providerSessionId ? ['exec', 'resume', session.providerSessionId] : ['exec'];
      args.push('--json', '--skip-git-repo-check', '-s', 'workspace-write', '-c', 'sandbox_workspace_write.network_access=true', '-');
      if (note && !session.providerSessionId) text = `${note}\n\n${text}`;
    }
    // npm installs agents as .cmd scripts, which only cmd.exe can run; quote every argument for it.
    const child = /\.cmd$/i.test(provider.command)
      ? spawn([provider.command, ...args].map(quoteForCmd).join(' '), { cwd, env, windowsHide: true, shell: true, stdio: ['pipe', 'pipe', 'pipe'] })
      : spawn(provider.command, args, { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdin.end(text);
    return child;
  }

  /** Streams one chat turn as server-sent events. */
  async chat(body, res) {
    let session = this.sessions.find(s => s.id === body.sessionId);
    if (!session) {
      session = { id: randomUUID(), provider: body.provider ?? 'claude', title: String(body.message).slice(0, 60), createdAt: new Date().toISOString(), messages: [] };
      this.sessions.push(session);
    }
    if (this.running.has(session.id)) throw Object.assign(new Error('This chat is still answering.'), { code: 'BUSY' });
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    const emit = event => res.write(`data: ${JSON.stringify(event)}\n\n`);
    emit({ type: 'start', sessionId: session.id });
    session.messages.push({ role: 'user', text: body.message, at: new Date().toISOString() });
    const reply = { role: 'assistant', text: '', tools: [], at: new Date().toISOString() };
    let child;
    try { child = this.#spawn(session, String(body.message), body.locale); } catch (error) {
      emit({ type: 'error', message: error.message }); emit({ type: 'end' }); return res.end();
    }
    this.running.set(session.id, child);
    const parse = session.provider === 'claude' ? parseClaudeLine : parseCodexLine;
    const stderr = [];
    readline.createInterface({ input: child.stderr }).on('line', line => stderr.push(line));
    readline.createInterface({ input: child.stdout }).on('line', line => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      for (const event of parse(message)) {
        if (event.type === 'session' || (event.type === 'result' && event.providerSessionId)) session.providerSessionId = event.providerSessionId;
        if (event.type === 'text') reply.text += (reply.text ? '\n\n' : '') + event.text;
        if (event.type === 'tool') reply.tools.push(event.command);
        if (event.type === 'result' && !reply.text && event.text) reply.text = event.text;
        if (event.type !== 'session') emit(event);
      }
    });
    res.on('close', () => { if (this.running.get(session.id) === child) child.kill(); });
    await new Promise(resolve => child.on('close', resolve));
    this.running.delete(session.id);
    if (!reply.text && stderr.length) emit({ type: 'error', message: stderr.slice(-5).join('\n') });
    session.messages.push(reply);
    this.#save();
    emit({ type: 'end', sessionId: session.id });
    res.end();
  }

  stop(sessionId) {
    const child = this.running.get(sessionId);
    if (child) child.kill();
    return Boolean(child);
  }

  async handle(req, res, url, { send, readBody }) {
    const route = `${req.method} ${url.pathname}`;
    if (route === 'GET /api/agent/providers') return send(res, 200, { ok: true, providers: detectProviders({ refresh: true }) });
    if (route === 'GET /api/agent/sessions') return send(res, 200, { ok: true, sessions: this.sessions.map(({ messages, ...s }) => ({ ...s, turns: messages.length })) });
    const match = url.pathname.match(/^\/api\/agent\/sessions\/([\w-]+)$/);
    if (match && req.method === 'GET') {
      const session = this.sessions.find(s => s.id === match[1]);
      return session ? send(res, 200, { ok: true, session }) : send(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'No such chat.' } });
    }
    if (match && req.method === 'DELETE') {
      this.stop(match[1]);
      this.sessions = this.sessions.filter(s => s.id !== match[1]);
      this.#save();
      return send(res, 200, { ok: true });
    }
    if (route === 'POST /api/agent/chat') {
      const body = await readBody(req);
      if (!body.message) return send(res, 400, { ok: false, error: { code: 'BAD_REQUEST', message: 'message is required' } });
      try { return await this.chat(body, res); } catch (error) {
        if (!res.headersSent) return send(res, 409, { ok: false, error: { code: error.code ?? 'ERROR', message: error.message } });
        return res.end();
      }
    }
    if (route === 'POST /api/agent/stop') {
      const body = await readBody(req);
      return send(res, 200, { ok: true, stopped: this.stop(body.sessionId) });
    }
    return send(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: route } });
  }

  close() { for (const child of this.running.values()) child.kill(); }
}
