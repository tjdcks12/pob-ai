-- Shows PoB's own screens in another language. Each string PoB draws is looked up in a phrase
-- dictionary and the translation is drawn instead, through the same glyph atlas as the window
-- font (adapter/live/atlas.lua): PoB's bitmap fonts only contain ASCII glyphs, so the service
-- renders the other glyphs. Until a translation's glyphs are ready the English text is drawn.
local json = require('dkjson')
local translate = { locale = nil, dict = nil }

POBAI_FONT = POBAI_FONT or dofile(POBAI_ADAPTER .. '/live/atlas.lua')
local font = POBAI_FONT
font.install()

local cache, cached = {}, 0
local MAX_CACHE = 50000

--- Looks a phrase up, also without a trailing colon or surrounding spaces.
local function lookup(text)
	local dict = translate.dict
	if not dict or text == '' then return nil end
	local lead, core, trail = text:match('^(%s*)(.-)(%s*)$')
	if core == '' then return nil end
	local hit = dict[core]
	if hit then return lead .. hit .. trail end
	local base, colon = core:match('^(.-)(:)$')
	if base and dict[base] then return lead .. dict[base] .. colon .. trail end
	-- "Label:  value" drawn in one call (e.g. "Current build:  My Build"): translate the label.
	local label, gap, value = core:match('^([^:]-):(%s+)(.+)$')
	if label and dict[label] then return lead .. dict[label] .. ':' .. gap .. value .. trail end
	return nil
end

--- Splits "^7Label: ^x33FF33value" into colour-coded segments.
local function segments(text)
	local out = {}
	local pos, color = 1, nil
	while pos <= #text do
		local s, e, code = text:find('(%^x%x%x%x%x%x%x)', pos)
		local s2, e2, code2 = text:find('(%^%d)', pos)
		if s2 and (not s or s2 < s) then s, e, code = s2, e2, code2 end
		if not s then
			out[#out + 1] = { color = color, text = text:sub(pos) }
			break
		end
		if s > pos then out[#out + 1] = { color = color, text = text:sub(pos, s - 1) } end
		color = code
		pos = e + 1
	end
	return out
end

--- The translated string for `text` (colour codes kept), or nil.
local function translated(text)
	if not text:find('%a') then return nil end
	local plain = text:gsub('%^x%x%x%x%x%x%x', ''):gsub('%^%d', '')
	local whole = lookup(plain)
	if whole then
		local first = text:match('^%^x%x%x%x%x%x%x') or text:match('^%^%d')
		return (first or '') .. whole
	end
	local parts, any = segments(text), false
	for i, part in ipairs(parts) do
		local hit = lookup(part.text)
		if hit then any = true end
		parts[i] = (part.color or '') .. (hit or part.text)
	end
	return any and table.concat(parts) or nil
end

function translate.localize(text)
	local hit = cache[text]
	if hit == nil then
		hit = translated(text) or false
		if cached >= MAX_CACHE then cache, cached = {}, 0 end
		cache[text] = hit
		cached = cached + 1
	end
	return hit or nil
end

--- Answers from the service arrive here (bridge.lua routes every {"type":"rendered"} line).
function translate.onRendered(message)
	if message.atlas then font.onAtlas(message) end
end

function translate.enable(locale, dictPath)
	local file = assert(io.open(dictPath, 'rb'))
	local doc = json.decode(file:read('*a'))
	file:close()
	translate.locale = locale
	translate.dict = doc.entries
	cache, cached = {}, 0
	font.setLocale(locale)
	font.localize = translate.localize
	local count = 0
	for _ in pairs(doc.entries) do count = count + 1 end
	return count
end

function translate.disable()
	translate.locale, translate.dict = nil, nil
	cache, cached = {}, 0
	font.localize = nil
	font.setLocale(nil)
end

return translate
