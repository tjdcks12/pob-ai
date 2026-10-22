// `pob` command line. Talks to the running PoB AI service (and through it to the PoB window)
// when one is running; otherwise runs the command in a private headless PoB engine.
import { COMMANDS, findCommand, groups } from '../commands/registry.mjs';
import { ArgError, validateArgs } from '../commands/schema.mjs';
import { Runtime } from '../runtime.mjs';
import { callService, serviceInfo } from '../service/client.mjs';

const GLOBAL_FLAGS = new Set(['target', 'args', 'pretty', 'lang']);

/** Splits argv into command words, positionals and --flags. */
export function parseArgv(argv) {
  const words = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--') { words.push(...argv.slice(i + 1)); break; }
    if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      let key = eq > 0 ? token.slice(2, eq) : token.slice(2);
      let value;
      if (eq > 0) value = token.slice(eq + 1);
      else if (key.startsWith('no-')) { key = key.slice(3); value = false; }
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) value = argv[++i];
      else value = true;
      key = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (flags[key] !== undefined) flags[key] = [].concat(flags[key], value);
      else flags[key] = value;
    } else words.push(token);
  }
  return { words, flags };
}

/** Finds the longest command name made of the leading words: `tree allocate X` -> tree.allocate. */
export function resolveCommand(words) {
  for (let n = Math.min(3, words.length); n > 0; n--) {
    const name = words.slice(0, n).join('.').replace(/-/g, '_');
    const command = findCommand(name);
    if (command) return { command, rest: words.slice(n) };
  }
  return { command: null, rest: words };
}

export function buildArgs(command, positionals, flags) {
  const args = {};
  if (flags.args) Object.assign(args, typeof flags.args === 'string' ? JSON.parse(flags.args) : flags.args);
  for (const [key, value] of Object.entries(flags)) if (!GLOBAL_FLAGS.has(key)) args[key] = value;
  const specs = (command.args ?? []).filter(a => a.positional);
  let index = 0;
  for (const spec of specs) {
    if (index >= positionals.length) break;
    if (spec.rest) { args[spec.name] = spec.type === 'string[]' ? positionals.slice(index) : positionals.slice(index).join(' '); index = positionals.length; }
    else args[spec.name] = positionals[index++];
  }
  if (index < positionals.length) throw new ArgError(`Too many values for ${command.name}: ${positionals.slice(index).join(' ')}`);
  return args;
}

function helpText(name) {
  if (name) {
    const command = findCommand(name.replace(/ /g, '.').replace(/-/g, '_')) ?? resolveCommand(name.split(/[ .]/)).command;
    if (!command) return `Unknown command: ${name}`;
    const usage = ['pob', ...command.name.split('.').map(w => w.replace(/_/g, '-')),
      ...(command.args ?? []).filter(a => a.positional).map(a => (a.required ? `<${a.name}>` : `[${a.name}]`))].join(' ');
    const lines = [usage, '', command.summary];
    if (command.details) lines.push('', command.details);
    const flags = (command.args ?? []);
    if (flags.length) {
      lines.push('', 'Arguments:');
      for (const a of flags) lines.push(`  ${a.positional ? a.name : `--${a.name.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`} (${a.type}${a.required ? ', required' : ''}${a.enum ? `: ${a.enum.join('|')}` : ''})  ${a.description}`);
    }
    if (command.live) lines.push('', 'Needs the PoB window (`pob open`).');
    if (command.examples?.length) lines.push('', 'Examples:', ...command.examples.map(e => `  ${e}`));
    return lines.join('\n');
  }
  const lines = ['pob - drive Path of Building (PoE2) from the command line', '', 'Usage: pob <group> <action> [values] [--flags]', 'Every command prints JSON. Add --pretty for indented output, --lang <ko|ja|…> for game names in another language.', ''];
  for (const [group, commands] of groups()) {
    lines.push(`${group}:`);
    for (const c of commands) lines.push(`  ${c.name.split('.').map(w => w.replace(/_/g, '-')).join(' ').padEnd(30)} ${c.summary}`);
    lines.push('');
  }
  lines.push('Details: pob help <group> <action>');
  return lines.join('\n');
}

export async function main(argv) {
  const { words, flags } = parseArgv(argv);
  const pretty = flags.pretty === true;
  const print = value => process.stdout.write(JSON.stringify(value, null, pretty ? 2 : 0) + '\n');
  if (!words.length || words[0] === 'help' || flags.help) {
    process.stdout.write(helpText(words.slice(words[0] === 'help' ? 1 : 0).join(' ')) + '\n');
    return 0;
  }
  const { command, rest } = resolveCommand(words);
  if (!command) {
    print({ ok: false, error: { code: 'UNKNOWN_COMMAND', message: `Unknown command: ${words.join(' ')}. Run \`pob help\`.` } });
    return 1;
  }
  let runtime;
  try {
    const args = validateArgs(command, buildArgs(command, rest, flags));
    const target = typeof flags.target === 'string' ? flags.target : undefined;
    // Agents started by PoB AI get the user's language in POB_AI_LOCALE.
    const lang = typeof flags.lang === 'string' ? flags.lang : process.env.POB_AI_LOCALE || undefined;
    let outcome;
    const service = await serviceInfo();
    if (service) outcome = await callService(service, command.name, args, target, lang);
    else {
      runtime = new Runtime();
      outcome = await runtime.run(command.name, args, { target, lang });
    }
    print({ ok: true, command: command.name, ...outcome });
    return 0;
  } catch (error) {
    print({ ok: false, command: command.name, error: { code: error.code ?? 'ERROR', message: error.message, details: error.details } });
    return 1;
  } finally {
    runtime?.close();
  }
}

export { COMMANDS };
