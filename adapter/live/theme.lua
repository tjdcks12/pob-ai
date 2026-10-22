-- Recolours the PoB window without touching PoB's files. PoB sets colours through two global
-- functions (SetDrawColor and colour codes inside DrawString text) and never keeps local copies
-- of them, so wrapping the globals reaches every control. Only neutral greys are remapped:
-- rarity, damage-type and other saturated colours keep their meaning.
local theme = { current = 'default' }

-- Each theme maps grey lightness 0..1 onto a ramp from its darkest to its lightest colour.
local PALETTES = {
	ember = { dark = { 0.07, 0.055, 0.045 }, mid = { 0.36, 0.30, 0.24 }, light = { 0.95, 0.90, 0.82 } },
	vaal = { dark = { 0.075, 0.035, 0.04 }, mid = { 0.40, 0.20, 0.22 }, light = { 0.96, 0.88, 0.88 } },
	midnight = { dark = { 0.045, 0.06, 0.085 }, mid = { 0.24, 0.31, 0.42 }, light = { 0.88, 0.92, 0.97 } },
}

local CODE_GREYS = { ['0'] = 0, ['7'] = 0.8, ['8'] = 0.5, ['9'] = 0.25 }

local rawSetDrawColor = SetDrawColor
local rawDrawString = DrawString

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

local function mapRGB(palette, r, g, b)
	-- Pure white is the image tint for icons and art; leave it alone.
	if not isGrey(r, g, b) or (r > 0.97 and g > 0.97 and b > 0.97) then return r, g, b end
	return ramp(palette, (r + g + b) / 3)
end

local function hex(r, g, b)
	return ('^x%02X%02X%02X'):format(math.floor(r * 255 + 0.5), math.floor(g * 255 + 0.5), math.floor(b * 255 + 0.5))
end

local function mapText(palette, text)
	if type(text) ~= 'string' then return text end
	text = text:gsub('%^x(%x%x)(%x%x)(%x%x)', function(rh, gh, bh)
		local r, g, b = tonumber(rh, 16) / 255, tonumber(gh, 16) / 255, tonumber(bh, 16) / 255
		local nr, ng, nb = mapRGB(palette, r, g, b)
		return hex(nr, ng, nb)
	end)
	return (text:gsub('%^([0789])', function(code) return hex(ramp(palette, CODE_GREYS[code])) end))
end

function theme.apply(name)
	local palette = PALETTES[name]
	theme.current = palette and name or 'default'
	-- The window background is the renderer's clear colour, not a Lua draw call.
	if not palette then
		SetDrawColor = rawSetDrawColor
		DrawString = rawDrawString
		if SetClearColor then SetClearColor(0.082, 0.11, 0.153) end
		return
	end
	if SetClearColor then SetClearColor(palette.dark[1], palette.dark[2], palette.dark[3]) end
	SetDrawColor = function(r, g, b, a)
		if type(r) == 'string' then
			local mapped = mapText(palette, r)
			return rawSetDrawColor(mapped, g)
		end
		if type(r) == 'number' and g and b then
			local nr, ng, nb = mapRGB(palette, r, g, b)
			return rawSetDrawColor(nr, ng, nb, a)
		end
		return rawSetDrawColor(r, g, b, a)
	end
	DrawString = function(left, top, align, height, font, text)
		return rawDrawString(left, top, align, height, font, mapText(palette, text))
	end
end

-- Light themes are left out: PoB draws much of its text in white, which stays white.
theme.names = { 'default', 'ember', 'vaal', 'midnight' }
return theme
