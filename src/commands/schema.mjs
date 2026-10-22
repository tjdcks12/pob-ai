// Command definition helpers and argument validation shared by the CLI, HTTP API and MCP.

/**
 * @typedef {{ name: string, type: 'string'|'integer'|'number'|'boolean'|'json'|'string[]',
 *   required?: boolean, positional?: boolean, enum?: (string|number)[], description: string,
 *   default?: unknown, rest?: boolean }} ArgSpec
 * @typedef {{ name: string, summary: string, args?: ArgSpec[], mutates?: boolean, live?: boolean,
 *   op?: string, examples?: string[], timeoutMs?: number, local?: Function, details?: string }} CommandSpec
 */

export const str = (name, description, extra = {}) => ({ name, type: 'string', description, ...extra });
export const int = (name, description, extra = {}) => ({ name, type: 'integer', description, ...extra });
export const num = (name, description, extra = {}) => ({ name, type: 'number', description, ...extra });
export const bool = (name, description, extra = {}) => ({ name, type: 'boolean', description, ...extra });
export const json = (name, description, extra = {}) => ({ name, type: 'json', description, ...extra });
export const list = (name, description, extra = {}) => ({ name, type: 'string[]', description, ...extra });

export class ArgError extends Error {
  constructor(message) { super(message); this.code = 'BAD_ARGS'; }
}

function coerce(spec, value) {
  if (value === undefined || value === null) return value;
  switch (spec.type) {
    case 'integer': {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isInteger(n)) throw new ArgError(`--${spec.name} must be a whole number.`);
      return n;
    }
    case 'number': {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) throw new ArgError(`--${spec.name} must be a number.`);
      return n;
    }
    case 'boolean':
      if (typeof value === 'boolean') return value;
      if (['true', '1', 'yes', 'on'].includes(String(value).toLowerCase())) return true;
      if (['false', '0', 'no', 'off'].includes(String(value).toLowerCase())) return false;
      throw new ArgError(`--${spec.name} must be true or false.`);
    case 'json':
      if (typeof value !== 'string') return value;
      try { return JSON.parse(value); } catch { return value; }
    case 'string[]':
      return Array.isArray(value) ? value.map(String) : [String(value)];
    default:
      return String(value);
  }
}

/** Returns a clean args object, or throws ArgError with a message the agent can act on. */
export function validateArgs(command, input = {}) {
  const out = {};
  const known = new Set((command.args ?? []).map(a => a.name));
  for (const key of Object.keys(input)) {
    if (!known.has(key)) throw new ArgError(`${command.name} has no argument "${key}". Run \`pob help ${command.name}\`.`);
  }
  for (const spec of command.args ?? []) {
    let value = coerce(spec, input[spec.name]);
    if (value === undefined && spec.default !== undefined) value = spec.default;
    if (value === undefined) {
      if (spec.required) throw new ArgError(`${command.name} needs ${spec.positional ? `<${spec.name}>` : `--${spec.name}`}: ${spec.description}`);
      continue;
    }
    if (spec.enum && !spec.enum.includes(value)) throw new ArgError(`--${spec.name} must be one of: ${spec.enum.join(', ')}.`);
    out[spec.name] = value;
  }
  return out;
}

/** JSON Schema for MCP tool definitions. */
export function jsonSchema(command) {
  const properties = {};
  const required = [];
  for (const spec of command.args ?? []) {
    const type = { integer: 'integer', number: 'number', boolean: 'boolean', 'string[]': 'array', json: undefined }[spec.type] ?? 'string';
    const prop = { description: spec.description };
    if (type) prop.type = type;
    if (type === 'array') prop.items = { type: 'string' };
    if (spec.enum) prop.enum = spec.enum;
    properties[spec.name] = prop;
    if (spec.required) required.push(spec.name);
  }
  return { type: 'object', properties, required, additionalProperties: false };
}
