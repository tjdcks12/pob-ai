-- PoB AI headless host.
-- Provides the SimpleGraphic host functions PoB expects, without a window, so the user's
-- installed PoB can calculate builds in a background process. The function set follows
-- PoB's own src/HeadlessWrapper.lua (MIT, Path of Building Community; see
-- THIRD_PARTY_NOTICES.md). Expects globals POBAI_ROOT (PoB folder) and POBAI_ADAPTER.

package.path = './lua/?.lua;./lua/?/init.lua;./?.lua;./?/init.lua;' .. POBAI_ADAPTER .. '/?.lua'
package.cpath = './?.dll'
arg = {}

local stderr = io.stderr
function pobai_log(text) stderr:write(tostring(text), '\n'); stderr:flush() end
print = function(...)
	local parts = {}
	for i = 1, select('#', ...) do parts[i] = tostring(select(i, ...)) end
	pobai_log(table.concat(parts, ' '))
end

-- File writes are limited to what the pob-ai asks for explicitly (pobai_write_file), so the
-- headless engine never rewrites the user's Settings.xml or build files behind their back.
local rawOpen = io.open
local sink = { write = function(self) return self end, close = function() return true end, flush = function() end,
	read = function() return nil end, lines = function() return function() return nil end end, seek = function() return 0 end }
io.open = function(name, mode)
	if (mode or 'r'):find('[wa+]') then return sink end
	return rawOpen(name, mode)
end
function pobai_write_file(name, text)
	local file = assert(rawOpen(name, 'wb'))
	file:write(text)
	file:close()
end
function pobai_read_file(name)
	local file = rawOpen(name, 'rb')
	if not file then return nil end
	local text = file:read('*a')
	file:close()
	return text
end
os.execute = function() return nil end
os.remove = function() return nil end
os.rename = function() return nil end
io.read = function() return nil end

-- zlib through LuaJIT FFI, using the zlib1.dll that ships with PoB.
local ffi = require('ffi')
ffi.cdef [[
int compress2(unsigned char *dest, unsigned long *destLen, const unsigned char *source, unsigned long sourceLen, int level);
int uncompress(unsigned char *dest, unsigned long *destLen, const unsigned char *source, unsigned long sourceLen);
]]
local zlib = ffi.load(POBAI_ROOT .. '/zlib1.dll')
function Deflate(data)
	local size = ffi.new('unsigned long[1]', #data + math.floor(#data / 1000) + 64)
	local dest = ffi.new('unsigned char[?]', size[0])
	assert(zlib.compress2(dest, size, data, #data, 9) == 0, 'Deflate failed')
	return ffi.string(dest, size[0])
end
function Inflate(data)
	local capacity = math.max(#data * 8, 4096)
	while capacity <= 64 * 1024 * 1024 do
		local size = ffi.new('unsigned long[1]', capacity)
		local dest = ffi.new('unsigned char[?]', capacity)
		local code = zlib.uncompress(dest, size, data, #data)
		if code == 0 then return ffi.string(dest, size[0]) end
		if code ~= -5 then return nil end
		capacity = capacity * 2
	end
	return nil
end

-- Callbacks
local callbackTable = {}
local mainObject
function runCallback(name, ...)
	if callbackTable[name] then return callbackTable[name](...) end
	if mainObject and mainObject[name] then return mainObject[name](mainObject, ...) end
end
function SetCallback(name, func) callbackTable[name] = func end
function GetCallback(name) return callbackTable[name] end
function SetMainObject(obj) mainObject = obj end

-- Images
local imageHandleClass = {}
imageHandleClass.__index = imageHandleClass
function NewImageHandle() return setmetatable({}, imageHandleClass) end
function imageHandleClass:Load() self.valid = true end
function imageHandleClass:Unload() self.valid = false end
function imageHandleClass:IsValid() return self.valid end
function imageHandleClass:SetLoadingPriority() end
function imageHandleClass:ImageSize() return 1, 1 end

-- Rendering
function RenderInit() end
function GetScreenSize() return 1920, 1080 end
function GetScreenScale() return 1 end
function GetVirtualScreenSize() return 1920, 1080 end
function GetDPIScaleOverridePercent() return 1 end
function SetDPIScaleOverridePercent() end
function SetClearColor() end
function SetDrawLayer() end
function SetViewport() end
function SetDrawColor() end
function GetDrawColor() return 1, 1, 1, 1 end
function DrawImage() end
function DrawImageQuad() end
function DrawString() end
function DrawStringWidth(height, font, text) return #tostring(text or '') * (height or 10) / 2 end
function DrawStringCursorIndex() return 0 end
function StripEscapes(text) return text:gsub('%^%d', ''):gsub('%^x%x%x%x%x%x%x', '') end
function GetAsyncCount() return 0 end

-- General
local started = os.clock()
function NewFileSearch() end
function SetWindowTitle() end
function GetCursorPos() return 0, 0 end
function SetCursorPos() end
function ShowCursor() end
function IsKeyDown() return false end
function Copy() end
function Paste() return '' end
function GetTime() return math.floor((os.clock() - started) * 1000) end
function GetScriptPath() return POBAI_ROOT end
function GetRuntimePath() return POBAI_ROOT end
function GetUserPath() return POBAI_ROOT .. '/.pobai-user' end
function MakeDir() end
function RemoveDir() end
function SetWorkDir() end
function GetWorkDir() return POBAI_ROOT end
function LaunchSubScript() end
function AbortSubScript() end
function IsSubScriptRunning() return false end
function LoadModule(fileName, ...)
	if not fileName:match('%.lua') then fileName = fileName .. '.lua' end
	local func, err = loadfile(fileName)
	if not func then error("LoadModule() error loading '" .. fileName .. "': " .. tostring(err)) end
	return func(...)
end
function PCall(func, ...)
	local ret = { pcall(func, ...) }
	if ret[1] then
		table.remove(ret, 1)
		return nil, unpack(ret)
	end
	return ret[2]
end
function PLoadModule(fileName, ...)
	if not fileName:match('%.lua') then fileName = fileName .. '.lua' end
	local func, err = loadfile(fileName)
	if not func then error("PLoadModule() error loading '" .. fileName .. "': " .. tostring(err)) end
	return PCall(func, ...)
end
function ConPrintf(fmt, ...) pobai_log(string.format(fmt, ...)) end
function ConPrintTable() end
function ConExecute() end
function ConClear() end
function SpawnProcess() end
function OpenURL() end
function SetProfiling() end
function Restart() end
function Exit() end
function TakeScreenshot() end
function GetCloudProvider() return nil, nil, nil end

local rawRequire = require
function require(name)
	-- No network from the headless engine; the service downloads build codes itself.
	if name == 'lcurl.safe' or name == 'lcurl' then return nil end
	return rawRequire(name)
end

-- Start PoB exactly as its launcher would, minus the update check.
dofile('Launch.lua')
launch.CheckForUpdate = function() end
runCallback('OnInit')
runCallback('OnFrame')
if mainObject.promptMsg then error('PoB failed to start: ' .. tostring(mainObject.promptMsg)) end

POBAI_MAIN = mainObject.main
POBAI_MODE = 'headless'
-- Tests point saves at a scratch folder instead of the user's build folder.
local buildDir = os.getenv('POBAI_BUILD_DIR')
if buildDir and buildDir ~= '' then
	POBAI_MAIN.buildPath = buildDir:gsub('\\', '/'):gsub('/?$', '/')
	POBAI_MAIN.defaultBuildPath = POBAI_MAIN.buildPath
end
function pobai_frame() runCallback('OnFrame') end
