import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildTurn, classifyFailure, effortFor, parseClaudeLine, parseCodexLine, phaseFor, prepareImages } from '../src/agent/hub.mjs';
import { candidates, claudeCatalog, codexCatalog, loginCommandLine, resolveProvider, validEffort, validModel, codexVersionSupported } from '../src/agent/providers.mjs';

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const pngUrl = `data:image/png;base64,${PNG.toString('base64')}`;
const valueAfter = (args, flag) => args[args.indexOf(flag) + 1];

test('Codex requires a CLI with the thread/item JSON protocol', () => {
  for (const version of ['0.41.0', '0.49.9', null, 'invalid']) assert.equal(codexVersionSupported(version), false, String(version));
  for (const version of ['0.50.0', '0.99.0', '1.0.0']) assert.equal(codexVersionSupported(version), true, version);
});

test('codex: new chat and resume both set the sandbox with -c, never -s', () => {
  for (const providerSessionId of [undefined, 'thread-1']) {
    const { args, input } = buildTurn({ provider: 'codex', providerSessionId, text: 'hi', locale: 'ko' });
    assert.ok(!args.includes('-s') && !args.includes('--sandbox'));
    assert.ok(args.includes('sandbox_mode="workspace-write"'));
    assert.equal(args.at(-1), '-');
    assert.ok(args.includes('model_reasoning_effort="medium"'));
    if (providerSessionId) {
      assert.deepEqual(args.slice(-3), ['resume', 'thread-1', '-']);
      assert.ok(args.indexOf('--json') < args.indexOf('resume'), 'shared options precede resume on older CLIs');
      assert.equal(input, 'hi'); // the language note goes only into the first turn
    } else {
      assert.equal(args[0], 'exec');
      assert.notEqual(args[1], 'resume');
      assert.match(input, /interface language is ko[\s\S]*hi$/);
    }
  }
});

test('codex: model, effort and images', () => {
  const { args } = buildTurn({ provider: 'codex', providerSessionId: 't', model: 'gpt-x', effort: 'high', text: 'a',
    images: [{ path: 'C:\\i\\a.png', mediaType: 'image/png' }, { path: 'C:\\i\\b.jpg', mediaType: 'image/jpeg' }] });
  assert.equal(valueAfter(args, '-m'), 'gpt-x');
  assert.ok(args.includes('model_reasoning_effort="high"'));
  const first = args.indexOf('-i');
  assert.deepEqual(args.slice(first, first + 4), ['-i', 'C:\\i\\a.png', '-i', 'C:\\i\\b.jpg']);
  assert.ok(args[first + 4].startsWith('--'), 'a flag follows the images so `-` stays the prompt');
});

test('full access is explicit for both agents, including resumed chats and switching it off', () => {
  for (const provider of ['codex', 'claude']) for (const providerSessionId of [undefined, 'existing-chat']) {
    for (const fullAccess of [undefined, false, true, 'true']) {
      const { args } = buildTurn({ provider, providerSessionId, fullAccess, text: 'hi' });
      const enabled = fullAccess === true;
      if (provider === 'codex') {
        assert.equal(args.includes('--dangerously-bypass-approvals-and-sandbox'), enabled);
        assert.equal(args.includes('sandbox_mode="workspace-write"'), !enabled);
      } else {
        assert.equal(args.includes('--dangerously-skip-permissions'), enabled);
        assert.equal(args.includes('--disallowedTools'), !enabled);
        assert.equal(args.includes('--allowedTools'), !enabled);
        if (!enabled) assert.equal(valueAfter(args, '--permission-mode'), 'dontAsk', 'resume cannot inherit bypass mode');
      }
    }
  }
});

test('effort: medium by default unless the chosen Codex model has no medium', () => {
  const catalog = [{ id: 'fast', efforts: ['low', 'high'] }, { id: 'full', efforts: ['low', 'medium'] }];
  assert.equal(effortFor({ provider: 'codex', model: 'fast' }, catalog), null);
  assert.equal(effortFor({ provider: 'codex', model: 'full' }, catalog), 'medium');
  assert.equal(effortFor({ provider: 'codex', model: 'unknown' }, catalog), 'medium');
  assert.equal(effortFor({ provider: 'claude', effort: 'max' }), 'max');
  assert.ok(!buildTurn({ provider: 'codex', model: 'fast', text: 'a' }, { catalog }).args.some(a => a.startsWith('model_reasoning_effort')));
});

