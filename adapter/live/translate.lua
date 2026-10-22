-- Shows PoB's own screens in another language. PoB's bitmap fonts only contain ASCII glyphs
-- (SimpleGraphic keeps 128 glyphs per font size), so translated text is rendered by the PoB AI
-- service as small PNG images and drawn with DrawImage where PoB would have drawn the English
-- text. Untranslated text, and text whose image is not ready yet, is drawn as before.
local json = require('dkjson')
local translate = { locale = nil, dict = nil }

local RAW = POBAI_RAW
local images = {}      -- key -> { handle, w, h } once rendered
local requested = {}   -- key -> true while the service renders it
local requestsThisFrame, frameMark = 0, 0
local MAX_REQUESTS_PER_FRAME = 40

local function keyFor(text, height, bold)
	return translate.locale .. '|' .. height .. '|' .. (bold and 'b' or 'r') .. '|' .. text
end

local function imageFor(text, height, font)
	local bold = font == 'VAR BOLD'
	local key = keyFor(text, height, bold)
	local image = images[key]
	if image then return image end
	if not requested[key] then
		local now = GetTime()
		if now ~= frameMark then frameMark, requestsThisFrame = now, 0 end
		if requestsThisFrame < MAX_REQUESTS_PER_FRAME and pobai_emit then
			requestsThisFrame = requestsThisFrame + 1
			requested[key] = true
			pobai_emit({ kind = 'render', key = key, text = text, height = height, bold = bold })
		end
	end
	return nil
end

function translate.onRendered(message)
	requested[message.key] = nil
	if message.error or not message.path then return end
	local handle = NewImageHandle()
	handle:Load(message.path)
	images[message.key] = { handle = handle, w = message.w, h = message.h }
end

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

--- Plans how a string is drawn: per segment either a ready image or the original text.
local function plan(height, font, text)
	if type(text) ~= 'string' or not text:find('%a') then return nil end
	local plain = text:gsub('%^x%x%x%x%x%x%x', ''):gsub('%^%d', '')
	local parts
	local whole = lookup(plain)
	if whole then
		local first = text:match('^%^x%x%x%x%x%x%x') or text:match('^%^%d')
		parts = { { color = first, text = plain, translated = whole } }
	else
		parts = segments(text)
		local any = false
		for _, part in ipairs(parts) do
			part.translated = lookup(part.text)
			if part.translated then any = true end
		end
		if not any then return nil end
	end
	local total = 0
	for _, part in ipairs(parts) do
		part.image = part.translated and imageFor(part.translated, height, font)
		if part.image then
			part.w = part.image.w
		else
			part.w = RAW.DrawStringWidth(height, font, (part.color or '') .. part.text)
		end
		total = total + part.w
	end
	return parts, total
end

local function drawString(left, top, align, height, font, text)
	if align == 'CENTER' then return RAW.DrawString(left, top, align, height, font, text) end
	local parts, total = plan(height, font, text)
	if not parts then return RAW.DrawString(left, top, align, height, font, text) end
	local x = left
	if align == 'CENTER_X' then x = left - total / 2 elseif align == 'RIGHT_X' or align == 'RIGHT' then x = left - total end
	local r, g, b, a
	if GetDrawColor then r, g, b, a = GetDrawColor() end
	for _, part in ipairs(parts) do
		if part.image then
			if part.color then RAW.SetDrawColor(part.color) end
			DrawImage(part.image.handle, math.floor(x + 0.5), top, part.image.w, height)
		else
			RAW.DrawString(x, top, 'LEFT', height, font, (part.color or '') .. part.text)
		end
		x = x + part.w
	end
	if r then RAW.SetDrawColor(r, g, b, a) end
end

local function drawStringWidth(height, font, text)
	local parts, total = plan(height, font, text)
	if not parts then return RAW.DrawStringWidth(height, font, text) end
	return total
end

function translate.enable(locale, dictPath)
	local file = assert(io.open(dictPath, 'rb'))
	local doc = json.decode(file:read('*a'))
	file:close()
	translate.locale = locale
	translate.dict = doc.entries
	images, requested = {}, {}
	POBAI_TEXT_DRAW = drawString
	DrawStringWidth = drawStringWidth
	if POBAI_THEME then POBAI_THEME.reapply() else DrawString = drawString end
	local count = 0
	for _ in pairs(doc.entries) do count = count + 1 end
	return count
end

function translate.disable()
	translate.locale, translate.dict = nil, nil
	images, requested = {}, {}
	POBAI_TEXT_DRAW = RAW.DrawString
	DrawStringWidth = RAW.DrawStringWidth
	if POBAI_THEME then POBAI_THEME.reapply() else DrawString = RAW.DrawString end
end

return translate
