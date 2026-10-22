// Every PoB operation the CLI, the MCP server and the agent can perform.
// `name` is also the adapter op name unless `op` is given. Commands with `local` run in Node.
import { bool, int, json, list, str } from './schema.mjs';
import { LOCAL } from './local.mjs';

const node = str('node', 'Passive node name (any unique part) or numeric id', { required: true, positional: true, rest: true });
const group = int('group', 'Skill group number from `pob skills list`', { required: true, positional: true });
const setId = str('set', 'Set id or title', { required: true, positional: true, rest: true });

/** @type {import('./schema.mjs').CommandSpec[]} */
export const COMMANDS = [
  // ---- app ----
  { name: 'open', summary: 'Open the PoB window with PoB AI attached (starts the service if needed)', local: LOCAL.open,
    args: [str('build', 'Build file to open (optional)')] },
  { name: 'status', summary: 'Show the PoB install, the service and whether the PoB window is connected', local: LOCAL.status },
  { name: 'setup', summary: 'Remember where PoB is installed', local: LOCAL.setup,
    args: [str('pobPath', 'PoB (PoE2) install folder', { required: true, positional: true, rest: true })] },
  { name: 'engine.info', summary: 'PoB version and engine mode (live window or headless)' },
  { name: 'engine.ops', summary: 'Operations the PoB AI adapter provides (diagnostics)' },

  // ---- build ----
  { name: 'build.summary', summary: 'Current build: class, level, main skill, key stats, file and save state' },
  { name: 'build.new', summary: 'Start a new empty build', mutates: true,
    args: [str('name', 'Build name'), str('class', 'Class name, e.g. Ranger'), str('ascendancy', 'Ascendancy name'), int('level', 'Character level'), bool('discard', 'Throw away unsaved changes in the open PoB build')] },
  { name: 'build.list', summary: 'List saved builds in the PoB build folder', local: LOCAL.listBuilds,
    args: [str('search', 'Filter by name'), str('folder', 'Sub-folder inside the build folder')] },
  { name: 'build.open', summary: 'Open a saved build by name or file path', mutates: true, local: LOCAL.openBuild,
    args: [str('build', 'Build name from `pob build list` or a .xml path', { required: true, positional: true, rest: true }), bool('discard', 'Throw away unsaved changes in the open PoB build')] },
  { name: 'build.import', summary: 'Import a build from a PoB code or link (pobb.in, poe.ninja, pastebin, …)', mutates: true, local: LOCAL.importBuild,
    args: [str('source', 'Build code or URL', { required: true, positional: true }), str('name', 'Name for the imported build'), bool('discard', 'Throw away unsaved changes in the open PoB build')],
    examples: ['pob build import https://pobb.in/abc123', 'pob build import eNrtfWl…'] },
  { name: 'build.export', summary: 'Export the current build as a PoB code or XML', local: LOCAL.exportBuild,
    args: [str('format', 'code or xml', { enum: ['code', 'xml'], default: 'code' }), str('out', 'Write to this file instead of printing')] },
  { name: 'build.save', summary: 'Save the build (like PoB Save / Save As)', mutates: true,
    args: [str('name', 'Save as a new file with this name'), bool('overwrite', 'Replace an existing file with the same name')],
    details: 'Without --name it saves to the current file (the first save picks the build name).' },
  { name: 'build.rename', summary: 'Rename the current build', mutates: true, args: [str('name', 'New name', { required: true, positional: true, rest: true })] },
  { name: 'build.load_xml', summary: 'Load a build from PoB XML text (advanced)', op: 'build.load', mutates: true,
    args: [str('xml', 'PoB build XML', { required: true }), str('name', 'Build name'), str('file', 'File path relative to the build folder'), bool('discard', 'Throw away unsaved changes in the open PoB build')] },
  { name: 'build.paths', summary: 'PoB build and settings folders (advanced)' },
  { name: 'build.xml', summary: 'Current build as PoB XML (advanced)' },

  // ---- character ----
  { name: 'character.classes', summary: 'List classes and their ascendancies' },
  { name: 'character.level', summary: 'Set the character level', mutates: true, args: [int('level', 'Level 1-100', { required: true, positional: true })] },
  { name: 'character.class', summary: 'Change class (resets the passive tree like PoB does)', mutates: true,
    args: [str('class', 'Class name', { required: true, positional: true, rest: true }), bool('connect', 'Keep the tree by allocating a path to the new class start instead of resetting it')] },
  { name: 'character.ascendancy', summary: 'Change ascendancy', mutates: true,
    args: [str('ascendancy', 'Ascendancy name, or "none"', { required: true, positional: true, rest: true })] },

  // ---- passive tree ----
  { name: 'tree.summary', summary: 'Allocated points, keystones, notables, ascendancy and jewel sockets' },
  { name: 'tree.search', summary: 'Find passive nodes by name or stat text',
    args: [str('text', 'Words to look for', { required: true, positional: true, rest: true }), str('type', 'Only this node type', { enum: ['normal', 'notable', 'keystone', 'socket', 'ascendancy', 'attribute'] }),
      bool('allocated', 'Only allocated (true) or unallocated (false) nodes'), int('limit', 'Maximum results', { default: 25 })] },
  { name: 'tree.node', summary: 'Details of one passive node, including the path from your tree', args: [node] },
  { name: 'tree.allocate', summary: 'Allocate a node and the shortest path to it', mutates: true,
    args: [node, int('weaponSet', 'Allocate as a weapon set 1 or 2 passive', { enum: [1, 2] }), str('attribute', 'Attribute for attribute nodes on the path: str, dex or int', { enum: ['str', 'dex', 'int'] })] },
  { name: 'tree.deallocate', summary: 'Remove a node (and nodes that depend on it)', mutates: true, args: [node] },
  { name: 'tree.attribute', summary: 'Choose the attribute granted by an attribute node', mutates: true,
    args: [str('node', 'Attribute node name or id', { required: true, positional: true }), str('attribute', 'str, dex or int', { required: true, positional: true, enum: ['str', 'dex', 'int'] })] },
  { name: 'tree.reset', summary: 'Refund all passive points (keeps class and ascendancy)', mutates: true,
    args: [bool('keepAscendancy', 'Keep ascendancy nodes', { default: true })] },
  { name: 'tree.sets', summary: 'List passive tree sets' },
  { name: 'tree.set_select', summary: 'Switch to a passive tree set', mutates: true, args: [setId] },
  { name: 'tree.set_new', summary: 'Create a passive tree set', mutates: true, args: [str('name', 'Set name'), bool('copy', 'Copy the current set')] },
  { name: 'tree.set_rename', summary: 'Rename the active passive tree set', mutates: true, args: [str('name', 'New name', { required: true, positional: true, rest: true })] },
  { name: 'tree.set_delete', summary: 'Delete a passive tree set', mutates: true, args: [setId] },
  { name: 'tree.versions', summary: 'Tree version of the build and the versions PoB supports' },
  { name: 'tree.convert', summary: 'Convert the active tree set to another tree version', mutates: true, args: [str('version', 'Tree version id', { required: true, positional: true })] },

  // ---- skills & gems ----
  { name: 'skills.list', summary: 'Skill groups, their gems and which skill is the main skill' },
  { name: 'skills.add', summary: 'Add a skill group from gem names', mutates: true,
    args: [list('gems', 'Gem names, active skill first', { required: true, positional: true, rest: true }), str('label', 'Group label'), str('slot', 'Item slot the group is socketed in'),
      int('level', 'Gem level for all gems'), int('quality', 'Quality for all gems')],
    examples: ['pob skills add "Spark" "Lightning Infusion" --level 20'] },
  { name: 'skills.remove', summary: 'Remove a skill group', mutates: true, args: [group] },
  { name: 'skills.set', summary: 'Change a skill group (enabled, label, slot, Full DPS, count)', mutates: true,
    args: [group, bool('enabled', 'Enable or disable the group'), str('label', 'Label'), str('slot', 'Item slot'), bool('fullDps', 'Include in Full DPS'), int('count', 'Number of copies (e.g. totems, minions)')] },
  { name: 'skills.main', summary: 'Choose the main skill used for the sidebar and DPS', mutates: true,
    args: [group, int('active', 'Which active skill in the group (1 = first)'), int('part', 'Skill part / stage number'), str('minion', 'Minion to use for minion skills')] },
  { name: 'skills.sets', summary: 'List skill sets' },
  { name: 'skills.set_select', summary: 'Switch to a skill set', mutates: true, args: [setId] },
  { name: 'skills.set_new', summary: 'Create a skill set', mutates: true, args: [str('name', 'Set name'), bool('copy', 'Copy the current set')] },
  { name: 'skills.set_delete', summary: 'Delete a skill set', mutates: true, args: [setId] },
  { name: 'gems.search', summary: 'Find gems by name, tag or description',
    args: [str('text', 'Words to look for', { required: true, positional: true, rest: true }), str('kind', 'active or support', { enum: ['active', 'support'] }), int('limit', 'Maximum results', { default: 25 })] },
  { name: 'gems.add', summary: 'Add a gem to a skill group', mutates: true,
    args: [group, str('gem', 'Gem name', { required: true, positional: true, rest: true }), int('level', 'Gem level'), int('quality', 'Quality')] },
  { name: 'gems.set', summary: 'Change a gem (level, quality, enabled, replace)', mutates: true,
    args: [group, int('index', 'Gem number inside the group', { required: true, positional: true }), int('level', 'Gem level'), int('quality', 'Quality'),
      bool('enabled', 'Enable or disable'), str('gem', 'Replace with this gem'), int('count', 'Count'), int('part', 'Skill part')] },
  { name: 'gems.remove', summary: 'Remove a gem from a skill group', mutates: true,
    args: [group, int('index', 'Gem number inside the group', { required: true, positional: true })] },

  // ---- items ----
  { name: 'items.list', summary: 'Equipped items by slot and items in the build' },
  { name: 'items.show', summary: 'Full text and modifiers of an item',
    args: [str('item', 'Slot name or item id', { required: true, positional: true, rest: true })] },
  { name: 'items.add', summary: 'Add an item from its in-game copy text (Ctrl+C), optionally equipping it', mutates: true, local: LOCAL.addItem,
    args: [str('text', 'Item text', { required: true }), str('equip', 'Slot to equip it in')],
    details: 'Text copied from the game client in any supported language is converted to the English text PoB reads.' },
  { name: 'items.add_english', summary: 'Add an item from English PoB item text (advanced)', op: 'items.add', mutates: true,
    args: [str('text', 'English item text', { required: true }), str('equip', 'Slot to equip it in')] },
  { name: 'items.add_unique', summary: 'Add a unique item from PoB\'s unique list', mutates: true,
    args: [str('name', 'Unique name', { required: true, positional: true, rest: true }), str('equip', 'Slot to equip it in'), int('variant', 'Variant number when the unique has several')] },
  { name: 'items.craft', summary: 'Create a custom item from a base type and modifier lines', mutates: true,
    args: [str('base', 'Base type, e.g. "Lunar Amulet"', { required: true }), str('rarity', 'NORMAL, MAGIC, RARE or UNIQUE', { enum: ['NORMAL', 'MAGIC', 'RARE', 'UNIQUE'], default: 'RARE' }),
      list('mod', 'A modifier line; repeat --mod for several'), list('implicit', 'An implicit modifier line; repeat for several'), str('name', 'Item name'), int('quality', 'Quality'), str('equip', 'Slot to equip it in')] },
  { name: 'items.equip', summary: 'Equip an item from the build in a slot', mutates: true,
    args: [str('item', 'Item id or name', { required: true, positional: true }), str('slot', 'Slot name', { required: true, positional: true, rest: true })] },
  { name: 'items.unequip', summary: 'Empty a slot', mutates: true, args: [str('slot', 'Slot name', { required: true, positional: true, rest: true })] },
  { name: 'items.remove', summary: 'Delete an item from the build', mutates: true, args: [str('item', 'Item id or name', { required: true, positional: true, rest: true })] },
  { name: 'items.toggle', summary: 'Turn a flask or charm on or off for calculations', mutates: true,
    args: [str('slot', 'Flask or charm slot, e.g. "Flask 1"', { required: true, positional: true, rest: true }), bool('active', 'On or off', { required: true })] },
  { name: 'items.uniques', summary: 'Search PoB\'s unique item list',
    args: [str('text', 'Name, base or modifier text', { required: true, positional: true, rest: true }), int('limit', 'Maximum results', { default: 20 })] },
  { name: 'items.bases', summary: 'Search base item types',
    args: [str('text', 'Base name or item class', { required: true, positional: true, rest: true }), int('limit', 'Maximum results', { default: 20 })] },
  { name: 'items.slots', summary: 'Slot names available in this build' },
  { name: 'items.weapon_set', summary: 'Use weapon set 1 or 2 for calculations', mutates: true, args: [int('set', '1 or 2', { required: true, positional: true, enum: [1, 2] })] },
  { name: 'items.sets', summary: 'List item sets' },
  { name: 'items.set_select', summary: 'Switch to an item set', mutates: true, args: [setId] },
  { name: 'items.set_new', summary: 'Create an item set', mutates: true, args: [str('name', 'Set name'), bool('copy', 'Copy the current set')] },
  { name: 'items.set_delete', summary: 'Delete an item set', mutates: true, args: [setId] },

  // ---- configuration ----
  { name: 'config.list', summary: 'Configuration options (enemy, buffs, conditions) with current values',
    args: [str('search', 'Filter by key or label'), bool('changed', 'Only options that differ from default'), int('limit', 'Maximum results', { default: 60 })] },
  { name: 'config.set', summary: 'Set a configuration option', mutates: true,
    args: [str('key', 'Option key from `pob config list`', { required: true, positional: true }), json('value', 'New value (true/false, number or list value)', { required: true, positional: true })],
    examples: ['pob config set enemyIsBoss Pinnacle', 'pob config set conditionShockedEffect 30'] },
  { name: 'config.reset', summary: 'Reset a configuration option to its default', mutates: true, args: [str('key', 'Option key', { required: true, positional: true })] },
  { name: 'config.sets', summary: 'List configuration sets' },
  { name: 'config.set_select', summary: 'Switch to a configuration set', mutates: true, args: [setId] },
  { name: 'config.set_new', summary: 'Create a configuration set', mutates: true, args: [str('name', 'Set name'), bool('copy', 'Copy the current set')] },

  // ---- calculations ----
  { name: 'calc.stats', summary: 'Calculated stats of the main skill and the character',
    args: [list('keys', 'Only these stat keys'), bool('all', 'Every numeric stat PoB computed')] },
  { name: 'calc.skills', summary: 'Damage of every skill included in Full DPS' },
  { name: 'calc.warnings', summary: 'Build warnings PoB shows (missing requirements, overcapped reservation, …)' },
  { name: 'calc.whatif', summary: 'Stat changes from a hypothetical change, without keeping it', local: LOCAL.whatif,
    args: [str('node', 'Allocate this passive node'), str('removeNode', 'Remove this passive node'), str('item', 'Item text to try'), str('slot', 'Slot for --item'),
      str('gem', 'Support gem to add to the main skill group'), json('config', 'Configuration changes as {"key": value}'), list('keys', 'Stat keys to report')],
    examples: ['pob calc whatif --node "Heart of the Warrior"', 'pob calc whatif --config "{\\"enemyIsBoss\\":\\"Pinnacle\\"}"'] },
  { name: 'calc.whatif_english', summary: 'What-if with English item text (advanced)', op: 'calc.whatif',
    args: [str('node', 'Allocate this passive node'), str('removeNode', 'Remove this passive node'), str('item', 'English item text'), str('slot', 'Slot for --item'),
      str('gem', 'Support gem to add to the main skill group'), json('config', 'Configuration changes as {"key": value}'), list('keys', 'Stat keys to report')] },
  { name: 'calc.node_power', summary: 'Rank unallocated passive nodes near your tree by stat gain',
    args: [str('stat', 'Stat to rank by, e.g. FullDPS, TotalEHP or Minion.CombinedDPS (default: the main damage of the build)'), int('limit', 'Maximum results', { default: 15 }), int('maxDistance', 'Only nodes this many points away or closer', { default: 6 }),
      str('type', 'Only notable or keystone nodes', { enum: ['notable', 'keystone', 'any'], default: 'notable' })] },
  { name: 'calc.compare', summary: 'Compare the current build with another build code, link or saved build', local: LOCAL.compare,
    args: [str('other', 'Build code, URL or saved build name', { required: true, positional: true, rest: true }), list('keys', 'Stat keys to compare')] },

  { name: 'calc.compare_xml', summary: 'Compare the current build with another build given as XML (advanced)',
    args: [str('xml', 'PoB build XML', { required: true }), list('keys', 'Stat keys to compare')] },

  // ---- notes ----
  { name: 'notes.get', summary: 'Read the build notes' },
  { name: 'notes.set', summary: 'Replace or append to the build notes', mutates: true,
    args: [str('text', 'Notes text', { required: true, positional: true, rest: true }), bool('append', 'Append instead of replacing')] },

  // ---- PoB window ----
  { name: 'ui.state', summary: 'What the PoB window shows: tab, build and selection', live: true },
  { name: 'ui.tab', summary: 'Switch the PoB window to a tab and highlight it', live: true,
    args: [str('tab', 'Tab name', { required: true, positional: true, enum: ['tree', 'skills', 'items', 'calcs', 'config', 'notes', 'import', 'party', 'compare'] }), str('caption', 'Short caption next to the highlight')] },
  { name: 'ui.show_node', summary: 'Center the passive tree on a node and highlight it', live: true,
    args: [node, str('caption', 'Short caption next to the highlight')] },
  { name: 'ui.show_slot', summary: 'Open the Items tab and highlight an item slot', live: true,
    args: [str('slot', 'Slot name', { required: true, positional: true, rest: true }), str('caption', 'Short caption')] },
  { name: 'ui.show_gem', summary: 'Open the Skills tab on a skill group and highlight it', live: true,
    args: [group, int('index', 'Gem number to highlight'), str('caption', 'Short caption')] },
  { name: 'ui.show_config', summary: 'Open the Configuration tab and highlight an option', live: true,
    args: [str('key', 'Option key', { required: true, positional: true }), str('caption', 'Short caption')] },
  { name: 'ui.show_stat', summary: 'Highlight a stat in the sidebar or the Calcs tab', live: true,
    args: [str('stat', 'Stat key or label, e.g. Life or FullDPS', { required: true, positional: true, rest: true }), str('caption', 'Short caption')] },
  { name: 'ui.show_control', summary: 'Highlight a named control of the current tab (advanced)', live: true,
    args: [str('control', 'Control name as listed by `pob ui state`', { required: true, positional: true }), str('caption', 'Short caption')] },
  { name: 'ui.clear', summary: 'Remove highlights', live: true },
  { name: 'ui.theme', summary: 'Recolor the PoB window (remembered for next time)', local: LOCAL.theme,
    args: [str('theme', 'Theme name', { required: true, positional: true, enum: ['default', 'ember', 'vaal', 'midnight'] })] },
  { name: 'ui.theme_apply', summary: 'Apply a theme to the open PoB window now (advanced)', op: 'ui.theme', live: true,
    args: [str('theme', 'Theme name', { required: true, positional: true, enum: ['default', 'ember', 'vaal', 'midnight'] })] },
];

const byName = new Map(COMMANDS.map(c => [c.name, c]));
export const findCommand = name => byName.get(name);

export function groups() {
  const out = new Map();
  for (const c of COMMANDS) {
    const g = c.name.includes('.') ? c.name.split('.')[0] : 'app';
    if (!out.has(g)) out.set(g, []);
    out.get(g).push(c);
  }
  return out;
}

export { validateArgs } from './schema.mjs';
