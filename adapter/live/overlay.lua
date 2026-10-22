-- Highlights the agent points at: a pulsing outline around a rectangle or control, with an
-- optional caption. Drawn after PoB's own frame so it stays on top.
local overlay = { items = {} }

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
					SetDrawColor(1, 0.78, 0.2, pulse)
					outline(x, y, w, h, 3)
					SetDrawColor(1, 0.78, 0.2, 0.12 * pulse)
					DrawImage(nil, x, y, w, h)
					if item.caption then
						local text = tostring(item.caption)
						local tw = DrawStringWidth(16, 'VAR', text) + 16
						local ty = y - 28 >= 0 and y - 28 or y + h + 6
						SetDrawColor(0.08, 0.08, 0.1, 0.92)
						DrawImage(nil, x, ty, tw, 22)
						SetDrawColor(1, 0.85, 0.35, 1)
						DrawString(x + 8, ty + 3, 'LEFT', 16, 'VAR', text)
					end
				end
			end
		end
	end
	overlay.items = keep
	SetDrawColor(1, 1, 1, 1)
end

return overlay
