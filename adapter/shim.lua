#@ SimpleGraphic
-- PoB AI entry script. The PoB launcher accepts a script as its first argument, so
--   "Path of Building-PoE2.exe" "<pob-ai>/adapter/shim.lua" [build.xml]
-- starts the user's own, unmodified PoB with the PoB AI bridge loaded beside it.
-- PoB keeps its own settings, build folder and self-update; no PoB file is changed.

local adapter = GetScriptPath()
local root = GetRuntimePath()
POBAI_ROOT = root
POBAI_ADAPTER = adapter
POBAI_MODE = 'live'

-- PoB resolves modules against the script folder; point it back at the PoB install.
SetWorkDir(root)
GetScriptPath = function() return root end
local function resolve(name)
	return root .. '/' .. (name:match('%.lua$') and name or name .. '.lua')
end
LoadModule = function(name, ...)
	local chunk, err = loadfile(resolve(name))
	if not chunk then error("LoadModule() error loading '" .. name .. "': " .. tostring(err)) end
	return chunk(...)
end
PLoadModule = function(name, ...)
	local chunk, err = loadfile(resolve(name))
	if not chunk then return err end
	local result = { pcall(chunk, ...) }
	if not result[1] then return result[2] end
	return nil, unpack(result, 2)
end
package.path = package.path .. ';' .. adapter .. '/?.lua'

function pobai_log(text) ConPrintf('%s', '[pob-ai] ' .. tostring(text)) end
function pobai_read_file(name)
	local file = io.open(name, 'rb')
	if not file then return nil end
	local text = file:read('*a')
	file:close()
	return text
end
function pobai_write_file(name, text)
	local file = assert(io.open(name, 'wb'))
	file:write(text)
	file:close()
end

dofile('Launch.lua')

local launchInit = launch.OnInit
launch.OnInit = function(self, ...)
	launchInit(self, ...)
	if not self.main then return end
	POBAI_MAIN = self.main
	local ok, err = pcall(dofile, adapter .. '/live/bridge.lua')
	if not ok then pobai_log('bridge failed to load: ' .. tostring(err)) end
end
