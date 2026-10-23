-- Reads ui/tokens.css, the design tokens the agent panel uses, so the PoB window draws with the
-- same colours and sizes. Returns a map by theme id: colours as { r, g, b } (0-1),
-- px sizes as numbers, anything else as the raw string. Errors when the file cannot be read; the
-- callers (skin, title bar) fall back to PoB's own look.
local tokens = {}

local function parseValue(value)
	value = value:gsub('^%s+', ''):gsub('%s+$', '')
	local hex = value:match('^#(%x%x%x%x%x%x)$')
	if hex then
		return { tonumber(hex:sub(1, 2), 16) / 255, tonumber(hex:sub(3, 4), 16) / 255, tonumber(hex:sub(5, 6), 16) / 255 }
	end
	local px = value:match('^(%-?[%d%.]+)px$')
	if px then return tonumber(px) end
	return value
end

local function parseBlock(body)
	local out = {}
	for name, value in body:gmatch('%-%-([%w%-]+)%s*:%s*([^;]+);') do out[name] = parseValue(value) end
	return out
end

function tokens.load()
	local text = assert(pobai_read_file(POBAI_ADAPTER .. '/../ui/tokens.css'), 'ui/tokens.css not found')
	text = text:gsub('/%*.-%*/', '')
	local out = {}
	for id, body in text:gmatch('%[data%-theme="([%w%-]+)"%]%s*(%b{})') do out[id] = parseBlock(body) end
	assert(out.dark and out.light, 'ui/tokens.css has no dark or light block')
	return out
end

return tokens
