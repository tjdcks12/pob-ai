-- Draws Path of Building's own controls in the poe2way look (flat, rounded corners, token
-- colours) for the "dark" and "light" window themes, without touching PoB's files and without
-- moving anything: control rectangles are hard-coded all over PoB, so only what is painted inside
-- them changes.
--
-- How: each skinned control class gets its Draw method wrapped. While PoB's own Draw runs, the
-- global DrawImage is swapped for a filter. PoB paints every box of a control as a border
-- rectangle followed later by a fill rectangle inset by 1 or 2 px; the filter drops the border
-- rectangle and, when the fill rectangle arrives, paints one rounded box in token colours in its
-- place. The control's state (hover, pressed, disabled, focus) is read from the colours PoB chose
-- for those two rectangles (theme.lua remembers the raw colour), so the filter needs no extra
-- layout work. Every other draw call (text, icons, selection, caret, arrows) passes through, so
-- PoB keeps its own input, hover, drag and scroll logic. With the skin off (theme "pob") each
-- wrapper calls PoB's Draw straight away.
--
-- assets/circle64.png is a 64x64 white anti-aliased disc whose quarters draw the rounded corners.
-- It was made once with System.Drawing (Windows PowerShell):
--   $b = New-Object System.Drawing.Bitmap 64, 64, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
--   $g = [System.Drawing.Graphics]::FromImage($b); $g.SmoothingMode = 'AntiAlias'
--   $g.FillEllipse([System.Drawing.Brushes]::White, 0, 0, 64, 64)
--   then every pixel rewritten as Color.FromArgb(<its alpha>, 255, 255, 255) so transparent
--   texels are white too (no dark fringe when the texture is filtered), and saved as PNG.
local skin = { on = false }

local RAW = POBAI_RAW
local rawDrawImage, rawDrawImageQuad, rawSetDrawColor = RAW.DrawImage, RAW.DrawImageQuad, RAW.SetDrawColor
local m_floor, m_min, m_max = math.floor, math.min, math.max

local T          -- token set of the current theme ({ bg = {r, g, b}, ... })
local hoverFill  -- button hover colour: surface-hover a step towards the text colour
local circle     -- image handle for the rounded corners

-- Painting --------------------------------------------------------------------------------

local function round(v) return m_floor(v + 0.5) end

--- Fills a rounded rectangle: four corner quarters of the disc and three plain rectangles.
local function fillRound(x, y, w, h, r, c)
	local x1, y1, x2, y2 = round(x), round(y), round(x + w), round(y + h)
	w, h = x2 - x1, y2 - y1
	if w <= 0 or h <= 0 then return end
	rawSetDrawColor(c[1], c[2], c[3], 1)
	r = m_min(r, m_floor(w / 2), m_floor(h / 2))
	if r < 1 or not circle then return rawDrawImage(nil, x1, y1, w, h) end
	rawDrawImage(circle, x1, y1, r, r, 0, 0, 0.5, 0.5)
	rawDrawImage(circle, x2 - r, y1, r, r, 0.5, 0, 1, 0.5)
	rawDrawImage(circle, x1, y2 - r, r, r, 0, 0.5, 0.5, 1)
	rawDrawImage(circle, x2 - r, y2 - r, r, r, 0.5, 0.5, 1, 1)
	rawDrawImage(nil, x1 + r, y1, w - 2 * r, h)
	rawDrawImage(nil, x1, y1 + r, r, h - 2 * r)
	rawDrawImage(nil, x2 - r, y1 + r, r, h - 2 * r)
end

--- Paints a rounded box (with a 1 px border when given), then puts back the colour PoB had set
--- so its next draw is unaffected.
local function paint(x, y, w, h, radius, fill, border)
	local r, g, b, a = GetDrawColor()
	if border then
		fillRound(x, y, w, h, radius, border)
		fillRound(x + 1, y + 1, w - 2, h - 2, m_max(radius - 1, 0), fill)
	else
		fillRound(x, y, w, h, radius, fill)
	end
	rawSetDrawColor(r, g, b, a)
