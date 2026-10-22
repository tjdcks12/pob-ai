// Minimal MCP server (Streamable HTTP, JSON responses) exposing every registry command as a tool.
// The same commands are available as `pob ...` on the command line.
import { COMMANDS, findCommand } from '../commands/registry.mjs';
import { jsonSchema } from '../commands/schema.mjs';
import { VERSION } from '../update/updater.mjs';

const PROTOCOL = '2025-06-18';
export const toolName = name => `pob_${name.replace(/\./g, '_')}`;
const byTool = () => new Map(COMMANDS.map(c => [toolName(c.name), c]));

export function mcpTools() {
  return COMMANDS.map(c => ({
    name: toolName(c.name),
    description: `${c.summary}${c.details ? `\n${c.details}` : ''}${c.live ? '\nNeeds the PoB window.' : ''}\nCLI: pob ${c.name.replace(/\./g, ' ').replace(/_/g, '-')}`,
    inputSchema: jsonSchema(c),
    annotations: { readOnlyHint: !c.mutates },
  }));
}

export async function handleMcp(req, res, service, message) {
  if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); return res.end(); }
  const reply = body => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (!message || message.jsonrpc !== '2.0') return reply({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } });
  if (message.id === undefined) { res.writeHead(202); return res.end(); }
  const ok = result => reply({ jsonrpc: '2.0', id: message.id, result });
  switch (message.method) {
    case 'initialize':
      return ok({ protocolVersion: message.params?.protocolVersion ?? PROTOCOL, capabilities: { tools: {} },
        serverInfo: { name: 'pob-ai', version: VERSION },
        instructions: 'Path of Building (PoE2) tools. Read with pob_build_summary / query tools, change with mutating tools, then verify with pob_calc_stats. Use pob_ui_* tools to show the user where something is.' });
    case 'ping': return ok({});
    case 'tools/list': return ok({ tools: mcpTools() });
    case 'tools/call': {
      const command = byTool().get(message.params?.name) ?? findCommand(message.params?.name);
      if (!command) return reply({ jsonrpc: '2.0', id: message.id, error: { code: -32602, message: `Unknown tool ${message.params?.name}` } });
      try {
        const outcome = await service.runtime.run(command.name, message.params?.arguments ?? {});
        if (command.mutates) service.broadcast('build-changed', { command: command.name });
        return ok({ content: [{ type: 'text', text: JSON.stringify(outcome) }] });
      } catch (error) {
        return ok({ isError: true, content: [{ type: 'text', text: JSON.stringify({ code: error.code ?? 'ERROR', message: error.message, details: error.details }) }] });
      }
    }
    default:
      return reply({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } });
  }
}
