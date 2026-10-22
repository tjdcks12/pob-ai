import assert from 'node:assert/strict';
import test from 'node:test';
import { buildArgs, parseArgv, resolveCommand } from '../src/cli/main.mjs';
import { COMMANDS, findCommand } from '../src/commands/registry.mjs';
import { validateArgs } from '../src/commands/schema.mjs';
import { decodeBuildCode, encodeBuildCode } from '../src/commands/local.mjs';
import { mcpTools } from '../src/service/mcp.mjs';

test('command words resolve to registry names, hyphens to underscores', () => {
  assert.equal(resolveCommand(['tree', 'allocate', 'Heart', 'of', 'the', 'Warrior']).command.name, 'tree.allocate');
  assert.equal(resolveCommand(['ui', 'show-node', 'x']).command.name, 'ui.show_node');
  assert.equal(resolveCommand(['open']).command.name, 'open');
  assert.equal(resolveCommand(['nope']).command, null);
});

test('rest positional joins the remaining words', () => {
  const { command, rest } = resolveCommand(['tree', 'allocate', 'Heart', 'of', 'the', 'Warrior']);
  const { words, flags } = parseArgv(['--weapon-set', '2']);
  assert.deepEqual(words, []);
  const args = validateArgs(command, buildArgs(command, rest, flags));
  assert.deepEqual(args, { node: 'Heart of the Warrior', weaponSet: 2 });
});

test('flags: --no-x, --x=y, repeated flags become lists', () => {
  const { flags } = parseArgv(['--no-enabled', '--label=Main', '--mod', 'a', '--mod', 'b']);
  assert.equal(flags.enabled, false);
  assert.equal(flags.label, 'Main');
  assert.deepEqual(flags.mod, ['a', 'b']);
});

test('validation explains missing and unknown arguments', () => {
  assert.throws(() => validateArgs(findCommand('tree.allocate'), {}), /needs <node>/);
  assert.throws(() => validateArgs(findCommand('tree.allocate'), { node: 'x', bogus: 1 }), /no argument "bogus"/);
  assert.throws(() => validateArgs(findCommand('ui.tab'), { tab: 'nowhere' }), /must be one of/);
});

test('config values parse as JSON when possible', () => {
  const command = findCommand('config.set');
  assert.deepEqual(validateArgs(command, { key: 'enemyIsBoss', value: '"Pinnacle"' }), { key: 'enemyIsBoss', value: 'Pinnacle' });
  assert.deepEqual(validateArgs(command, { key: 'x', value: 'true' }), { key: 'x', value: true });
  assert.deepEqual(validateArgs(command, { key: 'x', value: 'Pinnacle' }), { key: 'x', value: 'Pinnacle' });
});

test('build codes round-trip and PoE1 codes are refused', () => {
  const xml = '<?xml version="1.0"?><PathOfBuilding2><Build level="90"/></PathOfBuilding2>';
  assert.equal(decodeBuildCode(encodeBuildCode(xml)), xml);
  assert.throws(() => decodeBuildCode(encodeBuildCode('<PathOfBuilding><Build/></PathOfBuilding>')), /Path of Exile 1/);
  assert.throws(() => decodeBuildCode('not a code at all'), /not a valid/);
});

test('docs/COMMANDS.md matches the registry', async () => {
  const { render } = await import('../scripts/gen-commands.mjs');
  const fs = await import('node:fs');
  assert.equal(fs.readFileSync(new URL('../docs/COMMANDS.md', import.meta.url), 'utf8'), render(), 'Run: node scripts/gen-commands.mjs');
});

test('every command has a summary and MCP tool names are valid', () => {
  const names = new Set();
  for (const c of COMMANDS) {
    assert.ok(c.summary, c.name);
    assert.ok(!names.has(c.name), `duplicate ${c.name}`);
    names.add(c.name);
  }
  for (const tool of mcpTools()) assert.match(tool.name, /^[a-zA-Z0-9_-]{1,64}$/);
});
