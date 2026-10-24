-- Shows PoB's own screens in another language. Each string PoB draws is looked up in a phrase
-- dictionary and the translation is drawn instead, through the same glyph atlas as the window
-- font (adapter/live/atlas.lua): PoB's bitmap fonts only contain ASCII glyphs, so the service
-- renders the other glyphs. Until a translation's glyphs are ready the English text is drawn.
local json = require('dkjson')
local translate = { locale = nil, dict = nil, templates = {} }

POBAI_FONT = POBAI_FONT or dofile(POBAI_ADAPTER .. '/live/atlas.lua')
local font = POBAI_FONT
font.install()

local cache, cached = {}, 0
local MAX_CACHE = 50000

local function numeric(value)
	local n = '%-?%d[%d,]*%.?%d*'
	value = value:gsub('^%+', '')
	return value:match('^' .. n .. '$') or value:match('^%(' .. n .. '%-' .. n .. '%)$')
		or value:match('^' .. n .. '%(' .. n .. '%-' .. n .. '%)$')
end

-- The service pairs official CSD slots by identity. Only display strings move; roll ranges,
-- signs, decimal precision and colour-coded values are preserved byte for byte.
local function render(core, paint, offset)
	local bucket = core:match('^([A-Za-z]+)') or '#'
	local result
	for _, rule in ipairs(translate.templates[bucket] or {}) do
		local captures = { core:match(rule.pattern) }
		if #captures > 0 then
			local values, valid = {}, true
			for i, index in ipairs(rule.slots) do
				local start, value, finish = captures[i * 3 - 2], captures[i * 3 - 1], captures[i * 3]
				if not value or not numeric(value) then valid = false break end
				if values[index] and values[index].plain ~= value then valid = false break end
				values[index] = { plain = value, text = paint and paint(offset + start, offset + finish - 1) or value }
			end
			if valid then
				local parts = {}
				for i, part in ipairs(rule.parts) do parts[i] = type(part) == 'number' and values[part].text or part end
				local hit = table.concat(parts)
				if result and result ~= hit then return nil end
				result = hit
			end
		end
	end
	return result
end

--- Looks a phrase up, also without a trailing colon or surrounding spaces.
local function lookup(text, paint)
	local dict = translate.dict
	if not dict or text == '' then return nil end
	local lead, core, trail = text:match('^(%s*)(.-)(%s*)$')
	if core == '' then return nil end
	local hit = dict[core]
	if hit then return lead .. hit .. trail end
	local dynamic = render(core, paint, #lead)
	if dynamic then return lead .. dynamic .. trail end
	local body, gap, annotation = core:match('^(.-)(%s+)(%([^()]+%))$')
	if body and dict[annotation] then
		local localBody = lookup(body, paint)
		if localBody then
			local tail = paint and paint(#lead + #body + #gap + 1, #lead + #core, dict[annotation]) or dict[annotation]
			return lead .. localBody .. gap .. tail .. trail
		end
	end
	-- PoB joins unique/template names with their base for list rows.
	local name, base = core:match('^(.*), (.-)$')
	if name and (dict[name] or dict[base]) then
		local amount, label = name:match('^([%+%-]?%d+%s+)(.+)$')
		local localName = dict[name] or (amount and dict[label] and amount .. dict[label]) or name
		return lead .. localName .. ', ' .. (dict[base] or base) .. trail
	end
	-- Comparison values are authored by PoB, rather than by the game's CSD.
	local amount, stat, change = core:match('^([%+%-][%d%.,]+%%?%s+)(.-)(%s+%([%+%-][%d%.,]+%%%))$')
	if not amount then amount, stat = core:match('^([%+%-][%d%.,]+%%?%s+)(.+)$') end
	if stat and dict[stat] then return lead .. amount .. dict[stat] .. (change or '') .. trail end
	local slot, extra = core:match('^Equipping this item in (.-) will give you:(.*)$')
	local equip = dict['Equipping this item in {slot} will give you:']
	if slot and equip then return lead .. equip:gsub('{slot}', function() return dict[slot] or slot end) .. extra .. trail end
	local base, colon = core:match('^(.-)(:)$')
	if base and dict[base] then return lead .. dict[base] .. colon .. trail end
	-- "Label:  value" drawn in one call (e.g. "Current build:  My Build"): translate the label.
	local label, gap, value = core:match('^([^:]-):(%s+)(.+)$')
	if label and dict[label] then
		local number, unit = value:match('^([%d%.]+) (%a+)$')
		return lead .. dict[label] .. ':' .. gap .. (dict[value] or (number and dict[unit] and number .. ' ' .. dict[unit]) or value) .. trail
	end
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
	local parts = segments(text)
	local first = text:match('^%^x%x%x%x%x%x%x') or text:match('^%^%d')
	local function paint(start, finish, replacement)
		local offset, out = 0, {}
		for _, part in ipairs(parts) do
			local a, b = math.max(start, offset + 1), math.min(finish, offset + #part.text)
			if a <= b then
				if replacement then return (part.color or first or '') .. replacement .. (first or '') end
				out[#out + 1] = (part.color or first or '') .. part.text:sub(a - offset, b - offset)
			end
			offset = offset + #part.text
		end
		return table.concat(out) .. (first or '')
	end
	local whole = lookup(plain, paint)
	if whole then
		return (first or '') .. whole
	end
	local any = false
	for i, part in ipairs(parts) do
		local hit = lookup(part.text)
		if hit then any = true end
		parts[i] = (part.color or '') .. (hit or part.text)
	end
	return any and table.concat(parts) or nil
end

-- Translate tooltip prose before PoB wraps it, so long flavour text still matches the official
-- string. PoB's Equipping/Removing block markers keep their original layout decisions.
local tooltipClass
local function installTooltips()
	local class = common and common.classes and common.classes.Tooltip
	if not class or class == tooltipClass then return end
	tooltipClass = class
	local add, check = class.AddLine, class.CheckForUpdate
	if add then class.AddLine = function(self, size, text, ...)
		if type(text) == 'string' and not text:find('Equipping', 1, true) and not text:find('Removing', 1, true) then text = translate.localize(text) or text end
		return add(self, size, text, ...)
	end end
	if check then class.CheckForUpdate = function(self, ...)
		if self._pobai_locale ~= translate.locale then self._pobai_locale = translate.locale self.updateParams = nil end
		return check(self, ...)
	end end
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
	translate.templates = {}
	for _, rule in ipairs(doc.templates or {}) do
		local list = translate.templates[rule.bucket] or {}
		list[#list + 1] = rule
		translate.templates[rule.bucket] = list
	end
	cache, cached = {}, 0
	installTooltips()
	font.setLocale(locale)
	font.localize = translate.localize
	local count = 0
	for _ in pairs(doc.entries) do count = count + 1 end
	return count
end

function translate.disable()
	translate.locale, translate.dict = nil, nil
	translate.templates = {}
	cache, cached = {}, 0
	font.localize = nil
	font.setLocale(nil)
end

return translate
