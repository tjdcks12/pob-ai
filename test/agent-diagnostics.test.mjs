import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { agentDiagnostic, classifyFailure, redactDiagnosticText } from '../src/agent/diagnostics.mjs';

test('failures distinguish causes and do not guess when the CLI supplies no cause', () => {
  const cases = [
    ['OAuth session expired; could not refresh token', 'AGENT_SIGNED_OUT'],
    ['HTTP 429: usage limit reached', 'AGENT_RATE_LIMITED'],
    ['The requested model does not exist', 'AGENT_MODEL_UNAVAILABLE'],
    ['Sandbox setup failed: CreateProcessWithToken', 'AGENT_SANDBOX'],
    ['Error parsing config.toml: invalid value', 'AGENT_CONFIG'],
    ['error sending request: connection reset (ECONNRESET)', 'AGENT_NETWORK'],
    ['stream disconnected before completion', 'AGENT_NETWORK'],
    ['Something unexpected happened', 'AGENT_FAILED'],
  ];
  for (const [text, code] of cases) assert.equal(classifyFailure([text], { exitCode: 1 }), code, text);
  assert.equal(classifyFailure([], { exitCode: 0 }), 'AGENT_NO_RESPONSE');
  assert.equal(classifyFailure([], { exitCode: 0, eventCount: 2 }), 'AGENT_PROTOCOL');
  assert.equal(classifyFailure([], { exitCode: 1 }), 'AGENT_FAILED');
});

test('diagnostics scrub quoted credentials, URLs, home paths and bounded output', () => {
  const report = redactDiagnosticText([
    'Authorization: Bearer bearer-secret',
    '{"apiKey":"api-secret","access_token":"access-secret","password":"quote\\\"secret"}',
    "refresh_token='refresh-secret'; token=token-secret; client_secret=client-secret",
    'Cookie: sid=cookie-secret; other=other-secret',
    'https://user:url-secret@example.test/path?token=query-secret&api_key=key-secret',
    'sk-secretkey123456 ghp_githubsecret github_pat_githubsecret',
    'c:\\USERS\\Tester\\.codex\\config.toml C:/Users/Tester/.codex/config.toml',
  ].join('\n'), 'C:\\Users\\Tester');
  assert.doesNotMatch(report, /bearer-secret|api-secret|access-secret|quote|refresh-secret|token-secret|client-secret|cookie-secret|other-secret|url-secret|query-secret|key-secret|githubsecret|secretkey|Tester/i);
  assert.match(report, /%USERPROFILE%/);
  assert.match(report, /example\.test/);
  assert.equal(redactDiagnosticText('x'.repeat(3000)).length, 2400);
});

test('a copied report contains useful version, exit and event counts without raw stdout', () => {
  const report = agentDiagnostic({ provider: 'codex', version: '0.50.0', minimumVersion: '0.50.0',
    command: path.join(process.env.USERPROFILE || os.homedir(), 'bin', 'codex.exe'), exitCode: 1,
    details: ['old line', '1', '2', '3', '4', 'ECONNRESET token=fixture-secret'], events: { 'thread.started': 1 } });
  assert.equal(report.version, '0.50.0');
  assert.equal(report.exitCode, 1);
  assert.equal(report.events['thread.started'], 1);
  assert.match(report.executable, /%USERPROFILE%/);
  assert.doesNotMatch(JSON.stringify(report), /fixture-secret|old line/);
  assert.match(report.details, /ECONNRESET/);
});

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pobai-diagnostics-'));
process.env.POB_AI_HOME = home;
const { createService } = await import('../src/service/server.mjs');
const { writeJson } = await import('../src/state.mjs');
after(() => fs.rmSync(home, { recursive: true, force: true }));

test('CLI failure diagnostics stream to the panel, survive restart and stay scrubbed in the log', { skip: process.platform !== 'win32' }, async () => {
  const cli = path.join(home, 'fixture-codex.cmd');
  fs.writeFileSync(cli, '@echo off\r\nif "%~1"=="--version" (\r\n echo codex-cli 0.50.0\r\n exit /b 0\r\n)\r\necho {"type":"thread.started","thread_id":"fixture-thread"}\r\necho ECONNRESET token=fixture-secret 1>&2\r\nexit /b 1\r\n');
  writeJson(path.join(home, 'config.json'), { agentPaths: { codex: cli }, lastUpdateCheck: Date.now() });
  const logs = [];
  let service = await createService({ port: 0, log: line => logs.push(line) });
  const headers = { authorization: `Bearer ${service.token}`, 'content-type': 'application/json' };
  try {
    const response = await fetch(new URL('/api/agent/chat', service.url), {
      method: 'POST', headers, body: JSON.stringify({ provider: 'codex', message: 'private prompt' }),
    });
    assert.equal(response.status, 200);
    const stream = await response.text();
    const events = stream.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
    const failure = events.find(event => event.type === 'error');
    assert.equal(failure.code, 'AGENT_NETWORK');
    assert.equal(failure.diagnostic.version, '0.50.0');
    assert.equal(failure.diagnostic.exitCode, 1);
    assert.match(failure.diagnostic.details, /ECONNRESET/);
    assert.doesNotMatch(JSON.stringify(failure), /fixture-secret|private prompt/);
    assert.doesNotMatch(logs.join('\n'), /fixture-secret|private prompt/);
    const id = events.find(event => event.type === 'start').sessionId;
    service.close();
    service = await createService({ port: 0, log: line => logs.push(line) });
    const saved = await fetch(new URL(`/api/agent/sessions/${id}`, service.url), { headers }).then(r => r.json());
    assert.deepEqual(saved.session.messages.at(-1).diagnostic, failure.diagnostic);
    assert.equal(saved.session.messages.at(-1).error, 'AGENT_NETWORK');
    assert.equal(events.at(-1).type, 'end');
  } finally { service.close(); }
});
