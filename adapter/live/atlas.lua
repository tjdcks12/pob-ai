-- PoB window text through a glyph atlas (POBAI_FONT). PoB draws text with SimpleGraphic's bitmap
-- fonts, which only have ASCII glyphs. This module replaces DrawString, DrawStringWidth and
-- DrawStringCursorIndex together so that:
--   * font 'pob': PoB's own fonts draw everything they can; other characters (translations,
--     captions, Korean typed in an edit box) come from the atlas.
--   * font 'pretendard': every glyph comes from the atlas (Pretendard, with fallback fonts for
--     Thai and CJK chosen by the service).
-- ASCII keeps PoB's own advance widths: text measures exactly as with PoB's font (the Lua copy of
-- SimpleGraphic's layout below matched DrawStringWidth and DrawStringCursorIndex in PoB 0.22 and
-- 0.23 at 100-250 %), and each run of Pretendard glyphs fills the box PoB's font would use, so
-- layout and edit-box carets do not move. The service renders the atlas pages at the physical
-- pixel height (GetScreenScale), so text stays sharp at high DPI.
local font = { mode = 'pob', group = 'base' }

local RAW = POBAI_RAW
local rawDraw, rawWidth, rawSetColor = RAW.DrawString, RAW.DrawStringWidth, RAW.SetDrawColor
local rawCursor = RAW.DrawStringCursorIndex or DrawStringCursorIndex
local byte, sub, find, floor, ceil = string.byte, string.sub, string.find, math.floor, math.ceil

-- ---- PoB's bitmap font metrics (SimpleGraphic/Fonts/*.tgf) ----
local FILES = {
	VAR = 'Liberation Sans', ['VAR BOLD'] = 'Liberation Sans Bold', FIXED = 'Bitstream Vera Sans Mono',
	FONTIN = 'Fontin', ['FONTIN SC'] = 'Fontin SmallCaps', ['FONTIN ITALIC'] = 'Fontin Italic', ['FONTIN SC ITALIC'] = 'Fontin SmallCaps Italic',
}
local fonts = {}

