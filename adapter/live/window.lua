-- PoB AI title bar: replaces the Windows caption of the PoB window with a 36px bar drawn in Lua
-- (PoB AI mark, the window title PoB sets, an "AI" button that opens the agent panel, and
-- minimize / maximize / close). No PoB file is changed:
--   * The window keeps its normal styles; a comctl32 window subclass answers WM_NCCALCSIZE with
--     "no frame" (the whole window is client area, inset by the frame while maximized so it fits
--     the work area) and WM_NCHITTEST with resize edges, HTCAPTION on the empty bar and
--     HTMAXBUTTON on the maximize button. Windows itself then does dragging, double-click
--     maximize, Aero Snap, edge resizing and the Windows 11 snap layouts menu.
--   * PoB's whole UI moves below the bar: SetViewport, GetScreenSize, GetCursorPos and
--     SetCursorPos are wrapped so PoB sees a screen that starts under the bar, and mouse input
--     over the bar is kept from PoB.
--   * Buttons post window messages (WM_SYSCOMMAND, WM_CLOSE), so closing goes through PoB's
--     unsaved-changes check exactly like the Windows close button.
-- Window callbacks run Lua inside PoB, so every callback body is protected, every function that
-- can re-enter the callback is excluded from the JIT, and the subclass is removed before the Lua
-- state closes (shim.lua calls uninstall first thing in OnExit). Any failure puts the Windows
-- caption back and logs to pob-window.log.
--
-- Icons (adapter/live/assets): white PNGs tinted with SetDrawColor. tb-minus-32, tb-close-32 and
-- tb-sparkles-32 are Lucide minus, x and sparkles at 32px (2x of 16px); tb-square-26 and
-- tb-restore-26 are Lucide square and copy at 26px (2x of 13px), all with stroke-width 1.75,
-- matching poe2way's title bar. pobai-mark-36 is ui/icon.svg without its dark tile, gold made
-- white, at 36px (2x of 18px). They were rendered from inline SVG with headless Chrome
-- (--default-background-color=00000000) and cropped with System.Drawing, keeping only alpha.
local ffi = require('ffi')
local bit = require('bit')

local window = { active = false }
POBAI_WINDOW = window

ffi.cdef [[
typedef struct { int32_t left, top, right, bottom; } POBAI_RECT;
typedef struct { int32_t x, y; } POBAI_POINT;
typedef struct { POBAI_POINT reserved, maxSize, maxPosition, minTrackSize, maxTrackSize; } POBAI_MINMAXINFO;
typedef intptr_t (__stdcall *POBAI_SUBCLASSPROC)(void*, uint32_t, uintptr_t, intptr_t, uintptr_t, uintptr_t);
int SetWindowSubclass(void*, POBAI_SUBCLASSPROC, uintptr_t, uintptr_t);
int RemoveWindowSubclass(void*, POBAI_SUBCLASSPROC, uintptr_t);
intptr_t DefSubclassProc(void*, uint32_t, uintptr_t, intptr_t);
int SetWindowPos(void*, void*, int, int, int, int, uint32_t);
int GetWindowRect(void*, POBAI_RECT*);
int GetClientRect(void*, POBAI_RECT*);
int ClientToScreen(void*, POBAI_POINT*);
int ScreenToClient(void*, POBAI_POINT*);
int GetCursorPos(POBAI_POINT*);
void* WindowFromPoint(POBAI_POINT);
int IsZoomed(void*);
int PostMessageW(void*, uint32_t, uintptr_t, intptr_t);
intptr_t GetWindowLongPtrW(void*, int);
int GetWindowTextW(void*, uint16_t*, int);
int GetWindowTextLengthW(void*);
uint32_t GetDpiForWindow(void*);
int GetSystemMetricsForDpi(int, uint32_t);
int AdjustWindowRectExForDpi(POBAI_RECT*, uint32_t, int, uint32_t, uint32_t);
int WideCharToMultiByte(uint32_t, uint32_t, const uint16_t*, int, char*, int, const char*, int*);
typedef struct GLFWwindow GLFWwindow;
GLFWwindow* glfwGetCurrentContext(void);
void* glfwGetWin32Window(GLFWwindow*);
]]
local user32 = ffi.load('user32')
local comctl = ffi.load('comctl32')
local kernel32 = ffi.load('kernel32')
local glfw = ffi.load('glfw3')

