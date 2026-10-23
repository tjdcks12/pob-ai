-- Exercise PoB's actual floating-sheet and calculation-breakdown painters, including nesting.
local classes = {}
newClass = function(name) classes[name] = {} return classes[name] end
dofile(POB .. '/Classes/CalcSectionControl.lua')
dofile(POB .. '/Classes/CalcBreakdownControl.lua')
-- Floating sheets exist in updated beta builds, but not in the stable portable ZIP.
local overlaySupported = type(classes.CalcSectionControl.DrawOverlay) == 'function'
common = { classes = classes }
local calls, colour = {}, { 1, 1, 1, 1 }
local function setColour(r, g, b, a)
	if type(r) == 'string' then
		local rh, gh, bh = r:match('^%^x(%x%x)(%x%x)(%x%x)')
		if rh then r, g, b = tonumber(rh, 16) / 255, tonumber(gh, 16) / 255, tonumber(bh, 16) / 255
		else r = tonumber(r:sub(2)) / 9 g, b = r, r end
	end
	colour = { r, g, b, a or 1 }
end
local function rect(_, x, y, w, h) calls[#calls + 1] = { kind = 'rect', x = x, y = y, w = w, h = h, colour = colour } end
local function quad() calls[#calls + 1] = { kind = 'quad', colour = colour } end
POBAI_RAW = { SetDrawColor = setColour, DrawImage = rect, DrawImageQuad = quad }
DrawImage, DrawImageQuad, SetDrawColor = rect, quad, setColour
GetDrawColor = function() return unpack(colour) end
DrawString = function(x, y, align, size, font, text) calls[#calls + 1] = { kind = 'text', text = text } end
DrawStringWidth = function(size, font, text) return #text * size / 2 end
SetDrawLayer, SetViewport = function() end, function() end
local mx, my = -1, -1
GetCursorPos = function() return mx, my end
formatCalcStr, formatNumSep = function(value) return value end, tostring
colorCodes = { HIGHLIGHT = '^xFFFF00', MAINHANDBG = '^x003300' }
NewImageHandle = function() return { Load = function() end } end
POBAI_ADAPTER = ADAPTER
pobai_read_file = function(path)
	local file = assert(io.open(path, 'rb'))
	local content = file:read('*a') file:close() return content
end
local tokens = dofile(ADAPTER .. '/live/tokens.lua').load()
local activeTokens = tokens.dark
POBAI_THEME = { tokens = function() return activeTokens end, lastColour = function() return unpack(colour) end,
	textColour = function() return unpack(activeTokens.fg) end }
local skin = dofile(ADAPTER .. '/live/skin.lua')
local breakdown = setmetatable({
	sourceData = { x = 310, y = 100, width = 90 }, contentWidth = 180, contentHeight = 52,
	borderThickness = 2, borderColour = { .33, .66, .33 }, pinnedColour = { .25, 1, .25 },
	controls = { scrollBar = { width = 18, offset = 0, SetContentDimension = function() end } },
	sectionList = { { type = 'TEXT', offset = 2, textSize = 14, lines = { 'Maximum of:', '20% (Ancestral Call Uptime)', '= 20%' } } },
	DrawControls = function() end,
}, { __index = classes.CalcBreakdownControl })
local tab = { input = {}, calcsEnv = { player = {} }, build = { outputRevision = 1, overlayPanes = {} },
	controls = { breakdown = breakdown }, CheckFlag = function() return true end, SearchMatch = function() return false end,
	SetDisplayStat = function(self, cell) self.displayData = cell breakdown.sourceData = cell end,
}
local cell = { format = '20%' }
local sheet = setmetatable({
	x = 20, y = 40, width = 300, isOverlay = true, overlayX = 50, overlayY = 80,
	controls = { toggle1 = {}, popOut = {} }, calcsTab = tab, colour = '^xFF8000',
	subSection = { { label = 'Empowered Stats', data = { { label = 'Boosted attacks', bgCol = '^x003300', cell } } } },
	GetPos = function(self) return self.x, self.y end, GetSize = function(self) return self.width, self.height end,
	DrawControls = function() end,
}, { __index = classes.CalcSectionControl })
cell.calcSection = sheet
local viewport = { x = 0, y = 0, width = 1000, height = 1000 }
local initialSource = breakdown.sourceData
local function capture(fn)
	calls = {} setColour(1, 1, 1, 1) fn() return calls
end
local function snapshot()
	breakdown.sourceData, tab.displayData = initialSource, nil
	sheet:UpdateSize() sheet:UpdatePos()
	mx, my = -1, -1
	local overlay = overlaySupported and capture(function() sheet:DrawOverlay(viewport, {}) end) or false
	breakdown.pinned = false
	local hover = capture(function() breakdown:Draw(viewport) end)
	breakdown.pinned = true
	local pinned = capture(function() breakdown:Draw(viewport) end)
	return { overlay = overlay, hover = hover, pinned = pinned }
end
local native = snapshot()
local result = { native = native, overlaySupported = overlaySupported }
for _, mode in ipairs({ 'dark', 'light', 'ocean', 'forest', 'sand' }) do
	activeTokens = tokens[mode] skin.set(activeTokens)
	result[mode] = snapshot()
	result[mode].surface, result[mode].line, result[mode].primary = activeTokens['surface-inner'], activeTokens.line, activeTokens.primary
end
if overlaySupported then
	mx, my = sheet.overlayX + cell.xOffset + 5, sheet.overlayY + 26 + cell.yOffset + 5
	capture(function() sheet:DrawOverlay(viewport, {}) end)
else
	capture(function() breakdown:Draw(viewport) end)
end
result.overlaySupportedAfter = type(classes.CalcSectionControl.DrawOverlay) == 'function'
result.drawFunctionsRestored = DrawImage == rect and DrawImageQuad == quad
tab.displayData = nil
skin.set(nil)
result.restored = snapshot()
return result
