-- The foreground PoB process can activate its WebView2 panel (or the legacy Edge app).
-- Browser window.focus() cannot restore a minimized native window or reliably raise it.
local ffi = require('ffi')
ffi.cdef [[
void* FindWindowExW(void*, void*, const uint16_t*, const uint16_t*);
uint32_t GetWindowThreadProcessId(void*, uint32_t*);
int IsIconic(void*);
int IsWindowVisible(void*);
int ShowWindowAsync(void*, int);
int SetForegroundWindow(void*);
int AllowSetForegroundWindow(uint32_t);
uint32_t RegisterWindowMessageW(const uint16_t*);
int PostMessageW(void*, uint32_t, uintptr_t, intptr_t);
void* OpenProcess(uint32_t, int, uint32_t);
int QueryFullProcessImageNameW(void*, uint32_t, uint16_t*, uint32_t*);
int CloseHandle(void*);
int WideCharToMultiByte(uint32_t, uint32_t, const uint16_t*, int, char*, int, const char*, int*);
int MultiByteToWideChar(uint32_t, uint32_t, const char*, int, uint16_t*, int);
void* ShellExecuteW(void*, const uint16_t*, const uint16_t*, const uint16_t*, const uint16_t*, int);
]]
local user32, kernel32 = ffi.load('user32'), ffi.load('kernel32')
local panel = {}

local function wide(text)
  local out = ffi.new('uint16_t[?]', #text + 1)
  for i = 1, #text do out[i - 1] = text:byte(i) end
  return out
end
local TITLE = wide('PoB AI')

local function isPanel(hwnd)
  local pid = ffi.new('uint32_t[1]')
  user32.GetWindowThreadProcessId(hwnd, pid)
  local process = kernel32.OpenProcess(0x1000, 0, pid[0]) -- PROCESS_QUERY_LIMITED_INFORMATION
  if process == nil then return false end
  local buffer, length = ffi.new('uint16_t[1024]'), ffi.new('uint32_t[1]', 1024)
  local ok = kernel32.QueryFullProcessImageNameW(process, 0, buffer, length) ~= 0
  kernel32.CloseHandle(process)
  if not ok then return false end
  local size = kernel32.WideCharToMultiByte(65001, 0, buffer, length[0], nil, 0, nil, nil)
  local text = ffi.new('char[?]', size + 1)
  kernel32.WideCharToMultiByte(65001, 0, buffer, length[0], text, size, nil, nil)
  local name = ffi.string(text, size):lower()
  return name:match('[/\\]msedge%.exe$') ~= nil or name:match('[/\\]pob%-ai%-panel%.exe$') ~= nil
end
jit.off(isPanel)

function panel.focus()
  user32.AllowSetForegroundWindow(0xffffffff)
  local child, owner
  if POBAI_DOCK then child, owner = POBAI_DOCK.pane() end
  if child ~= nil and isPanel(child) then
    if user32.IsIconic(owner) ~= 0 then user32.ShowWindowAsync(owner, 9) end
    local focused = user32.SetForegroundWindow(owner) ~= 0
    user32.PostMessageW(child, user32.RegisterWindowMessageW(wide('PoBAI.Dock.Focus.v1')), 0, 0)
    return { found = true, focused = focused }
  end
  local previous
  while true do
    local hwnd = user32.FindWindowExW(nil, previous, nil, TITLE)
    if hwnd == nil then return { found = false, focused = false } end
    previous = hwnd
    if isPanel(hwnd) then
      if user32.IsIconic(hwnd) ~= 0 then user32.ShowWindowAsync(hwnd, 9) -- SW_RESTORE
      elseif user32.IsWindowVisible(hwnd) == 0 then user32.ShowWindowAsync(hwnd, 5) end -- SW_SHOW
      return { found = true, focused = user32.SetForegroundWindow(hwnd) ~= 0 }
    end
  end
end
jit.off(panel.focus)

local nextOpen = 0
function panel.open(view)
  if GetTime() < nextOpen then return false end
  nextOpen = GetTime() + 2000
  local text = POBAI_ROOT .. '/PoB AI.exe'
  local count = kernel32.MultiByteToWideChar(65001, 0, text, #text, nil, 0)
  local file = ffi.new('uint16_t[?]', count + 1)
  kernel32.MultiByteToWideChar(65001, 0, text, #text, file, count)
  local result = ffi.load('shell32').ShellExecuteW(nil, wide('open'), file, wide(view == 'settings' and '--settings' or '--panel-only'), nil, 1)
  return tonumber(ffi.cast('intptr_t', result)) > 32
end
jit.off(panel.open)

return panel
