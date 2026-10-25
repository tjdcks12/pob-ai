-- HWND contract with desktop/PanelDock.cs. Widths here are physical pixels.
local ffi = require('ffi')
ffi.cdef [[
void* GetPropW(void*, const uint16_t*);
int SetPropW(void*, const uint16_t*, void*);
void* RemovePropW(void*, const uint16_t*);
int IsWindow(void*);
void* SetParent(void*, void*);
uint32_t RegisterWindowMessageW(const uint16_t*);
intptr_t SendMessageTimeoutW(void*, uint32_t, uintptr_t, intptr_t, uint32_t, uint32_t, uintptr_t*);
]]
local user = ffi.load('user32')
local function wide(s)
  local b = ffi.new('uint16_t[?]', #s + 1)
  for i = 1, #s do b[i-1] = s:byte(i) end
  return b
end
local HOST, WIDTH, PANE = wide('PoBAI.DockHost.v1'), wide('PoBAI.DockWidth.v1'), wide('PoBAI.DockPane.v1')
local RELEASE = user.RegisterWindowMessageW(wide('PoBAI.Dock.Release.v1'))
local dock, hwnd = {}, nil
function dock.install(h, bar)
  hwnd = h
  assert(user.SetPropW(h, HOST, ffi.cast('void*', bar)) ~= 0, 'cannot advertise panel host')
end
function dock.width(total, bar)
  if not hwnd then return 0 end
  user.SetPropW(hwnd, HOST, ffi.cast('void*', bar))
  local pane = user.GetPropW(hwnd, PANE)
  if pane == nil or user.IsWindow(pane) == 0 then
    user.RemovePropW(hwnd, WIDTH)
    return 0
  end
  local w = tonumber(ffi.cast('intptr_t', user.GetPropW(hwnd, WIDTH)))
  return math.max(0, math.min(w, total - 1))
end
function dock.pane() return hwnd and user.GetPropW(hwnd, PANE), hwnd end
function dock.uninstall()
  if not hwnd then return end
  user.RemovePropW(hwnd, HOST) -- stop the host timer reattaching during shutdown
  local pane = user.GetPropW(hwnd, PANE)
  if pane ~= nil and user.IsWindow(pane) ~= 0 then
    user.SendMessageTimeoutW(pane, RELEASE, 0, 0, 2, 500, nil)
    if user.GetPropW(hwnd, PANE) ~= nil then user.SetParent(pane, nil) end
  end
  user.RemovePropW(hwnd, WIDTH); user.RemovePropW(hwnd, PANE)
  hwnd = nil
end
jit.off(dock.uninstall)
POBAI_DOCK = dock
return dock
