-- Recolours the PoB window without touching PoB's files. PoB sets colours through two global
-- functions (SetDrawColor and colour codes inside DrawString text) and never keeps local copies
-- of them, so wrapping the globals reaches every control. Neutral greys are remapped onto the
-- theme; rarity, damage-type and other saturated colours keep their hue.
local theme = { current = 'default' }

-- Each theme maps grey lightness 0..1 onto a ramp from its background to its text colour.
local PALETTES = {
	ember = { dark = { 0.07, 0.055, 0.045 }, mid = { 0.36, 0.30, 0.24 }, light = { 0.95, 0.90, 0.82 } },
	vaal = { dark = { 0.075, 0.035, 0.04 }, mid = { 0.40, 0.20, 0.22 }, light = { 0.96, 0.88, 0.88 } },
	midnight = { dark = { 0.045, 0.06, 0.085 }, mid = { 0.24, 0.31, 0.42 }, light = { 0.88, 0.92, 0.97 } },
	-- Light theme: the "dark" end is the paper and the "light" end is the ink.
	parchment = { dark = { 0.93, 0.89, 0.81 }, mid = { 0.62, 0.55, 0.46 }, light = { 0.16, 0.12, 0.08 }, isLight = true },
}

local CODE_GREYS = { ['0'] = 0, ['7'] = 0.8, ['8'] = 0.5, ['9'] = 0.25 }
local DEFAULT_CLEAR = { 0.082, 0.11, 0.153 }

-- Raw drawing functions captured before any wrapping; text goes through POBAI_TEXT_DRAW so the
-- window translation (translate.lua) and the theme compose.
local rawSetDrawColor = POBAI_RAW.SetDrawColor
local function innerDrawString(...) return POBAI_TEXT_DRAW(...) end

local function lerp(a, b, t) return a + (b - a) * t end

local function ramp(palette, l)
	if l <= 0.5 then
		local t = l / 0.5
		return lerp(palette.dark[1], palette.mid[1], t), lerp(palette.dark[2], palette.mid[2], t), lerp(palette.dark[3], palette.mid[3], t)
	end
	local t = (l - 0.5) / 0.5
	return lerp(palette.mid[1], palette.light[1], t), lerp(palette.mid[2], palette.light[2], t), lerp(palette.mid[3], palette.light[3], t)
end

local function isGrey(r, g, b) return math.max(r, g, b) - math.min(r, g, b) < 0.06 end
local function isWhite(r, g, b) return r > 0.97 and g > 0.97 and b > 0.97 end

--- Colours used for shapes and image tints. Pure white is the tint for icons and art; keep it.
local function mapRGB(palette, r, g, b)
	if not isGrey(r, g, b) or isWhite(r, g, b) then return r, g, b end
	return ramp(palette, (r + g + b) / 3)
end

--- Colours used for text. On a light theme white text becomes ink and bright colours are
--- darkened so they stay readable on paper.
local function mapTextRGB(palette, r, g, b)
	if isGrey(r, g, b) then return ramp(palette, isWhite(r, g, b) and 1 or (r + g + b) / 3) end
	if palette.isLight then
		local lum = 0.3 * r + 0.59 * g + 0.11 * b
		if lum > 0.45 then
			local k = 0.45 / lum * 0.85
			return r * k, g * k, b * k
		end
	end
	return r, g, b
end

local function hex(r, g, b)
	return ('^x%02X%02X%02X'):format(math.floor(r * 255 + 0.5), math.floor(g * 255 + 0.5), math.floor(b * 255 + 0.5))
end

local function mapText(palette, text)
	if type(text) ~= 'string' then return text end
	text = text:gsub('%^x(%x%x)(%x%x)(%x%x)', function(rh, gh, bh)
		return hex(mapTextRGB(palette, tonumber(rh, 16) / 255, tonumber(gh, 16) / 255, tonumber(bh, 16) / 255))
	end)
	return (text:gsub('%^([0789])', function(code) return hex(ramp(palette, CODE_GREYS[code])) end))
end

local last = { 1, 1, 1, 1 }
local rawDrawBackground

function theme.apply(name)
	local palette = PALETTES[name]
	theme.current = palette and name or 'default'
	local main = POBAI_MAIN
	rawDrawBackground = rawDrawBackground or (main and main.DrawBackground)
	-- The window background is the renderer's clear colour, not a Lua draw call.
	if not palette then
		SetDrawColor = rawSetDrawColor
		DrawString = innerDrawString
		if main and rawDrawBackground then main.DrawBackground = rawDrawBackground end
		if SetClearColor then SetClearColor(DEFAULT_CLEAR[1], DEFAULT_CLEAR[2], DEFAULT_CLEAR[3]) end
		return
	end
	if SetClearColor then SetClearColor(palette.dark[1], palette.dark[2], palette.dark[3]) end
	-- Tab backgrounds are a dark texture in some PoB versions; paint them in the theme colour.
	if main and rawDrawBackground then
		main.DrawBackground = function(_, viewPort)
			SetDrawLayer(nil, -100)
			rawSetDrawColor(palette.dark[1], palette.dark[2], palette.dark[3])
			DrawImage(nil, viewPort.x, viewPort.y, viewPort.width, viewPort.height)
			rawSetDrawColor(1, 1, 1, 1)
			SetDrawLayer(nil, 0)
		end
	end
	SetDrawColor = function(r, g, b, a)
		if type(r) == 'string' then
			last = { r }
			return rawSetDrawColor(mapText(palette, r), g)
		end
		if type(r) == 'number' and g and b then
			last = { r, g, b, a }
			local nr, ng, nb = mapRGB(palette, r, g, b)
			return rawSetDrawColor(nr, ng, nb, a)
		end
		return rawSetDrawColor(r, g, b, a)
	end
	DrawString = function(left, top, align, height, font, text)
		-- Text drawn in the current colour (no leading code) uses the text mapping, so white
		-- labels become ink on a light theme while white image tints stay untouched.
		if palette.isLight and type(last[1]) == 'number' and type(text) == 'string' and not text:match('^%^') then
			local r, g, b = mapTextRGB(palette, last[1], last[2], last[3])
			rawSetDrawColor(r, g, b, last[4])
			innerDrawString(left, top, align, height, font, mapText(palette, text))
			local nr, ng, nb = mapRGB(palette, last[1], last[2], last[3])
			return rawSetDrawColor(nr, ng, nb, last[4])
		end
		return innerDrawString(left, top, align, height, font, mapText(palette, text))
	end
end

function theme.reapply() theme.apply(theme.current) end

theme.names = { 'default', 'ember', 'vaal', 'midnight', 'parchment' }
return theme
