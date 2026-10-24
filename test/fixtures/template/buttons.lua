-- Exercise PoB's actual button drawing and click handling with every custom palette.
local classes = {}
newClass = function(name) classes[name] = {} return classes[name] end
dofile(POB .. '/Classes/ButtonControl.lua')
common = { classes = classes }
local calls, colour = {}, { 1, 1, 1, 1 }
local function setColour(r, g, b, a) colour = { r, g, b, a or 1 } end
local function rect(handle, x, y, w, h)
	calls[#calls + 1] = { kind = 'rect', corner = handle ~= nil, x = x, y = y, w = w, h = h, colour = colour }
end
local function quad() calls[#calls + 1] = { kind = 'quad', colour = colour } end
local function text(x, y, align, size, font, value)
	calls[#calls + 1] = { kind = 'text', x = x, y = y, size = size, text = value, colour = colour }
end
POBAI_RAW = { SetDrawColor = setColour, DrawImage = rect, DrawImageQuad = quad }
POBAI_TEXT_DRAW = text
DrawImage, DrawImageQuad, SetDrawColor, DrawString = rect, quad, setColour, text
GetDrawColor = function() return unpack(colour) end
SetDrawLayer = function() end
NewImageHandle = function() return { Load = function() end } end
POBAI_ADAPTER = ADAPTER
pobai_read_file = function(path)
	local f = assert(io.open(path, 'rb')) local content = f:read('*a') f:close() return content
end
pobai_log = function() end
POBAI_THEME = dofile(ADAPTER .. '/live/theme.lua')
POBAI_SKIN = dofile(ADAPTER .. '/live/skin.lua')
local tokens = dofile(ADAPTER .. '/live/tokens.lua').load()
local clicks = 0
local button = setmetatable({
	label = 'Passive Tree and Jewels', enabled = true, over = false,
	GetPos = function() return 10, 20 end, GetSize = function() return 170, 20 end,
	GetProperty = function(self, key) return self[key] end,
	IsShown = function() return true end, IsEnabled = function(self) return self.enabled end,
	IsMouseOver = function(self) return self.over end, DrawTooltip = function() end,
	onClick = function() clicks = clicks + 1 end,
}, { __index = classes.ButtonControl })
local function capture(state)
	button.enabled = state ~= 'disabled'
	button.over = state == 'hover' or state == 'pressed'
	button.clicked = state == 'pressed'
	button.hasFocus = state == 'focused'
	button.locked = state == 'locked'
	calls = {} button:Draw({}) return calls
end
local out = { original = capture('normal') }
for _, mode in ipairs({ 'dark', 'light', 'ocean', 'forest', 'sand' }) do
	POBAI_THEME.apply(mode)
	local states = { surface = tokens[mode].surface, primary = tokens[mode].primary }
	for _, state in ipairs({ 'normal', 'hover', 'pressed', 'disabled', 'focused', 'locked' }) do
		states[state] = capture(state)
	end
	out[mode] = states
end
button.enabled, button.over = true, true
button:OnKeyDown('LEFTBUTTON') button:OnKeyUp('LEFTBUTTON')
button:OnKeyDown('LEFTBUTTON') button.over = false button:OnKeyUp('LEFTBUTTON')
button.enabled, button.over = false, true
button:OnKeyDown('LEFTBUTTON') button:OnKeyUp('LEFTBUTTON')
out.clicks = clicks
POBAI_THEME.apply('pob')
out.restored = capture('normal')
out.drawFunctionsRestored = DrawImage == rect and DrawImageQuad == quad
return out
