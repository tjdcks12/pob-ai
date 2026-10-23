-- Recolours the PoB window without touching PoB's files. PoB sets colours through two global
-- functions (SetDrawColor and colour codes inside DrawString text) and never keeps local copies
-- of them, so wrapping the globals reaches every control. Neutral greys are remapped onto the
-- theme; rarity, damage-type and other saturated colours keep their hue.
-- "pob" keeps Path of Building's own look. Other palettes come from ui/tokens.css,
-- with PoB's controls redrawn by skin.lua.
local theme = { current = 'pob' }

-- Saved ids from earlier versions, which had other palettes.
local ALIASES = { default = 'pob', ember = 'dark', vaal = 'dark', midnight = 'dark', parchment = 'light' }

local CODE_GREYS = { ['0'] = 0, ['7'] = 0.8, ['8'] = 0.5, ['9'] = 0.25 }
-- SimpleGraphic's own clear colour (PoB never sets one); measured black in PoB 0.22 and 0.23.
local DEFAULT_CLEAR = { 0, 0, 0 }

local okTokens, TOKENS = pcall(function() return dofile(POBAI_ADAPTER .. '/live/tokens.lua').load() end)
if not okTokens then pobai_log('theme: ' .. tostring(TOKENS)) TOKENS = nil end

--- Grey lightness 0..1 maps onto a ramp from the background to the text colour; text uses its
--- own ramp so dim PoB text stays readable. A few exact greys are PoB's window furniture and get
--- their own token: 0.85 the 4 px separators, 0.1 the side bar and bottom bar, 0.2 the top build
--- bar, 0.05 the bars under the tree and in the compare tab.
local function palette(t, isLight)
	return {
		dark = t.bg, mid = t.line, light = t.fg,
		text = { dark = t['fg-4'], mid = t['fg-3'], light = t.fg },
		exact = { [0.05] = t['surface-inner'], [0.1] = t.surface, [0.2] = t['surface-inner'], [0.85] = t.divider },
		isLight = isLight, tokens = t,
	}
end
local PALETTES = {}
for id, t in pairs(TOKENS or {}) do PALETTES[id] = palette(t, t.bg[1] > .5) end

-- Raw drawing functions captured before any wrapping; text goes through POBAI_TEXT_DRAW so the
-- window translation (translate.lua) and the theme compose.
local rawSetDrawColor = POBAI_RAW.SetDrawColor
local function innerDrawString(...) return POBAI_TEXT_DRAW(...) end

local function lerp(a, b, t) return a + (b - a) * t end

local function ramp(p, l)
	if l <= 0.5 then
		local t = l / 0.5
		return lerp(p.dark[1], p.mid[1], t), lerp(p.dark[2], p.mid[2], t), lerp(p.dark[3], p.mid[3], t)
	end
	local t = (l - 0.5) / 0.5
	return lerp(p.mid[1], p.light[1], t), lerp(p.mid[2], p.light[2], t), lerp(p.mid[3], p.light[3], t)
end

local function isGrey(r, g, b) return math.max(r, g, b) - math.min(r, g, b) < 0.06 end
local function isWhite(r, g, b) return r > 0.97 and g > 0.97 and b > 0.97 end

--- Colours used for shapes and image tints. Pure white is the tint for icons and art; keep it.
local function mapRGB(p, r, g, b)
	if not isGrey(r, g, b) or isWhite(r, g, b) then return r, g, b end
	local exact = r == g and g == b and p.exact[r]
	if exact then return exact[1], exact[2], exact[3] end
	return ramp(p, (r + g + b) / 3)
end

--- Colours used for text. On a light theme white text becomes ink and bright colours are
--- darkened so they stay readable on paper.
local function mapTextRGB(p, r, g, b)
	if isGrey(r, g, b) then return ramp(p.text, isWhite(r, g, b) and 1 or (r + g + b) / 3) end
	if p.isLight then
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

local function mapCodes(p, text)
	text = text:gsub('%^x(%x%x)(%x%x)(%x%x)', function(rh, gh, bh)
		return hex(mapTextRGB(p, tonumber(rh, 16) / 255, tonumber(gh, 16) / 255, tonumber(bh, 16) / 255))
	end)
	return (text:gsub('%^([0789])', function(code) return hex(ramp(p.text, CODE_GREYS[code])) end))
end

-- PoB draws mostly the same strings every frame; remember their recoloured form.
local cache, cacheSize = {}, 0
local function mapText(p, text)
	if type(text) ~= 'string' or not text:find('^', 1, true) then return text end
	local hit = cache[text]
	if hit then return hit end
	hit = mapCodes(p, text)
	if cacheSize > 4000 then cache, cacheSize = {}, 0 end
	cache[text], cacheSize = hit, cacheSize + 1
	return hit
end

--- A colour given as a single colour code ("^xRRGGBB" or a grey "^0"/"^7"/"^8"/"^9") as numbers.
--- PoB passes such codes to SetDrawColor for shapes too (Calcs cells), so they are mapped like
--- numbers: as shapes, and as text when a string is drawn in them.
local codeCache = {}
local function codeRGB(code)
	local c = codeCache[code]
	if c == nil then
		local rh, gh, bh = code:match('^%^x(%x%x)(%x%x)(%x%x)$')
		local l = CODE_GREYS[code:match('^%^(%d)$') or '']
		if rh then c = { tonumber(rh, 16) / 255, tonumber(gh, 16) / 255, tonumber(bh, 16) / 255 }
		elseif l then c = { l, l, l }
		else c = false end
		codeCache[code] = c
	end
	if c then return c[1], c[2], c[3] end
