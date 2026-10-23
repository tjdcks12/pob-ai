-- Highlights the agent points at: a pulsing outline around a rectangle or control, with an
-- optional caption. Drawn after PoB's own frame so it stays on top.
local overlay = { items = {} }
local rawSetDrawColor = POBAI_RAW.SetDrawColor

local function rectOf(target)
	if target.rect then return unpack(target.rect) end
	local control = target.control
	if not control or (control.IsShown and not control:IsShown()) then return nil end
	local x, y = control:GetPos()
	local w, h = control:GetSize()
	return x, y, w, h
end

--- Adds a highlight. target = { control = <Control> } or { rect = {x, y, w, h} } or { draw = fn }.
function overlay.show(target, caption, seconds)
	overlay.items = { { target = target, caption = caption, untilTime = GetTime() + (seconds or 6) * 1000 } }
end

function overlay.clear() overlay.items = {} end

-- Colours follow poe2way's focus ring (features/agent/focus.css): a 2 px accent outline with a
-- faint accent fill, and the caption as a chip in the inner surface colour with an accent border.
-- Set with the raw SetDrawColor so the window theme does not remap the token greys.
local FALLBACK = { primary = { 0.33, 0.51, 0.91 }, ['surface-inner'] = { 0.16, 0.16, 0.19 }, fg = { 1, 1, 1 } }
local function colours()
	local t = POBAI_THEME and POBAI_THEME.tokens and POBAI_THEME.tokens()
	return t or FALLBACK
end

local function rgbCode(c)
	return ('^x%02X%02X%02X'):format(math.floor(c[1] * 255 + 0.5), math.floor(c[2] * 255 + 0.5), math.floor(c[3] * 255 + 0.5))
end

local function outline(x, y, w, h, t)
	DrawImage(nil, x - t, y - t, w + t * 2, t)
	DrawImage(nil, x - t, y + h, w + t * 2, t)
	DrawImage(nil, x - t, y, t, h)
	DrawImage(nil, x + w, y, t, h)
end

function overlay.draw()
	if not overlay.items[1] then return end
	local now = GetTime()
	local keep = {}
	SetDrawLayer(950)
	SetViewport()
	for _, item in ipairs(overlay.items) do
		if now < item.untilTime then
			keep[#keep + 1] = item
			local pulse = 0.55 + 0.45 * math.abs(math.sin(now / 260))
			if item.target.draw then
				item.target.draw(pulse)
			else
				local x, y, w, h = rectOf(item.target)
				if x then
					local c = colours()
					local primary, chip = c.primary, c['surface-inner']
					rawSetDrawColor(primary[1], primary[2], primary[3], pulse)
					outline(x, y, w, h, 2)
					rawSetDrawColor(primary[1], primary[2], primary[3], 0.12 * pulse)
					DrawImage(nil, x, y, w, h)
					if item.caption then
						local text = tostring(item.caption)
						local tw = DrawStringWidth(16, 'VAR', text) + 16
						local ty = y - 28 >= 0 and y - 28 or y + h + 6
						rawSetDrawColor(primary[1], primary[2], primary[3], 1)
						DrawImage(nil, x, ty, tw, 22)
						rawSetDrawColor(chip[1], chip[2], chip[3], 1)
						DrawImage(nil, x + 1, ty + 1, tw - 2, 20)
						DrawString(x + 8, ty + 3, 'LEFT', 16, 'VAR', rgbCode(c.fg) .. text)
					end
				end
			end
		end
	end
	overlay.items = keep
	SetDrawColor(1, 1, 1, 1)
end

return overlay