end

-- Colours PoB asked for -------------------------------------------------------------------

local function near(a, b) return a - b < 0.01 and b - a < 0.01 end
local function isGrey(r, g, b) return m_max(r, g, b) - m_min(r, g, b) < 0.06 end

--- The colour of PoB's last SetDrawColor call before the theme recoloured it.
local function rawColour()
	local r, g, b = POBAI_THEME.lastColour()
	if not r then return 0.5, 0.5, 0.5 end
	return r, g, b
end

-- PoB's grey levels: 0.33 disabled, 0.5 normal, 1 hovered (or a locked tab button).
local function level(b) return isGrey(b.r, b.g, b.b) and b.r or nil end

--- Field border (edit, drop-down, check box): focus first, then hover, then a colour PoB set
--- on purpose (changed config values), else the plain line.
local function fieldBorder(b, focus)
	local l = level(b)
	if focus then return T.primary end
	if l and near(l, 1) then return T['fg-4'] end
	if not l then return { b.r, b.g, b.b } end
	return T.line
end

local function disabled(b) local l = level(b) return l and near(l, 0.33) end

-- Draw-call filter -------------------------------------------------------------------------

-- One state per skinned Draw that is running (controls draw children and tooltips inside their
-- own Draw, so states nest). States and boxes are reused so frames make no garbage.
local pool, depth, active = {}, 0, nil

local function box(s, i)
	local b = s.boxes[i]
	if not b then
		b = {}
		s.boxes[i] = b
	end
	return b
end

--- A border rectangle is remembered (and not drawn) until its fill rectangle arrives; then the
--- control's colour function picks the tokens and the rounded box is painted.
local function matchBoxes(s, x, y, w, h)
	for i = 1, s.outers do
		local b = s.boxes[i]
		if b.open then
			local k = x - b.x
			if (near(k, 1) or near(k, 2)) and near(y - b.y, k) and near(b.w - w, 2 * k) and near(b.h - h, 2 * k) then
				b.open = false
				s.pending = s.pending - 1
				local fr, fg, fb = rawColour()
				s.paint(s, i, b, fr, fg, fb)
				return true
			end
		end
	end
	if s.outers < s.expect then
		s.outers = s.outers + 1
		s.pending = s.pending + 1
		local b = box(s, s.outers)
		b.x, b.y, b.w, b.h, b.open = x, y, w, h, true
		b.r, b.g, b.b = rawColour()
		return true
	end
	return false
end

local function filteredDrawImage(handle, x, y, w, h, ...)
	local s = active
	if handle == nil and s and s.match(s, x, y, w, h) then return end
	return rawDrawImage(handle, x, y, w, h, ...)
end

local function mutedDrawImageQuad() end

--- Glyphs drawn inside a control (arrows, "+", "-", "x", check marks) take the text colour of
--- the colour PoB chose, so they stay visible on the light theme's pale buttons.
local function glyph(draw, s, ...)
	local r, g, b, a = GetDrawColor()
	local c = s.check
	if c then rawSetDrawColor(c[1], c[2], c[3], a)
	else
		local tr, tg, tb = POBAI_THEME.textColour(rawColour())
		rawSetDrawColor(tr, tg, tb, a)
	end
	draw(...)
	rawSetDrawColor(r, g, b, a)
end

local function filteredDrawImageQuad(...)
	return glyph(rawDrawImageQuad, active, ...)
end

local function pop(s, ...)
	active = s.prev
	depth = depth - 1
	if active then
		DrawImageQuad = active.mute and mutedDrawImageQuad or filteredDrawImageQuad
	else
		DrawImage, DrawImageQuad = rawDrawImage, rawDrawImageQuad
	end
	return ...
end