end

-- Colour of the last SetDrawColor call: numbers, or nil after another colour string.
local lastR, lastG, lastB, lastA = 1, 1, 1, 1
local rawDrawBackground

--- Normalises a theme id, including ids saved by earlier versions; unknown ids are "pob".
function theme.resolve(name)
	name = ALIASES[name] or name
	return PALETTES[name] and name or 'pob'
end

function theme.apply(name)
	theme.current = theme.resolve(name)
	if POBAI_WINDOW and POBAI_WINDOW.setTheme then pcall(POBAI_WINDOW.setTheme, theme.current) end
	-- pob keeps PoB's bitmap fonts; the poe2way themes draw all text in Pretendard.
	if POBAI_FONT then pcall(POBAI_FONT.apply, theme.current == 'pob' and 'pob' or 'pretendard') end
	local p = PALETTES[theme.current]
	cache, cacheSize = {}, 0
	local main = POBAI_MAIN
	rawDrawBackground = rawDrawBackground or (main and main.DrawBackground)
	if POBAI_SKIN then
		local ok, err = pcall(POBAI_SKIN.set, p and p.tokens)
		if not ok then pobai_log('skin: ' .. tostring(err)) POBAI_SKIN.set(nil) end
	end
	-- The window background is the renderer's clear colour, not a Lua draw call.
	if not p then
		SetDrawColor = rawSetDrawColor
		DrawString = innerDrawString
		if main and rawDrawBackground then main.DrawBackground = rawDrawBackground end
		if SetClearColor then SetClearColor(DEFAULT_CLEAR[1], DEFAULT_CLEAR[2], DEFAULT_CLEAR[3]) end
		return
	end
	if SetClearColor then SetClearColor(p.dark[1], p.dark[2], p.dark[3]) end
	-- Tab backgrounds are a dark texture in some PoB versions; paint them in the theme colour.
	if main and rawDrawBackground then
		main.DrawBackground = function(_, viewPort)
			SetDrawLayer(nil, -100)
			rawSetDrawColor(p.dark[1], p.dark[2], p.dark[3])
			DrawImage(nil, viewPort.x, viewPort.y, viewPort.width, viewPort.height)
			rawSetDrawColor(1, 1, 1, 1)
			SetDrawLayer(nil, 0)
		end
	end
	SetDrawColor = function(r, g, b, a)
		if type(r) == 'string' then
			local cr, cg, cb = codeRGB(r)
			if not cr then
				lastR = nil
				return rawSetDrawColor(mapText(p, r), g)
			end
			r, g, b, a = cr, cg, cb, g
		end
		if type(r) == 'number' and g and b then
			lastR, lastG, lastB, lastA = r, g, b, a
			-- Translucent black is a scrim (behind popups); it stays black on both themes.
			if a and a < 1 and r == 0 and g == 0 and b == 0 then return rawSetDrawColor(0, 0, 0, a) end
			local nr, ng, nb = mapRGB(p, r, g, b)
			return rawSetDrawColor(nr, ng, nb, a)
		end
		return rawSetDrawColor(r, g, b, a)
	end
	DrawString = function(left, top, align, height, font, text)
		-- Text drawn in the current colour (no leading code) uses the text mapping, so grey and
		-- white labels land on the text ramp while image tints keep the shape mapping.
		if lastR and type(text) == 'string' and not text:find('^%^[%dx]') then
			local r, g, b = mapTextRGB(p, lastR, lastG, lastB)
			rawSetDrawColor(r, g, b, lastA)
			innerDrawString(left, top, align, height, font, mapText(p, text))
			local nr, ng, nb = mapRGB(p, lastR, lastG, lastB)
			return rawSetDrawColor(nr, ng, nb, lastA)
		end
		return innerDrawString(left, top, align, height, font, mapText(p, text))
	end
end

function theme.reapply() theme.apply(theme.current) end

--- The passive tree is game art made for a dark backdrop, so on the light theme it is drawn
--- in PoB's own colours (skin.lua calls this around the tree view's Draw). Returns true when
--- it switched the theme off; theme.resume() switches it back.
theme.suspended = false
local saved = {}
function theme.suspend()
	local p = PALETTES[theme.current]
	if not (p and p.isLight) or theme.suspended then return false end
	local main = POBAI_MAIN
	saved[1], saved[2], saved[3] = SetDrawColor, DrawString, main.DrawBackground
	SetDrawColor, DrawString, main.DrawBackground = rawSetDrawColor, innerDrawString, rawDrawBackground
	theme.suspended = true
	return true
end
function theme.resume()
	SetDrawColor, DrawString, POBAI_MAIN.DrawBackground = saved[1], saved[2], saved[3]
	theme.suspended = false
end

--- The numbers PoB passed to its last SetDrawColor call (nil after a colour-code string); the
--- skin reads a control's state from them.
function theme.lastColour() return lastR, lastG, lastB end

--- A colour PoB asked for, as the current theme draws text in it.
function theme.textColour(r, g, b)
	local p = PALETTES[theme.current]
	if not p then return r, g, b end
	return mapTextRGB(p, r, g, b)
end

--- Token set of the current theme, or the dark one under PoB's own look or while the theme is
--- suspended (nil without tokens).
function theme.tokens()
	local p = (not theme.suspended and PALETTES[theme.current]) or PALETTES.dark
	return p and p.tokens
end

theme.names = { 'pob', 'dark', 'light', 'ocean', 'forest', 'sand' }
return theme
