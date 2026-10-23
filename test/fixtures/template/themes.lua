POBAI_ADAPTER = ADAPTER
pobai_read_file = function(path)
	local f = assert(io.open(path, 'rb')) local text = f:read('*a') f:close() return text
end
pobai_log = function() end
local clear, skinTokens, caption
local noop = function() end
POBAI_RAW = { SetDrawColor = noop }
POBAI_TEXT_DRAW = noop
SetDrawColor, DrawString = noop, noop
SetClearColor = function(r, g, b) clear = { r, g, b } end
POBAI_MAIN = { DrawBackground = noop }
POBAI_SKIN = { set = function(t) skinTokens = t end }
POBAI_WINDOW = { setTheme = function(id) caption = id end }
local theme = dofile(ADAPTER .. '/live/theme.lua')
local out = { names = theme.names, aliases = { theme.resolve('midnight'), theme.resolve('parchment'), theme.resolve('unknown') } }
for _, id in ipairs(theme.names) do
	theme.apply(id)
	local suspended = theme.suspend()
	if suspended then theme.resume() end
	out[id] = { current = theme.current, bg = clear, skin = skinTokens and skinTokens.bg, caption = caption, lightTree = suspended }
end
return out