local function wrap(original, setup)
	return function(self, ...)
		if not skin.on then return original(self, ...) end
		depth = depth + 1
		local s = pool[depth]
		if not s then
			s = { boxes = {} }
			pool[depth] = s
		end
		s.self, s.prev, s.outers, s.pending, s.expect, s.mute, s.check, s.n = self, active, 0, 0, 1, false, nil, 0
		s.match = matchBoxes
		if not setup(s, self) then
			depth = depth - 1
			return original(self, ...)
		end
		active = s
		DrawImage = filteredDrawImage
		DrawImageQuad = s.mute and mutedDrawImageQuad or filteredDrawImageQuad
		return pop(s, original(self, ...))
	end
end

-- Per-control painting (PoB 0.23.1 line numbers; 0.22 draws the same boxes) ---------------

local SMALL, PANEL = 3, 4
local SETUP = {}

-- ButtonControl:Draw :41-105. No border; the fill says the state.
local function paintButton(s, _, b, fr)
	local fill
	local l = level(b) or 0.5
	if near(l, 0.33) or near(fr, 0.5) then fill = T['surface-inner']                -- disabled, pressed
	elseif near(l, 1) then fill = s.self:GetProperty('locked') and T['primary-soft'] or hoverFill
	else fill = T['surface-hover'] end
	paint(b.x, b.y, b.w, b.h, SMALL, fill)
end
-- After the box, plain rectangles are the "+" and "-" glyphs (or the pressed tint on an image).
local function matchButton(s, x, y, w, h)
	if matchBoxes(s, x, y, w, h) then return true end
	glyph(rawDrawImage, s, nil, x, y, w, h)
	return true
end
SETUP.ButtonControl = function(s)
	s.paint = paintButton
	s.match = matchButton
	return true
end

-- EditControl:Draw :245-272.
local function paintEdit(s, _, b)
	if disabled(b) then return paint(b.x, b.y, b.w, b.h, SMALL, T.bg, T.line) end
	paint(b.x, b.y, b.w, b.h, SMALL, T['surface-inner'], fieldBorder(b, s.self.hasFocus))
end
SETUP.EditControl = function(s)
	s.paint = paintEdit
	return true
end

-- DropDownControl:Draw :258-295: the body, and the list (sub-layer 5) while it is open.
local function paintDropDown(s, i, b)
	if i == 2 then return paint(b.x, b.y, b.w, b.h, SMALL, T['surface-inner'], T['primary-line']) end
	if disabled(b) then return paint(b.x, b.y, b.w, b.h, SMALL, T.bg, T.line) end
	paint(b.x, b.y, b.w, b.h, SMALL, T['surface-inner'], fieldBorder(b, s.self.dropped))
end
SETUP.DropDownControl = function(s, self)
	s.paint = paintDropDown
	s.expect = self.dropped and 2 or 1
	return true
end

-- CheckBoxControl:Draw :40-111. A plain check box that is ticked is filled with the accent and
-- its mark drawn in the accent's text colour.
local function paintCheckBox(s, _, b)
	if disabled(b) then return paint(b.x, b.y, b.w, b.h, SMALL, T.bg, T.line) end
	local self = s.self
	if self.state and not self.checkImage then
		s.check = T['on-primary']
		local l = level(b)
		return paint(b.x, b.y, b.w, b.h, SMALL, (l and near(l, 1)) and T['primary-strong'] or T.primary)
	end
	paint(b.x, b.y, b.w, b.h, SMALL, T['surface-inner'], fieldBorder(b, false))
end
SETUP.CheckBoxControl = function(s)
	s.paint = paintCheckBox
	return true
end

-- SliderControl:Draw :78-133: a 6 px pill track and a round knob in the accent colour.
local function paintSliderTrack(_, _, b)
	paint(b.x, b.y + round((b.h - 6) / 2), b.w, 6, 3, T['surface-hover'])