test('claude: stream-json in and out with partial messages, model, effort, resume and images', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pobai-agent-'));
  const file = path.join(dir, 'a.png');
  fs.writeFileSync(file, PNG);
  const { args, input } = buildTurn({ provider: 'claude', providerSessionId: 'sess', model: 'opus', effort: 'high', locale: 'de', text: 'look',
    images: [{ path: file, mediaType: 'image/png' }] });
  assert.equal(valueAfter(args, '--input-format'), 'stream-json');
  assert.equal(valueAfter(args, '--output-format'), 'stream-json');
  assert.ok(args.includes('--include-partial-messages'));
  assert.equal(valueAfter(args, '--resume'), 'sess');
  assert.equal(valueAfter(args, '--model'), 'opus');
  assert.equal(valueAfter(args, '--effort'), 'high');
  assert.match(valueAfter(args, '--append-system-prompt'), /language is de/);
  assert.ok(input.endsWith('\n'));
  const message = JSON.parse(input);
  assert.equal(message.type, 'user');
  assert.deepEqual(message.message.content[0], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG.toString('base64') } });
  assert.deepEqual(message.message.content[1], { type: 'text', text: 'look' });
  const plain = buildTurn({ provider: 'claude', text: 'x' });
  assert.ok(!plain.args.includes('--resume') && !plain.args.includes('--model'));
  assert.equal(valueAfter(plain.args, '--effort'), 'medium');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('phaseFor follows the phase table', () => {
  const cases = {
    'pob ui show-node Heart of the Warrior': 'show',
    'pob ui tab tree': 'show',
    'pob build import https://pobb.in/x': 'import',
    'pob tree url-import x': 'import',
    'pob tree allocate Heart': 'apply',
    'pob build save': 'apply',
    'pob calc whatif --x': 'compare',
    'pob calc node-power': 'compare',
    'pob calc stats': 'calculate',
    'pob tree search fire': 'lookup',
    'pob gems search arc': 'lookup',
    'pob build summary': 'inspect',
    'pob help': 'inspect',
    'Get-ChildItem': 'inspect',
    '"C:\\\\Windows\\\\powershell.exe" -Command "pob calc stats"': 'calculate',
    'node C:/x/bin/pob.mjs items uniques Ingenuity': 'lookup',
  };
  for (const [command, phase] of Object.entries(cases)) assert.equal(phaseFor(command), phase, command);
});

test('classifyFailure: sign-in problems vs everything else', () => {
  assert.equal(classifyFailure(['Invalid API key · Please run /login']), 'AGENT_SIGNED_OUT');
  assert.equal(classifyFailure(['', 'Error: 401 Unauthorized']), 'AGENT_SIGNED_OUT');
  assert.equal(classifyFailure(['Not logged in']), 'AGENT_SIGNED_OUT');
  assert.equal(classifyFailure(['failed to authenticate request']), 'AGENT_SIGNED_OUT');
  assert.equal(classifyFailure(['stream disconnected before completion', undefined]), 'AGENT_NETWORK');
  assert.equal(classifyFailure([]), 'AGENT_FAILED');
});

