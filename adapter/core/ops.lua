-- Operation registry. Each module under adapter/ops adds operations; every op takes a plain
-- args table and returns plain data. Names match src/commands/registry.mjs.
local util = dofile(POBAI_ADAPTER .. '/core/util.lua')
POBAI_UTIL = util
local ops = {}
for _, module in ipairs({ 'build', 'tree', 'skills', 'items', 'config', 'calc', 'notes', 'party', 'options', 'account', 'ui' }) do
	local path = POBAI_ADAPTER .. '/ops/' .. module .. '.lua'
	if pobai_read_file(path) then dofile(path)(ops, util) end
end
return ops