end
local function matchSlider(s, x, y, w, h)
	if matchBoxes(s, x, y, w, h) then return true end
	if s.pending == 0 and not s.self.divCount and near(w, h) then
		paint(x, y, w, h, 64, T.primary)
		return true
	end
	return false
end
SETUP.SliderControl = function(s)
	s.paint = paintSliderTrack
	s.match = matchSlider
	return true
end

-- ScrollBarControl:Draw :113-257. PoB's Draw still runs (it drives dragging and the repeat on
-- held arrows) but paints nothing. Its 7th rectangle is the knob (after the two arrow buttons
-- and the track, each a border and a fill); a 6 px rounded knob is centred on it.
local function matchScrollBar(s, x, y, w, h)
	s.n = s.n + 1
	if s.n == 7 then
		local r = rawColour()
		local fill = near(r, 1) and T['fg-4'] or T['surface-hover']
		if s.self.dir == 'HORIZONTAL' then
			paint(x, y + round((h - 6) / 2), w, 6, 3, fill)
		else
			paint(x + round((w - 6) / 2), y, 6, h, 3, fill)
		end
	end
	return true
end
SETUP.ScrollBarControl = function(s)
	s.mute = true
	s.match = matchScrollBar
	return true
end

-- SectionControl:Draw :16-33: a panel, and its label as a tag.
local function paintSection(_, i, b)
	if i == 1 then return paint(b.x, b.y, b.w, b.h, PANEL, T.surface) end
	paint(b.x, b.y, b.w, b.h, SMALL, T['surface-hover'])
end
SETUP.SectionControl = function(s)
	s.paint = paintSection
	s.expect = 2
	return true
end

-- PopupDialog:Draw :43-69: a panel with a border, and its title as a tag.
local function paintPopup(_, i, b)
	if i == 1 then return paint(b.x, b.y, b.w, b.h, PANEL, T.surface, T.line) end
	paint(b.x, b.y, b.w, b.h, SMALL, T['surface-hover'])
end
SETUP.PopupDialog = function(s)
	s.paint = paintPopup
	s.expect = 2
	return true
end

-- ListControl:Draw :194-207 (and every list that reuses it): green border while a drag can drop
-- here, accent while focused.
local function paintList(_, _, b)
	local l = level(b)
	local border = T.line
	if not l then border = T.ok elseif near(l, 1) then border = T['primary-line'] end
	paint(b.x, b.y, b.w, b.h, SMALL, T['surface-inner'], border)
end
SETUP.ListControl = function(s)
	s.paint = paintList
	return true
end

-- TextListControl:Draw :39-42.
local function paintTextList(_, _, b)
	paint(b.x, b.y, b.w, b.h, SMALL, T['surface-inner'], T.line)
end
SETUP.TextListControl = function(s)
	s.paint = paintTextList
	return true
end

-- Tooltip:Draw :543-797. Its first plain rectangle is the background (inside a 1 px frame drawn
-- at the end); it becomes one rounded panel with the frame in the tooltip's colour, and the four
-- outer frame lines are dropped. Lines between columns stay.
local function tooltipFrame(c, t)
	if type(c) == 'string' then
		local rh, gh, bh = c:match('^%^x(%x%x)(%x%x)(%x%x)')
		if rh then return { tonumber(rh, 16) / 255, tonumber(gh, 16) / 255, tonumber(bh, 16) / 255 } end
		return t.line
	end
	-- PoB's default frame colour { 0.5, 0.3, 0 } (Tooltip:Clear) and greys become the line token.
	if type(c) ~= 'table' or isGrey(c[1], c[2], c[3]) or (c[1] == 0.5 and c[2] == 0.3 and c[3] == 0) then return t.line end
	return c
