-- Run the actual PoB class with a drawing host, then install the runtime template on it.
local class
newClass = function() class = {} return class end
dofile(POB .. '/Classes/CalcSectionControl.lua')
local calls, colour = {}, {}
local function record(kind, ...) calls[#calls + 1] = { kind, ... } end
POBAI_RAW = {
	SetDrawColor = function(...) colour = { ... } end,
	DrawImage = function(_, x, y, w, h) record('rect', x, y, w, h, colour) end,
}
DrawImage, SetDrawColor = POBAI_RAW.DrawImage, POBAI_RAW.SetDrawColor
DrawString = function(x, y, align, size, font, text) record('text', text, size) end
DrawStringWidth = function(size, font, text) return #text * size / 2 end
SetDrawLayer, SetViewport = function() end, function() end
local mx, my = -1, -1
GetCursorPos = function() return mx, my end
formatCalcStr = function(value) return value end
colorCodes = { HIGHLIGHT = '^xFFFF00', MAINHANDBG = '^x003300' }
POBAI_ADAPTER = ADAPTER
pobai_read_file = function(path)
	local file = assert(io.open(path, 'rb'))
	local content = file:read('*a')
	file:close()
	return content
end
local tokens = dofile(ADAPTER .. '/live/tokens.lua').load()
local activeTokens = tokens.dark
POBAI_THEME = { tokens = function() return activeTokens end }
local skin = { on = false, paint = function(x, y, w, h, radius, fill, border) record('panel', w, h, fill, border) end }
dofile(ADAPTER .. '/live/calcs-skin.lua').install(class, skin)
local control = { height = 16, IsMouseOver = function() return false end }
local sub = { label = 'Damage', data = {
	{ label = 'Average hit', { format = '1,234' } },
	{ label = 'Attack rate', { format = '0.98' } },
	{ label = 'Select skill', { control = control } },
	{ label = 'Hidden', hidden = true, { format = 'wrong' } },
} }
local secondary = { label = 'Other', data = { { label = 'More', { format = '20%' } } } }
local tab = { input = {}, calcsEnv = { player = {} },
	CheckFlag = function(_, row) return not row.hidden end,
	SearchMatch = function() return false end,
	SetDisplayStat = function(self, cell) self.displayData = cell end,
}
local sheet = setmetatable({
	x = 20, y = 40, width = 230, subSection = { sub, secondary }, calcsTab = tab,
	controls = { toggle1 = {}, toggle2 = {}, popOut = {} }, colour = '^xFF8000',
	GetPos = function(self) return self.x, self.y end,
	GetSize = function(self) return self.width, self.height end,
	GetMouseOverControl = function() end, IsShown = function() return true end,
	IsMouseInBounds = function(self) return mx >= self.x and mx < self.x + self.width and my >= self.y and my < self.y + self.height end,
	DrawControls = function() record('controls') end,
}, { __index = class })
local viewport = { x = 0, y = 0, width = 1000, height = 1000 }
local function layout()
	sheet:UpdateSize()
	sheet:UpdatePos()
end
local function snapshot()
	return { height = sheet.height, toggle = sheet.controls.toggle2.y, popOut = sheet.controls.popOut.y,
		firstY = sub.data[1][1].y, secondY = sub.data[2][1].y, rowHeight = sub.data[1][1].height,
		controlY = control.y, controlCellY = sub.data[3][1].y, hidden = sub.data[4].enabled }
end
layout()
local original = snapshot()
sheet:Draw(viewport)
local originalDraw = calls
calls = {}
skin.on = true
layout()
local modern = snapshot()
mx, my = sub.data[2][1].x + 2, sub.data[2][1].y + 2
local over, cell = sheet:IsMouseOver()
modern.hitSecond = over and cell == sub.data[2][1]
sheet:Draw(viewport)
modern.hoverSecond = tab.displayData == sub.data[2][1]
local darkDraw = calls
calls = {}
activeTokens = tokens.light
sheet:Draw(viewport)
local lightDraw = calls
local themeDraws = { dark = darkDraw, light = lightDraw }
for _, id in ipairs({ 'ocean', 'forest', 'sand' }) do
	calls = {} activeTokens = tokens[id]
	sheet:Draw(viewport)
	themeDraws[id] = calls
end
secondary.collapsed = true
layout()
local collapsed = snapshot()
secondary.collapsed = false
sheet.isOverlay = true
layout()
local overlay = snapshot()
sheet.isOverlay = false
skin.on = false
mx, my = -1, -1
tab.displayData = nil
layout()
local restored = snapshot()
calls = {}
sheet:Draw(viewport)
return {
	original = original, modern = modern, restored = restored, overlay = overlay, collapsed = collapsed,
	originalDraw = originalDraw, restoredDraw = calls, darkDraw = darkDraw, lightDraw = lightDraw, themeDraws = themeDraws,
}