local WM = { CLOSE = 0x0010, GETMINMAXINFO = 0x0024, NCCALCSIZE = 0x0083, NCHITTEST = 0x0084, NCLBUTTONDOWN = 0x00A1,
	NCLBUTTONUP = 0x00A2, NCLBUTTONDBLCLK = 0x00A3, SYSCOMMAND = 0x0112, NCMOUSELEAVE = 0x02A2 }
local SC = { MINIMIZE = 0xF020, MAXIMIZE = 0xF030, RESTORE = 0xF120 }
local HT = { CLIENT = 1, CAPTION = 2, MAXBUTTON = 9, LEFT = 10, RIGHT = 11, TOP = 12, TOPLEFT = 13, TOPRIGHT = 14,
	BOTTOM = 15, BOTTOMLEFT = 16, BOTTOMRIGHT = 17 }
local SWP = { NOSIZE = 0x1, NOMOVE = 0x2, NOZORDER = 0x4, NOACTIVATE = 0x10, FRAMECHANGED = 0x20 }
local SUBCLASS_ID = 0x504F4241 -- "POBA"
local EDGE = 6                 -- resize border inside the window, in virtual px
local LAYER = 10000             -- above PoB's popups (1000) and the agent overlay (950)
local MOUSE = { LEFTBUTTON = true, RIGHTBUTTON = true, MIDDLEBUTTON = true, MOUSE4 = true, MOUSE5 = true, WHEELUP = true, WHEELDOWN = true }
-- ui/icon.svg gradient stops, used to tint the white mark (the darker stop on the light theme).
local MARK = { dark = { 0.965, 0.769, 0.325 }, light = { 0.769, 0.416, 0.106 } }

local S = { title = '', themeId = 'dark', procErrors = 0, pobDown = {}, layout = { aiFrom = 0, aiTo = 0 } }
local raw = {}

local function log(text) if pobai_log then pobai_log('title bar: ' .. tostring(text)) end end
local function scale() return GetScreenScale and GetScreenScale() or 1 end
local function barPx() return math.floor(S.bar * scale() + 0.5) end

