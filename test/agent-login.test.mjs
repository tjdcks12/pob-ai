import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { setTimeout } from 'node:timers/promises';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pobai-login-'));
process.env.POB_AI_HOME = home;
const { openLogin } = await import('../src/agent/providers.mjs');
const { writeJson } = await import('../src/state.mjs');
after(() => fs.promises.rm(home, { recursive: true, force: true, maxRetries: 20, retryDelay: 25 }));

test('login executes npm cmd shims with spaces and passes each provider authentication command', { skip: process.platform !== 'win32' }, async () => {
  const dir = path.join(home, 'agent with spaces');
  fs.mkdirSync(dir);
  const fixture = path.join(dir, 'capture.mjs');
  fs.writeFileSync(fixture, 'import fs from "node:fs"; fs.writeFileSync(process.argv[2], JSON.stringify(process.argv.slice(3)));');
  for (const [provider, args] of [['claude', ['auth', 'login']], ['codex', ['login']], ['antigravity', ['--input-format', 'stream-json', '--output-format', 'stream-json']]]) {
    const marker = path.join(dir, `${provider}.json`);
    const command = path.join(dir, `${provider}.cmd`);
    fs.writeFileSync(command, `@echo off\r\n"${process.execPath}" "${fixture}" "${marker}" %*\r\n`);
    writeJson(path.join(home, 'config.json'), { agentPaths: { [provider]: command } });
    await openLogin(provider);
    for (let attempt = 0; attempt < 40 && !fs.existsSync(marker); attempt++) await setTimeout(50);
    assert.equal(fs.existsSync(marker), true, `${provider} actually runs, rather than only opening a console`);
    assert.deepEqual(JSON.parse(fs.readFileSync(marker, 'utf8')), args);
  }
});