test('parseClaudeLine: partial pieces carry the message id, the final message replaces them', () => {
  const state = {};
  assert.deepEqual(parseClaudeLine({ type: 'system', subtype: 'init', session_id: 's1' }, state), [{ type: 'session', providerSessionId: 's1' }]);
  assert.deepEqual(parseClaudeLine({ type: 'stream_event', event: { type: 'message_start', message: { id: 'msg_1' } } }, state), []);
  assert.deepEqual(parseClaudeLine({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hel' } } }, state),
    [{ type: 'text', id: 'msg_1', text: 'Hel', partial: true }]);
  assert.deepEqual(parseClaudeLine({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{' } } }, state), []);
  assert.deepEqual(parseClaudeLine({ type: 'assistant', message: { id: 'msg_1', content: [{ type: 'text', text: 'Hello' }] } }, state),
    [{ type: 'text', id: 'msg_1', text: 'Hello' }]);
  assert.deepEqual(parseClaudeLine({ type: 'assistant', message: { id: 'msg_2', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'pob calc stats' } }] } }, state),
    [{ type: 'tool', command: 'pob calc stats' }]);
  // A signed-out CLI answers with a synthetic assistant message; it must not become answer text.
  const expired = parseClaudeLine({ type: 'assistant', error: 'authentication_failed', is_api_error_message: true,
    message: { id: 'x', model: '<synthetic>', content: [{ type: 'text', text: 'Failed to authenticate: OAuth session expired' }] } }, state);
  assert.equal(expired.length, 1);
  assert.equal(expired[0].type, 'result');
  assert.equal(expired[0].ok, false);
  assert.equal(classifyFailure([expired[0].text]), 'AGENT_SIGNED_OUT');
  assert.deepEqual(parseClaudeLine({ type: 'result', is_error: true, result: 'boom', session_id: 's1' }, state),
    [{ type: 'result', ok: false, text: 'boom', providerSessionId: 's1' }]);
});

test('parseCodexLine: whole messages with the item id, commands only as tool events', () => {
  assert.deepEqual(parseCodexLine({ type: 'thread.started', thread_id: 't1' }), [{ type: 'session', providerSessionId: 't1' }]);
  assert.deepEqual(parseCodexLine({ type: 'item.started', item: { id: 'i1', type: 'command_execution', command: 'pob calc stats' } }), [{ type: 'tool', command: 'pob calc stats' }]);
  assert.deepEqual(parseCodexLine({ type: 'item.completed', item: { id: 'i1', type: 'command_execution', aggregated_output: 'secret', exit_code: 0 } }), []);
  assert.deepEqual(parseCodexLine({ type: 'item.completed', item: { id: 'i2', type: 'agent_message', text: 'ok' } }), [{ type: 'text', id: 'i2', text: 'ok' }]);
  assert.deepEqual(parseCodexLine({ type: 'turn.failed', error: { message: 'x' } }), [{ type: 'result', ok: false, text: 'x' }]);
});

test('prepareImages checks count, type by content and size', () => {
  const [image] = prepareImages([{ name: 'shot.png', dataUrl: pngUrl }]);
  assert.equal(image.mediaType, 'image/png');
  assert.match(image.id, /^[0-9a-f]{64}$/);
  assert.equal(image.file, `${image.id}.png`);
  assert.deepEqual(prepareImages(undefined), []);
  const code = fn => { try { fn(); return null; } catch (error) { return error.code; } };
  assert.equal(code(() => prepareImages(Array(5).fill({ name: 'a', dataUrl: pngUrl }))), 'IMAGE_TOO_MANY');
  assert.equal(code(() => prepareImages([{ name: 'a', dataUrl: pngUrl.replace('image/png', 'image/jpeg') }])), 'IMAGE_INVALID');
  assert.equal(code(() => prepareImages([{ name: 'a', dataUrl: 'C:/private.png' }])), 'IMAGE_INVALID');
  assert.equal(code(() => prepareImages([{ name: 'a', dataUrl: `data:image/png;base64,${Buffer.from('not an image').toString('base64')}` }])), 'IMAGE_INVALID');
  assert.equal(code(() => prepareImages([{ name: 'a', dataUrl: `data:image/png;base64,${'A'.repeat(7_100_000)}` }])), 'IMAGE_TOO_LARGE');
});

test('discovery finds the Codex desktop copy (newest version folder) and keeps a missing custom path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pobai-discover-'));
  const local = path.join(root, 'Local');
  const older = path.join(local, 'OpenAI', 'Codex', 'bin', 'aaa', 'codex.exe');
  const newer = path.join(local, 'OpenAI', 'Codex', 'bin', 'bbb', 'codex.exe');
  for (const file of [older, newer]) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, ''); }
  fs.utimesSync(older, new Date(2020, 0, 1), new Date(2020, 0, 1));
  const env = { USERPROFILE: path.join(root, 'home'), APPDATA: path.join(root, 'Roaming'), LOCALAPPDATA: local, PATH: '' };
  assert.deepEqual(candidates('codex', env), [newer, older]);
  assert.equal(resolveProvider('codex', { config: {}, env }).source, 'auto');
  assert.equal(resolveProvider('codex', { config: {}, env }).command, newer);
  const npm = path.join(root, 'Roaming', 'npm', 'codex.cmd');
  fs.mkdirSync(path.dirname(npm), { recursive: true });
  fs.writeFileSync(npm, '');
  assert.equal(candidates('codex', env)[0], npm, 'installed CLIs come before the desktop copy');
  const gone = resolveProvider('codex', { config: { agentPaths: { codex: path.join(root, 'gone.exe') } }, env });
  assert.deepEqual([gone.source, gone.available, gone.command], ['custom', false, path.join(root, 'gone.exe')]);
  assert.equal(resolveProvider('claude', { config: {}, env }).available, false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('model catalogs keep only safe ids and known efforts', () => {
  const codex = codexCatalog({ identity: 'private', models: [
    { slug: 'gpt-a', display_name: 'GPT A', default_reasoning_level: 'medium', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'bogus' }], instructions: 'private' },
    { slug: 'hidden', visibility: 'hide' }, { slug: '--unsafe' }] });
  assert.deepEqual(codex, [{ id: 'gpt-a', name: 'GPT A', efforts: ['low'], defaultEffort: 'medium' }]);
  const claude = claudeCatalog([{ value: 'claude-x[1m]', displayName: 'X', supportedEffortLevels: ['low', 'ultra'] }, { value: '-bad' }]);
  assert.deepEqual(claude, [{ id: 'claude-x[1m]', name: 'X', efforts: ['low'], defaultEffort: null }]);
  assert.ok(validModel('gpt-5.6-sol') && !validModel('--model') && !validModel('a b'));
  assert.ok(validEffort('codex', 'ultra') && !validEffort('claude', 'ultra') && !validEffort('codex', 'huge'));
});

test('sign-in quotes the CLI command for its own interactive console', () => {
  assert.equal(loginCommandLine('claude', 'C:\\Users\\me\\.local\\bin\\claude.exe'), '""C:\\Users\\me\\.local\\bin\\claude.exe" "auth" "login""');
  assert.equal(loginCommandLine('codex', 'C:\\x\\codex.exe'), '""C:\\x\\codex.exe" "login""');
});