local function loadFont(name)
	local file = FILES[name] or FILES.VAR
	if fonts[file] then return fonts[file] end
	local f = { heights = {}, map = {}, cells = {} }
	local cur
	local path = (POBAI_ROOT or '.') .. '/SimpleGraphic/Fonts/' .. file .. '.tgf'
	local handle = io.open(path, 'rb')
	if handle then
		for line in handle:lines() do
			local h = line:match('^HEIGHT%s+(%d+);')
			if h then
				cur = { height = tonumber(h), glyphs = {}, n = 0 }
				f.heights[#f.heights + 1] = cur
			elseif cur then
				local _, _, w, l, r = line:match('^GLYPH%s+(%d+)%s+(%d+)%s+(%d+)%s+(%-?%d+)%s+(%-?%d+);')
				if w then
					cur.glyphs[cur.n] = { tonumber(l), tonumber(w), tonumber(r) }
					cur.n = cur.n + 1
				end
			end
		end
		handle:close()
	end
	-- Requested heights snap to the nearest bitmap height (upper half rounds up), like SimpleGraphic.
	local n = #f.heights
	if n == 0 then f.heights[1] = { height = 16, glyphs = {} } n = 1 end
	f.maxH = f.heights[n].height
	for i, fh in ipairs(f.heights) do
		for h = fh.height, f.maxH do f.map[h] = i end
		if i > 1 then
			local lim = floor((fh.height - f.heights[i - 1].height - 1) / 2)
			for b = 0, lim - 1 do f.map[fh.height - b - 1] = i end
		end
	end
	fonts[file] = f
	return f
end

--- SimpleGraphic draws at whole physical pixels and rounds odd heights up to even.
local function physicalHeight(height, s)
	local ph = floor(height * s + 0.5)
	if ph <= 1 then return 1 end
	return ph + 1 - (ph + 1) % 2
end

--- Advance of each ASCII code at physical height ph: SimpleGraphic adds the bearings and glyph
--- width scaled to ph and rounds up per glyph; a tab is four unrounded spaces.
local function cellsFor(name, ph)
	local f = loadFont(name)
	local cells = f.cells[ph]
	if cells then return cells end
	local fh = f.heights[ph > f.maxH and #f.heights or (f.map[ph] or 1)]
	local scale = ph / fh.height
	cells = {}
	for c = 0, 127 do
		local g = fh.glyphs[c]
		cells[c] = g and ceil((g[1] + g[2] + g[3]) * scale - 1e-7) or 0
	end
	local sp = fh.glyphs[32]
	cells.tab = sp and ceil((sp[1] + sp[2] + sp[3]) * scale * 4 - 1e-7) or 0
	f.cells[ph] = cells
	return cells
end

-- ---- characters ----
--- Length of the colour escape at i (^0-^9 or ^xRRGGBB), or 0.
local function escapeLen(text, i)
	local d = byte(text, i + 1)
	if not d then return 0 end
	if d >= 48 and d <= 57 then return 2 end
	if (d == 120 or d == 88) and find(text, '^%x%x%x%x%x%x', i + 2) then return 8 end
	return 0
end

local function codepoint(text, i)
	local c = byte(text, i)
	if c < 0xC0 then return c, i end
	local n = c >= 0xF0 and 3 or c >= 0xE0 and 2 or 1
	local cp = c % (2 ^ (6 - n))
	for k = 1, n do
		local b = byte(text, i + k)
		if not b or b < 0x80 or b >= 0xC0 then return c, i end
		cp = cp * 64 + b % 64
	end
	return cp, i + n
end

-- Marks drawn on the previous character (Thai vowels and tones, combining accents, variation
-- selectors, kana voicing marks) stay in its glyph.
local function combining(cp)
	return (cp >= 0x300 and cp <= 0x36F) or cp == 0xE31 or cp == 0xE33 or (cp >= 0xE34 and cp <= 0xE3A) or (cp >= 0xE47 and cp <= 0xE4E)
		or (cp >= 0x1AB0 and cp <= 0x1AFF) or (cp >= 0x20D0 and cp <= 0x20FF) or (cp >= 0xFE00 and cp <= 0xFE0F)
		or (cp >= 0xFE20 and cp <= 0xFE2F) or cp == 0x3099 or cp == 0x309A or cp == 0x200D
end

--- Last byte of the character cluster that starts at i (a non-ASCII byte).
local function clusterEnd(text, i, j)
	local _, e = codepoint(text, i)
	while e < j do
		local cp, e2 = codepoint(text, e + 1)
		if cp < 0x80 or not combining(cp) then break end
		e = e2
	end
	return e
end

-- ---- atlas pages (rendered by the service) ----
local sets = {}         -- 'face|ph|group' -> { glyphs = { [byte or cluster] = glyph }, asked = {}, ascii = bool }
local pending = {}      -- key -> list of clusters to ask for
local inflight = {}     -- request id -> { key, list, time }
local nextId, dirty, flushedFrame, waiting = 0, false, nil, 0
local RETRY_MS = 8000

local function faceOf(name) return (name == 'VAR BOLD') and 'bold' or 'regular' end

local function setFor(name, ph)
	local key = faceOf(name) .. '|' .. ph .. '|' .. font.group
	local set = sets[key]
	if set then return set end
	set = { key = key, face = faceOf(name), ph = ph, group = font.group, glyphs = {}, asked = {}, ready = {} }
	sets[key] = set
	local list = {}
	for c = 32, 126 do list[#list + 1] = string.char(c) set.asked[string.char(c)] = true end
	pending[key] = list
	dirty, flushedFrame = true, POBAI_FRAMES
	return set
end

local function want(set, cluster)
	if set.asked[cluster] then return end
	set.asked[cluster] = true
	local list = pending[set.key]
	if not list then list = {} pending[set.key] = list end
	list[#list + 1] = cluster
	if not dirty then dirty, flushedFrame = true, POBAI_FRAMES end
end

--- Sends the glyphs asked for in earlier frames, one request per atlas size, at most once a frame.
local function flush()
	local frame = POBAI_FRAMES
	if frame and frame == flushedFrame then return end
	flushedFrame = frame
	if not pobai_emit then return end
	local now = GetTime and GetTime() or 0
	for id, req in pairs(inflight) do
		if now - req.time > RETRY_MS then
			-- No answer or a failed one (service restarting): ask again.
			local list = pending[req.key] or {}
			for _, cluster in ipairs(req.list) do list[#list + 1] = cluster end
			pending[req.key] = list
			inflight[id] = nil
			waiting = waiting - 1
		end
	end
	dirty = false
	for key, list in pairs(pending) do
		local set = sets[key]
		nextId = nextId + 1
		inflight[nextId] = { key = key, list = list, time = now }
		waiting = waiting + 1
		pobai_emit({ kind = 'glyphs', id = nextId, key = key, face = set.face, px = set.ph, group = set.group, clusters = list })
	end
	pending = {}
end

--- Called with the service's answer: { id, path, w, h, glyphs = { {x, y, w, h, ox, oy, adv}, ... } }.
function font.onAtlas(message)
	local req = inflight[message.id]
	-- A failed page stays in flight and is asked for again after RETRY_MS.
	if not req or message.error or not message.path then return end
	inflight[message.id] = nil
	waiting = waiting - 1
	local set = sets[req.key]
	local handle = NewImageHandle()
	handle:Load(message.path, 'CLAMP')
	local W, H = message.w, message.h
	for k, cluster in ipairs(req.list) do
		local g = message.glyphs[k]
		if g then
			local glyph = { handle, g[1] / W, g[2] / H, (g[1] + g[3]) / W, (g[2] + g[4]) / H, g[3], g[4], g[5], g[6], g[7] }
			if #cluster == 1 then set.glyphs[byte(cluster)] = glyph else set.glyphs[cluster] = glyph end
			if cluster == '~' then set.ascii = true end
		end
	end
end

-- ---- layout ----
local function scaleNow() return GetScreenScale and GetScreenScale() or 1 end

--- Advance in physical pixels of a missing glyph until its page arrives.
local function guess(ph) return floor(ph * 0.9 + 0.5) end

--- Physical width of text[i..j] (one line).
local function lineWidth(cells, set, text, i, j)
	local x = 0
	while i <= j do
		local c = byte(text, i)
		local esc = c == 94 and escapeLen(text, i) or 0
		if esc > 0 then
			i = i + esc
		elseif c < 128 then
			x = x + (c == 9 and cells.tab or cells[c])
			i = i + 1
		else
			local e = clusterEnd(text, i, j)
			local cluster = sub(text, i, e)
			local g = set.glyphs[cluster]
			if g then x = x + g[10] else want(set, cluster) x = x + guess(set.ph) end
			i = e + 1
		end
	end
	return x
end

--- Index (from 1) of the character under physical x in text[i..j]: the first character whose right
--- edge reaches x, like SimpleGraphic.
local function lineCursor(cells, set, text, i, j, cx)
	local x = 0
	while i <= j do
		local c = byte(text, i)
		local esc = c == 94 and escapeLen(text, i) or 0
		if esc > 0 then
			i = i + esc
		else
			local e, adv = i, nil
			if c < 128 then
				adv = c == 9 and cells.tab or cells[c]
			else
				e = clusterEnd(text, i, j)
				local g = set.glyphs[sub(text, i, e)]
				adv = g and g[10] or guess(set.ph)
			end
			x = x + adv
			if cx <= x then return i end
			i = e + 1
		end
	end
	return i
end

local function hasWide(text) return find(text, '[\128-\255]') ~= nil end

-- A translation wider than the English it replaces is squeezed horizontally into the English
-- width (down to FIT_MIN), so PoB's buttons and labels keep their layout. font.draw sets these
-- for one line at a time; glyph positions are scaled around the start of the line.
local FIT_MIN = 0.7
local fitScale, fitOrigin = 1, 0
local function fitX(x) return fitScale == 1 and x or fitOrigin + (x - fitOrigin) * fitScale end

--- Squeeze factor for a one-line translation of `original` that is `own` physical px wide.
local function fitFor(height, name, original, translated, own, s)
	if translated == original or own <= 0 or find(translated, '\n', 1, true) then return 1 end
	local english = rawWidth(height, name, original) * s
	if english <= 0 or own <= english then return 1 end
	return math.max(FIT_MIN, english / own)
end

--- Replaces DrawStringWidth.
function font.width(height, name, text)
	if type(text) ~= 'string' then return rawWidth(height, name, text) end
	local original = text
	if font.localize then text = font.localized(height, name, text) end
	if not hasWide(text) then return rawWidth(height, name, text) end
	if dirty or waiting > 0 then flush() end
	local s = scaleNow()
	local ph = physicalHeight(height, s)
	local cells, set = cellsFor(name, ph), setFor(name, ph)
	local best, i, n = 0, 1, #text
	while i <= n + 1 do
		local nl = find(text, '\n', i, true) or n + 1
		local w = lineWidth(cells, set, text, i, nl - 1)
		if w > best then best = w end
		i = nl + 1
	end
	return best * fitFor(height, name, original, text, best, s) / s
end

--- Replaces DrawStringCursorIndex: byte index (from 1) of the caret position nearest to (cx, cy).
function font.cursorIndex(height, name, text, cx, cy)
	if type(text) ~= 'string' or not hasWide(text) then return rawCursor(height, name, text, cx, cy) end
	if dirty or waiting > 0 then flush() end
	local s = scaleNow()
	local ph = physicalHeight(height, s)
	local cells, set = cellsFor(name, ph), setFor(name, ph)
	local i, n, lineY = 1, #text, height
	while true do
		local nl = find(text, '\n', i, true)
		if not nl or cy <= lineY then
			return lineCursor(cells, set, text, i, (nl or n + 1) - 1, floor(math.max(0, cx) * s + 0.5))
		end
		i = nl + 1
		lineY = lineY + height
	end
end

-- Draws one atlas glyph with its pen position at physical (x, y).
local function glyphAt(g, x, y, s)
	DrawImage(g[1], floor(fitX(x + g[8]) + 0.5) / s, (y + g[9]) / s, g[6] * fitScale / s, g[7] / s, g[2], g[3], g[4], g[5])
end

--- 'pob' font: draws text[i..j] from physical pen x on the line whose logical top is `top`;
--- runs of ASCII go to PoB's own DrawString, other characters come from the atlas.
local function drawMixed(cells, set, text, i, j, x, top, height, name, s)
	local y = floor(top * s)
	local glyphs = set.glyphs
	local runStart, runX
	while i <= j do
		local c = byte(text, i)
		local esc = c == 94 and escapeLen(text, i) or 0
		if esc > 0 then
			if runStart then rawDraw(fitX(runX) / s, top, 'LEFT', height, name, sub(text, runStart, i - 1)) runStart = nil end
			-- Like SimpleGraphic, an escape sets the draw colour for the rest of the frame.
			rawSetColor(sub(text, i, i + esc - 1))
			i = i + esc
		elseif c < 128 then
			if not runStart then runStart, runX = i, x end
			x = x + (c == 9 and cells.tab or cells[c])
			i = i + 1
		else
			if runStart then rawDraw(fitX(runX) / s, top, 'LEFT', height, name, sub(text, runStart, i - 1)) runStart = nil end
			local e = clusterEnd(text, i, j)
			local cluster = sub(text, i, e)
			local g = glyphs[cluster]
			if g then
				glyphAt(g, x, y, s)
				x = x + g[10]
			else
				want(set, cluster)
				x = x + guess(set.ph)
			end
			i = e + 1
		end
	end
	if runStart then rawDraw(fitX(runX) / s, top, 'LEFT', height, name, sub(text, runStart, j)) end
end

--- 'pretendard' font: draws text[i..j] (no tabs) into the box PoB's own font would use, from
--- physical x. The box keeps PoB's width, so layout and carets stay put; the difference between
--- PoB's and the atlas's advances is spread evenly between the characters.
local function drawRun(cells, set, text, i, j, x, y, s)
	local glyphs = set.glyphs
	local native, own, count = 0, 0, 0
	local k = i
	while k <= j do
		local c = byte(text, k)
		local esc = c == 94 and escapeLen(text, k) or 0
		if esc > 0 then
			k = k + esc
		elseif c < 128 then
			local g = glyphs[c]
			native = native + cells[c]
			own = own + (g and g[10] or cells[c])
			count = count + 1
			k = k + 1
		else
			local e = clusterEnd(text, k, j)
			local g = glyphs[sub(text, k, e)]
			local adv = g and g[10] or guess(set.ph)
			native, own, count = native + adv, own + adv, count + 1
			k = e + 1
		end
	end
	local extra = count > 0 and (native - own) / count or 0
	x = x + extra / 2
	while i <= j do
		local c = byte(text, i)
		local esc = c == 94 and escapeLen(text, i) or 0
		if esc > 0 then
			rawSetColor(sub(text, i, i + esc - 1))
			i = i + esc
		elseif c < 128 then
			local g = glyphs[c]
			if g then
				if c > 32 then glyphAt(g, x, y, s) end
				x = x + g[10] + extra
			else
				x = x + cells[c] + extra
			end
			i = i + 1
		else
			local e = clusterEnd(text, i, j)
			local cluster = sub(text, i, e)
			local g = glyphs[cluster]
			if g then
				glyphAt(g, x, y, s)
				x = x + g[10] + extra
			else
				want(set, cluster)
				x = x + guess(set.ph) + extra
			end
			i = e + 1
		end
	end
end

--- 'pretendard' font: one line, split at tabs, which keep PoB's positions.
local function drawAtlas(cells, set, text, i, j, x, top, s)
	local y = floor(top * s)
	while i <= j do
		local tab = find(text, '\t', i, true)
		local e = (tab and tab <= j) and tab - 1 or j
		if e >= i then
			drawRun(cells, set, text, i, e, x, y, s)
			x = x + lineWidth(cells, set, text, i, e)
		end
		if e == j then break end
		x = x + cells.tab
		i = e + 2
	end
end

--- Replaces DrawString (theme.lua calls it through POBAI_TEXT_DRAW).
function font.draw(left, top, align, height, name, text)
	if type(text) ~= 'string' then return rawDraw(left, top, align, height, name, text) end
	local original = text
	if font.localize then text = font.localized(height, name, text) end
	local wide = hasWide(text)
	if font.mode == 'pob' and not wide then return rawDraw(left, top, align, height, name, text) end
	if dirty or waiting > 0 then flush() end
	local s = scaleNow()
	local ph = physicalHeight(height, s)
	local set = setFor(name, ph)
	local all = font.mode == 'pretendard'
	if all and not set.ascii then
		-- The page for this size is on its way; PoB's own font until then.
		if not wide then return rawDraw(left, top, align, height, name, text) end
		all = false
	end
	local cells = cellsFor(name, ph)
	local fit = text ~= original and fitFor(height, name, original, text, lineWidth(cells, set, text, 1, #text), s) or 1
	local i, n = 1, #text
	while i <= n do
		local nl = find(text, '\n', i, true) or n + 1
		if nl > i then
			local x
			if align == 'LEFT' or align == nil then
				x = floor(left * s + 0.5)
			else
				local w = lineWidth(cells, set, text, i, nl - 1) * fit
				if align == 'CENTER' then
					local vw = GetVirtualScreenSize and GetVirtualScreenSize() or (GetScreenSize() / s)
					x = floor(((vw - w / s) / 2 + left) * s)
				elseif align == 'RIGHT' then
					local vw = GetVirtualScreenSize and GetVirtualScreenSize() or (GetScreenSize() / s)
					x = floor((vw - w / s - left) * s)
				elseif align == 'CENTER_X' then
					x = floor(left * s - w / 2)
				else -- RIGHT_X
					x = floor(left * s - w)
				end
			end
			fitScale, fitOrigin = fit, x
			if all then
				drawAtlas(cells, set, text, i, nl - 1, x, top, s)
			else
				drawMixed(cells, set, text, i, nl - 1, x, top, height, name, s)
			end
			fitScale = 1
		end
		top = top + height
		i = nl + 1
	end
end

--- Text the window language wants drawn instead of `text`, once all its glyphs are ready.
function font.localized(height, name, text)
	local t = font.localize(text)
	if not t then return text end
	local ph = physicalHeight(height, scaleNow())
	local set = setFor(name, ph)
	if set.ready[t] then return t end
	local ready = true
	local i, n = 1, #t
	while i <= n do
		local c = byte(t, i)
		if c < 128 then
			i = i + 1
		else
			local e = clusterEnd(t, i, n)
			local cluster = sub(t, i, e)
			if not set.glyphs[cluster] then want(set, cluster) ready = false end
			i = e + 1
		end
	end
	if not ready then return text end
	set.ready[t] = true
	return t
end

-- ---- switching ----
local GROUPS = { ja = 'ja', ['zh-Hant'] = 'zh' }

--- Locale whose CJK glyph forms are used (Japanese kanji vs. traditional Chinese).
function font.setLocale(locale) font.group = GROUPS[locale] or 'base' end

--- 'pretendard' or 'pob'. Returns the font now in use.
function font.apply(name)
	font.mode = name == 'pretendard' and 'pretendard' or 'pob'
	return font.mode
end

--- Puts the three text functions in place. theme.lua draws through POBAI_TEXT_DRAW.
function font.install()
	POBAI_TEXT_DRAW = font.draw
	DrawStringWidth = font.width
	DrawStringCursorIndex = font.cursorIndex
	if DrawString == rawDraw then DrawString = font.draw end
end

-- For the tests and the layout check (ops/ui.lua 'ui.font_check').
font.physicalHeight, font.cellsFor, font.setFor = physicalHeight, cellsFor, setFor
font.lineWidth, font.lineCursor, font.rawCursor = lineWidth, lineCursor, rawCursor

return font
