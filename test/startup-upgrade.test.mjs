import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const previous = version.replace(/\d+$/, number => String(Number(number) - 1));
const next = version.replace(/\d+$/, number => String(Number(number) + 1));

async function launchAgainst({ runningVersion = previous, agentBusy = false, syncBusy = false, fail = false, legacy = false, open = false, stagedVersion } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pobai-startup-'));
  const token = 'a'.repeat(48), requests = [];
  const server = http.createServer(async (request, response) => {
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    const send = value => { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(value)); };
    if (request.url === '/api/health') return send({ ok: true });
    if (request.url === '/api/status') return send({ ok: true, version: runningVersion });
    if (request.url === '/api/agent/sessions') return send({ ok: true, sessions: [{ running: agentBusy }] });
    if (request.url === '/api/character-sync') {
      if (legacy) { response.statusCode = 404; return send({ ok: false, error: { code: 'NOT_FOUND' } }); }
      return send({ ok: true, running: syncBusy });
    }
    if (request.url === '/api/run') {
      let text = ''; for await (const chunk of request) text += chunk;
      const body = JSON.parse(text); requests.push(body);
      if (fail) return send({ ok: false, error: { code: 'DOWNLOAD_FAILED', message: 'fixture offline' } });
      if (body.args.restart) runningVersion = stagedVersion && requests.length === 1 ? stagedVersion : version;
      return send({ ok: true, target: 'app', result: { installed: version, restarting: body.args.restart, restartNeeded: true } });
    }
    response.statusCode = 404; send({ ok: false });
  });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    fs.writeFileSync(path.join(home, 'service.json'), JSON.stringify({ port: server.address().port, token, pid: process.pid }));
    const result = await run(process.execPath, [path.join(root, 'src/service/main.mjs'), '--no-browser', ...(open ? ['--open'] : [])], {
      env: { ...process.env, POB_AI_HOME: home }, windowsHide: true, timeout: 15000,
    });
    return { requests, runningVersion, stderr: result.stderr };
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(home, { recursive: true, force: true });
  }
}

test('starting a newer copy upgrades an older running service instead of reusing its old UI', async () => {
  const result = await launchAgainst({ open: true });
  assert.equal(result.requests.length, 1, 'the existing service must receive the verified update request');
  assert.equal(result.requests[0].command, 'update.apply');
  assert.equal(result.requests[0].args.restart, true);
  assert.equal(result.runningVersion, version);
});

test('starting a newer copy prepares the update without interrupting an AI turn or character import', async () => {
  for (const busy of [{ agentBusy: true }, { syncBusy: true }]) {
    const result = await launchAgainst(busy);
    assert.equal(result.requests.length, 1);
    assert.equal(result.requests[0].args.restart, false);
    assert.equal(result.runningVersion, previous);
  }
});

test('an older prepared update is applied first, then the newly launched release is reached without opening another PoB', async () => {
  const older = version.replace(/\d+$/, number => String(Number(number) - 2));
  const result = await launchAgainst({ runningVersion: older, stagedVersion: previous, open: true });
  assert.equal(result.requests.length, 2);
  assert.ok(result.requests.every(request => request.command === 'update.apply' && request.args.restart));
  assert.equal(result.runningVersion, version);
});

test('the same or a newer running service is reused without reinstalling or downgrading it', async () => {
  for (const runningVersion of [version, next]) {
    const result = await launchAgainst({ runningVersion });
    assert.deepEqual(result.requests, []);
    assert.equal(result.runningVersion, runningVersion);
  }
});

test('older services without character refresh can still upgrade to the new UI', async () => {
  const result = await launchAgainst({ legacy: true });
  assert.equal(result.requests[0].args.restart, true);
  assert.equal(result.runningVersion, version);
});

test('a failed startup update leaves the existing service running and records an actionable error', async () => {
  const result = await launchAgainst({ fail: true });
  assert.equal(result.requests.length, 1);
  assert.equal(result.runningVersion, previous);
  assert.match(result.stderr, /fixture offline/);
});
