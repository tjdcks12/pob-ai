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

local logFile = os.getenv('POBAI_LOG')
function pobai_log(text)
	ConPrintf('%s', '[pob-ai] ' .. tostring(text))
	if not logFile or logFile == '' then return end
	local file = io.open(logFile, 'ab')
	if file then file:write(os.date('!%Y-%m-%dT%H:%M:%SZ '), tostring(text), '\n') file:close() end
end
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
	if not self.main then pobai_log('PoB did not start its main module') return end
	POBAI_MAIN = self.main
	local ok, err = pcall(dofile, adapter .. '/live/bridge.lua')
	pobai_log(ok and 'bridge loaded' or ('bridge failed to load: ' .. tostring(err)))
	-- PoB AI title bar in place of the Windows caption. Runs again after PoB's Restart(), which
	-- re-runs this script; on any failure the window keeps its Windows caption.
	if os.getenv('POBAI_TITLEBAR') ~= 'windows' then
		ok, err = pcall(function()
			dofile(adapter .. '/live/window.lua')
			POBAI_WINDOW.install()
		end)
		if not ok then pobai_log('title bar not installed: ' .. tostring(err)) end
	end
end

-- PoB's Restart() (dev F5, "normal" self-update) reloads the entry script from the script
-- working directory, which SetWorkDir above moved to the PoB folder; point it back at the
-- adapter once PoB has shut down so the restart runs this shim again.
local launchExit = launch.OnExit
launch.OnExit = function(self, ...)
	-- The title bar's window callback must be gone before this Lua state closes.
	if POBAI_WINDOW then pcall(POBAI_WINDOW.uninstall) end
	launchExit(self, ...)
	SetWorkDir(adapter)
end

-- Tells the PoB AI service that PoB is applying its own update. A "basic" update exits and PoB's
-- updater starts PoB again without this shim; the service then reopens PoB with it.
local applyUpdate = launch.ApplyUpdate
launch.ApplyUpdate = function(self, mode, ...)
	pobai_log('PoB update: ' .. tostring(mode))
	if pobai_emit then pcall(pobai_emit, { kind = 'pob-updating', mode = mode }) end
	return applyUpdate(self, mode, ...)
end