end
local function matchTooltip(s, x, y, w, h)
	if s.n == 0 then
		-- Background: (ttX, ttY + 1, width - 1, height - 2). Over the passive tree on the light
		-- theme (drawn in PoB's colours) the tooltip keeps the dark surface its text was made for.
		s.n = 1
		s.px, s.py, s.pw, s.ph = x, y - 1, w + 1, h + 2
		local t = POBAI_THEME.suspended and POBAI_THEME.tokens() or T
		paint(s.px, s.py, s.pw, s.ph, SMALL, t['surface-inner'], tooltipFrame(s.self.color, t))
		return true
	end
	if w == 1 and near(h, s.ph) and near(y, s.py) and (near(x, s.px) or near(x, s.px + s.pw - 1)) then return true end
	if h == 1 and near(w, s.pw) and near(x, s.px) and (near(y, s.py) or near(y, s.py + s.ph - 1)) then return true end
	return false
end
SETUP.Tooltip = function(s, self)
	if #self.lines == 0 then return false end
	s.match = matchTooltip
	return true
end

-- Arrows inside skinned controls are drawn smaller (PoB's fill most of the box).
local function wrapMain(main)
	local drawArrow = main.DrawArrow
	main.DrawArrow = function(self, x, y, w, h, dir)
		if skin.on and active then w, h = w * 0.55, h * 0.55 end
		return drawArrow(self, x, y, w, h, dir)
	end
end

-- PassiveTreeView:Draw: the tree is drawn in PoB's colours on the light theme (theme.suspend).
local function wrapTreeView(draw)
	return function(self, ...)
		if not (skin.on and POBAI_THEME.suspend()) then return draw(self, ...) end
		local ok, err = pcall(draw, self, ...)
		POBAI_THEME.resume()
		if not ok then error(err, 0) end
	end
end

-- Installation ---------------------------------------------------------------------------

local wrappers, isWrapper = {}, {}   -- PoB's Draw -> its wrapper; wrapper -> true
local mainWrapped = false

--- Wraps the skinned classes, and every class that copied one of their Draw functions (PoB
--- copies parent methods into subclasses). Classes are never reloaded: newClass would make new
--- tables that the existing controls do not use.
local function install()
	local classes = common and common.classes
	if not classes then return end
	for name, setup in pairs(SETUP) do
		local class = classes[name]
		local draw = class and rawget(class, 'Draw')
		if draw and not wrappers[draw] and not isWrapper[draw] then
			local w = wrap(draw, setup)
			wrappers[draw], isWrapper[w] = w, true
		end
	end
	local tree = classes.PassiveTreeView
	local treeDraw = tree and rawget(tree, 'Draw')
	if treeDraw and not wrappers[treeDraw] and not isWrapper[treeDraw] then
		local w = wrapTreeView(treeDraw)
		wrappers[treeDraw], isWrapper[w] = w, true
	end
	for _, class in pairs(classes) do
		local draw = rawget(class, 'Draw')
		if draw and wrappers[draw] then rawset(class, 'Draw', wrappers[draw]) end
	end
	if not mainWrapped and POBAI_MAIN then
		wrapMain(POBAI_MAIN)
		mainWrapped = true
	end
end

local function mix(a, b, t)
	return { a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t }
end

--- Turns the skin on with a token set (tokens.lua's dark or light block), or off with nil.
function skin.set(tokenSet)
	if not tokenSet then
		skin.on = false
		return
	end
	T = tokenSet
	hoverFill = mix(T['surface-hover'], T.fg, 0.06)
	if not circle then
		circle = NewImageHandle()
		circle:Load(POBAI_ADAPTER .. '/live/assets/circle64.png', 'CLAMP', 'MIPMAP')
	end
	install()
	skin.on = true
end

local frames = 0
--- Called at the start of every frame: drops a filter left behind by a Draw that failed, and
--- picks up control classes PoB loaded since (e.g. the first time a popup opens).
function skin.reset()
	if not skin.on then return end
	if active or depth ~= 0 then
		active, depth = nil, 0
		DrawImage, DrawImageQuad = rawDrawImage, rawDrawImageQuad
	end
	frames = frames + 1
	if frames % 60 == 0 then install() end
end

return skin