-- ===== Window procedure (runs inside Windows' message dispatch) =====
local function frameInset(h)
	local dpi = user32.GetDpiForWindow(h)
	local pad = user32.GetSystemMetricsForDpi(92, dpi) -- SM_CXPADDEDBORDER
	return user32.GetSystemMetricsForDpi(32, dpi) + pad, user32.GetSystemMetricsForDpi(33, dpi) + pad -- SM_CXFRAME, SM_CYFRAME
end

--- Grows a client rectangle by the frame Windows (and GLFW) put around it with this window's styles.
local function adjustForFrame(h, r)
	local style = ffi.cast('uint32_t', user32.GetWindowLongPtrW(h, -16))
	local exStyle = ffi.cast('uint32_t', user32.GetWindowLongPtrW(h, -20))
	user32.AdjustWindowRectExForDpi(r, style, 0, exStyle, user32.GetDpiForWindow(h))
end

local function frameSize(h)
	local r = ffi.new('POBAI_RECT')
	adjustForFrame(h, r)
	return r.right - r.left, r.bottom - r.top
end

--- Which part of the bar a client x (virtual px, measured from the right edge) is on.
local function barPart(fromRight)
	local btn = S.btn
	if fromRight < btn then return 'close' end
	if fromRight < btn * 2 then return 'max' end
	if fromRight < btn * 3 then return 'min' end
	if fromRight >= S.layout.aiFrom and fromRight < S.layout.aiTo then return 'ai' end
	return nil
end

local function toggleMaximize(h)
	user32.PostMessageW(h, WM.SYSCOMMAND, user32.IsZoomed(h) ~= 0 and SC.RESTORE or SC.MAXIMIZE, 0)
end

local function hitTest(h, lp)
	local p = ffi.new('POBAI_POINT')
	p.x = tonumber(ffi.cast('int16_t', bit.band(lp, 0xFFFF)))
	p.y = tonumber(ffi.cast('int16_t', bit.band(bit.rshift(lp, 16), 0xFFFF)))
	user32.ScreenToClient(h, p)
	local cr = ffi.new('POBAI_RECT')
	user32.GetClientRect(h, cr)
	local s = scale()
	if user32.IsZoomed(h) == 0 then
		local edge = math.floor(EDGE * s + 0.5)
		local top, bottom, left, right = p.y < edge, p.y >= cr.bottom - edge, p.x < edge, p.x >= cr.right - edge
		if top and left then return HT.TOPLEFT elseif top and right then return HT.TOPRIGHT
		elseif bottom and left then return HT.BOTTOMLEFT elseif bottom and right then return HT.BOTTOMRIGHT
		elseif top then return HT.TOP elseif bottom then return HT.BOTTOM elseif left then return HT.LEFT elseif right then return HT.RIGHT end
	end
	if p.y >= 0 and p.y < barPx() then
		local part = barPart((cr.right - p.x) / s)
		if part == 'max' then return HT.MAXBUTTON end
		return part and HT.CLIENT or HT.CAPTION
	end
	return HT.CLIENT
end

local function wndProc(h, msg, wp, lp)
	if msg == WM.NCCALCSIZE and wp ~= 0 then
		if user32.IsZoomed(h) ~= 0 then
			local r = ffi.cast('POBAI_RECT*', lp)
			local fx, fy = frameInset(h)
			r.left, r.top, r.right, r.bottom = r.left + fx, r.top + fy, r.right - fx, r.bottom - fy
		end
		return 0
	elseif msg == WM.NCHITTEST then
		return hitTest(h, tonumber(lp))
	elseif msg == WM.NCLBUTTONDOWN and wp == HT.MAXBUTTON then
		-- Handled here so Windows does not draw its own caption button.
		S.maxPressed = true
		return 0
	elseif msg == WM.NCLBUTTONDBLCLK and wp == HT.MAXBUTTON then
		return 0
	elseif msg == WM.NCLBUTTONUP and wp == HT.MAXBUTTON then
		if S.maxPressed then toggleMaximize(h) end
		S.maxPressed = false
		return 0
	elseif msg == WM.NCMOUSELEAVE then
		S.maxPressed = false
	elseif msg == WM.GETMINMAXINFO then
		-- GLFW adds a frame the window no longer has to PoB's minimum size; take it off and add
		-- the bar, so PoB keeps its own minimum below the bar.
		local result = comctl.DefSubclassProc(h, msg, wp, lp)
		local mmi = ffi.cast('POBAI_MINMAXINFO*', lp)
		local fw, fh = frameSize(h)
		mmi.minTrackSize.x = math.max(1, mmi.minTrackSize.x - fw)
		mmi.minTrackSize.y = math.max(1, mmi.minTrackSize.y - fh + barPx())
		return result
	end
	return comctl.DefSubclassProc(h, msg, wp, lp)
end
jit.off(wndProc)

local function safeProc(h, msg, wp, lp)
	local ok, result = pcall(wndProc, h, msg, wp, lp)
	if ok then return result end
	S.procErrors = S.procErrors + 1
	S.procError = result
	return comctl.DefSubclassProc(h, msg, wp, lp)
end
jit.off(safeProc)

-- ===== Drawing =====
local function loadImage(name)
	local handle = NewImageHandle()
	handle:Load(POBAI_ADAPTER .. '/live/assets/' .. name)
	local w = handle:ImageSize()
	assert(w and w > 0, 'cannot load ' .. name)
	return handle
end

local function color(c, a) raw.SetDrawColor(c[1], c[2], c[3], a or 1) end

local function icon(handle, x, size, c)
	color(c)
	raw.DrawImage(handle, math.floor(x - size / 2 + 0.5), math.floor((S.bar - size) / 2 + 0.5), size, size)
end

--- Bar part under the mouse, or nil. Asks Windows directly: over HTCAPTION and HTMAXBUTTON
--- the window gets no client mouse messages.
local function hoveredPart()
	local p = ffi.new('POBAI_POINT')
	if user32.GetCursorPos(p) == 0 or user32.WindowFromPoint(p) ~= S.hwnd then return nil end
	user32.ScreenToClient(S.hwnd, p)
	local s = scale()
	local sw = raw.GetScreenSize()
	if p.y < 0 or p.y >= barPx() then return nil end
	return barPart((sw - p.x) / s)
end
jit.off(hoveredPart)

-- Text goes through PoB AI's font (POBAI_FONT, adapter/live/atlas.lua) when it is loaded, so the
-- title shows non-ASCII build names and follows the window font; otherwise PoB's own drawing.
local function textDraw(...) if POBAI_FONT then return POBAI_FONT.draw(...) end return raw.DrawString(...) end
local function textWidth(...) if POBAI_FONT then return POBAI_FONT.width(...) end return raw.DrawStringWidth(...) end
local function aiWidth() return 10 + 16 + 6 + textWidth(14, 'VAR BOLD', 'AI') + 10 end

local function drawBar()
	local t = S.palette
	local s = scale()
	local sw, sh = raw.GetScreenSize()
	local vw = sw / s
	local bar, btn = S.bar, S.btn
	local hover = hoveredPart()
	local pressed = S.pressed or (S.maxPressed and 'max')
	SetDrawLayer(LAYER, 0)
	raw.SetViewport()
	color(t['surface-inner'])
	raw.DrawImage(nil, 0, 0, vw, bar - 1)
	color(t.divider)
	raw.DrawImage(nil, 0, bar - 1, vw, 1)

	-- Window buttons, right to left.
	local x = vw - btn
	if hover == 'close' then color(t.red) raw.DrawImage(nil, x, 0, btn, bar - 1) end
	icon(S.img.close, x + btn / 2, 16, hover == 'close' and { 1, 1, 1 } or t['fg-2'])
	x = x - btn
	if hover == 'max' or pressed == 'max' then color(t['surface-hover']) raw.DrawImage(nil, x, 0, btn, bar - 1) end
	icon(S.zoomed and S.img.restore or S.img.square, x + btn / 2, 13, hover == 'max' and t.fg or t['fg-2'])
	x = x - btn
	if hover == 'min' then color(t['surface-hover']) raw.DrawImage(nil, x, 0, btn, bar - 1) end
	icon(S.img.minus, x + btn / 2, 16, hover == 'min' and t.fg or t['fg-2'])

	-- "AI" button: opens the PoB AI agent panel.
	local aiW = aiWidth()
	local aiRight = x - 8
	local aiLeft = aiRight - aiW
	S.layout.aiFrom, S.layout.aiTo = vw - aiRight, vw - aiLeft
	if hover == 'ai' then color(t['surface-hover']) raw.DrawImage(nil, aiLeft, 6, aiW, bar - 13) end
	local aiColor = hover == 'ai' and t.fg or t['primary-text']
	icon(S.img.sparkles, aiLeft + 10 + 8, 16, aiColor)
	color(aiColor)
	textDraw(aiLeft + 10 + 16 + 6, math.floor((bar - 14) / 2), 'LEFT', 14, 'VAR BOLD', 'AI')

	-- PoB AI mark and the window title, clipped before the AI button.
	color(S.themeId == 'light' and MARK.light or MARK.dark)
	raw.DrawImage(S.img.mark, 12, (bar - 18) / 2, 18, 18)
	local titleLeft = 12 + 18 + 8
	if aiLeft - 12 > titleLeft then
		raw.SetViewport(titleLeft, 0, aiLeft - 12 - titleLeft, bar)
		color(t['fg-2'])
		textDraw(0, math.floor((bar - 14) / 2), 'LEFT', 14, 'VAR', S.title)
		raw.SetViewport()
	end
	raw.SetDrawColor(1, 1, 1, 1)
	SetDrawLayer(0, 0)
end
jit.off(drawBar)

-- ===== Mouse input over the bar =====
local function act(part)
	if part == 'close' then
		user32.PostMessageW(S.hwnd, WM.CLOSE, 0, 0)
	elseif part == 'min' then
		user32.PostMessageW(S.hwnd, WM.SYSCOMMAND, SC.MINIMIZE, 0)
	elseif part == 'max' then
		toggleMaximize(S.hwnd)
	elseif part == 'ai' then
		if pobai_emit then pobai_emit({ kind = 'open-panel' }) end
	end
end

local function partAtCursor()
	local x = raw.GetCursorPos()
	local sw = raw.GetScreenSize()
	return barPart(sw / scale() - x)
end

-- ===== Install / uninstall =====
local function setPos(h, x, y, w, hh, flags) return user32.SetWindowPos(h, nil, x, y, w, hh, flags) end
jit.off(setPos)

local function windowText(h)
	local n = user32.GetWindowTextLengthW(h)
	if n <= 0 then return '' end
	local wide = ffi.new('uint16_t[?]', n + 1)
	n = user32.GetWindowTextW(h, wide, n + 1)
	local size = kernel32.WideCharToMultiByte(65001, 0, wide, n, nil, 0, nil, nil)
	local out = ffi.new('char[?]', size + 1)
	kernel32.WideCharToMultiByte(65001, 0, wide, n, out, size, nil, nil)
	return ffi.string(out, size)
end
jit.off(windowText)

local function cleanTitle(text)
	return (tostring(text or ''):gsub('%^x%x%x%x%x%x%x', ''):gsub('%^%d', ''))
end

local wrappers = {}

local function wrapGlobals()
	raw.SetViewport, raw.GetScreenSize, raw.GetCursorPos, raw.SetCursorPos, raw.SetWindowTitle =
		SetViewport, GetScreenSize, GetCursorPos, SetCursorPos, SetWindowTitle
	wrappers.SetViewport = function(x, y, w, h)
		if x == nil then
			local s = scale()
			local sw, sh = raw.GetScreenSize()
			return raw.SetViewport(0, S.bar, sw / s, (sh - barPx()) / s)
		end
		return raw.SetViewport(x, y + S.bar, w, h)
	end
	wrappers.GetScreenSize = function()
		local w, h = raw.GetScreenSize()
		return w, h - barPx()
	end
	wrappers.GetCursorPos = function()
		local x, y = raw.GetCursorPos()
		return x, y - S.bar
	end
	wrappers.SetCursorPos = function(x, y) return raw.SetCursorPos(x, y + S.bar) end
	wrappers.SetWindowTitle = function(title, ...)
		S.title = cleanTitle(title)
		return raw.SetWindowTitle(title, ...)
	end
	for name, fn in pairs(wrappers) do _G[name] = fn end

	local launch = _G.launch
	raw.OnFrame, raw.OnKeyDown, raw.OnKeyUp = launch.OnFrame, launch.OnKeyDown, launch.OnKeyUp
	wrappers.OnFrame = function(self, ...)
		if window.active then
			if S.procErrors > 20 then window.fail('window callback: ' .. tostring(S.procError)) end
			S.zoomed = window.active and user32.IsZoomed(S.hwnd) ~= 0
			-- Launch.lua draws its own prompts after PoB; start the frame below the bar for both.
			SetViewport()
		end
		raw.OnFrame(self, ...)
		if window.active then
			local ok, err = pcall(drawBar)
			if not ok then window.fail('draw: ' .. tostring(err)) end
		end
	end
	wrappers.OnKeyDown = function(self, key, doubleClick)
		if window.active and MOUSE[key] then
			local _, y = raw.GetCursorPos()
			if y < S.bar then
				if key == 'LEFTBUTTON' then S.pressed = partAtCursor() end
				return
			end
			S.pobDown[key] = true
		end
		return raw.OnKeyDown(self, key, doubleClick)
	end
	wrappers.OnKeyUp = function(self, key)
		if window.active and MOUSE[key] then
			if key == 'LEFTBUTTON' and S.pressed then
				local part = S.pressed
				S.pressed = nil
				if partAtCursor() == part then
					local ok, err = pcall(act, part)
					if not ok then log(err) end
				end
				return
			end
			local _, y = raw.GetCursorPos()
			if not S.pobDown[key] and y < S.bar then return end
			S.pobDown[key] = nil
		end
		return raw.OnKeyUp(self, key)
	end
	launch.OnFrame, launch.OnKeyDown, launch.OnKeyUp = wrappers.OnFrame, wrappers.OnKeyDown, wrappers.OnKeyUp
end

local function unwrapGlobals()
	for _, name in ipairs({ 'SetViewport', 'GetScreenSize', 'GetCursorPos', 'SetCursorPos', 'SetWindowTitle' }) do
		if wrappers[name] and _G[name] == wrappers[name] then _G[name] = raw[name] end
	end
	local launch = _G.launch
	for _, name in ipairs({ 'OnFrame', 'OnKeyDown', 'OnKeyUp' }) do
		if launch and wrappers[name] and launch[name] == wrappers[name] then launch[name] = raw[name] end
	end
	wrappers = {}
end

--- Follows the PoB window theme: 'light' uses the light tokens, 'dark' and 'pob' the dark ones.
function window.setTheme(id)
	S.themeId = id == 'light' and 'light' or 'dark'
	if S.tokens then S.palette = S.tokens[S.themeId] end
end

local function install()
	S.tokens = dofile(POBAI_ADAPTER .. '/live/tokens.lua').load()
	S.bar = assert(tonumber(S.tokens.dark['titlebar-h']), 'no --titlebar-h token')
	S.btn = assert(tonumber(S.tokens.dark['titlebar-btn-w']), 'no --titlebar-btn-w token')
	window.setTheme(POBAI_THEME and POBAI_THEME.current or os.getenv('POBAI_THEME'))
	raw.SetDrawColor = POBAI_RAW and POBAI_RAW.SetDrawColor or SetDrawColor
	raw.DrawImage = POBAI_RAW and POBAI_RAW.DrawImage or DrawImage
	raw.DrawString = POBAI_RAW and POBAI_RAW.DrawString or DrawString
	raw.DrawStringWidth = POBAI_RAW and POBAI_RAW.DrawStringWidth or DrawStringWidth
	S.img = {
		mark = loadImage('pobai-mark-36.png'), minus = loadImage('tb-minus-32.png'), square = loadImage('tb-square-26.png'),
		restore = loadImage('tb-restore-26.png'), close = loadImage('tb-close-32.png'), sparkles = loadImage('tb-sparkles-32.png'),
	}

	local win = glfw.glfwGetCurrentContext()
	assert(win ~= nil, 'no GLFW window')
	local h = glfw.glfwGetWin32Window(win)
	assert(h ~= nil, 'no window handle')
	S.hwnd = h
	S.title = cleanTitle(windowText(h))
	local aiW = aiWidth()
	S.layout.aiFrom, S.layout.aiTo = S.btn * 3 + 8, S.btn * 3 + 8 + aiW

	-- Where the client area is now: the window shrinks onto it, so the saved window size stays
	-- the same from one start to the next.
	local client = ffi.new('POBAI_RECT')
	user32.GetClientRect(h, client)
	local origin = ffi.new('POBAI_POINT')
	user32.ClientToScreen(h, origin)
	local zoomed = user32.IsZoomed(h) ~= 0

	S.callback = ffi.cast('POBAI_SUBCLASSPROC', safeProc)
	assert(comctl.SetWindowSubclass(h, S.callback, SUBCLASS_ID, 0) ~= 0, 'SetWindowSubclass failed')
	S.subclassed = true
	wrapGlobals()
	window.active = true
	if zoomed then
		setPos(h, 0, 0, 0, 0, SWP.NOMOVE + SWP.NOSIZE + SWP.NOZORDER + SWP.NOACTIVATE + SWP.FRAMECHANGED)
	else
		setPos(h, origin.x, origin.y, client.right, client.bottom, SWP.NOZORDER + SWP.NOACTIVATE + SWP.FRAMECHANGED)
	end
end
jit.off(install)

--- Removes the subclass and the wrappers. restoreFrame puts the Windows caption back around the
--- current area (used when the bar fails while PoB keeps running; at exit the window is left as
--- it is so PoB saves the size the user saw).
local function remove(restoreFrame)
	window.active = false
	unwrapGlobals()
	local h = S.hwnd
	if S.subclassed then
		comctl.RemoveWindowSubclass(h, S.callback, SUBCLASS_ID)
		S.subclassed = false
		if restoreFrame then
			if user32.IsZoomed(h) ~= 0 then
				setPos(h, 0, 0, 0, 0, SWP.NOMOVE + SWP.NOSIZE + SWP.NOZORDER + SWP.NOACTIVATE + SWP.FRAMECHANGED)
			else
				-- Grow the window by the frame so the area PoB draws in stays where it is.
				local r = ffi.new('POBAI_RECT')
				user32.GetWindowRect(h, r)
				adjustForFrame(h, r)
				setPos(h, r.left, r.top, r.right - r.left, r.bottom - r.top, SWP.NOZORDER + SWP.NOACTIVATE + SWP.FRAMECHANGED)
			end
		end
	end
	if S.callback then
		S.callback:free()
		S.callback = nil
	end
end
jit.off(remove)

function window.install()
	if window.active then return end
	local ok, err = pcall(install)
	if ok then
		log('installed')
		return
	end
	log('install failed, keeping the Windows caption: ' .. tostring(err))
	local okRemove, errRemove = pcall(remove, true)
	if not okRemove then log('cleanup failed: ' .. tostring(errRemove)) end
end

function window.uninstall()
	local ok, err = pcall(remove, false)
	if not ok then log('uninstall failed: ' .. tostring(err)) end
end

--- Gives the window its Windows caption back while PoB keeps running.
function window.fail(reason)
	log('turned off, keeping the Windows caption: ' .. tostring(reason))
	local ok, err = pcall(remove, true)
	if not ok then log('cleanup failed: ' .. tostring(err)) end
end

return window
