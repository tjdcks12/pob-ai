-- Modern calculation sheets. PoB still owns flags, values, controls, search, pinning and
-- tooltips. Only the sheet's metrics and paint change; the original template uses native
-- methods and floating panes keep native geometry (skin.lua themes their paint).
-- Nothing is written to a build or PoB's files.
local M = {}
local HEADER, ROW, LABEL = 28, 22, 134
local accents = setmetatable({}, { __mode = 'k' })

-- Keep PoB's category hues (offence, life, mana, evasion, etc.) in a small header rail.
-- Cache by palette and native colour, so a frame does not allocate per section.
local function categoryAccent(value, t)
	local palette = accents[t]
	if not palette then palette = {} accents[t] = palette end
	local key = value or false
	if palette[key] then return palette[key] end
	local r, g, b
	if type(value) == 'table' then
		r, g, b = value[1], value[2], value[3]
	elseif type(value) == 'string' then
		local rh, gh, bh = value:match('^%^x(%x%x)(%x%x)(%x%x)$')
		if rh then r, g, b = tonumber(rh, 16) / 255, tonumber(gh, 16) / 255, tonumber(bh, 16) / 255 end
	end
	local base = r and { r, g, b } or t['fg-3']
	local rail, header = {}, {}
	for i = 1, 3 do
		-- Pastel on dark, deeper on light; the category hue remains recognisable.
		rail[i] = t.bg[1] > .5 and base[i] * .72 or base[i] * .82 + t.fg[i] * .18
		header[i] = t.surface[i] * .93 + rail[i] * .07
	end
	palette[key] = { rail = rail, header = header }
	return palette[key]
end
M.categoryAccent = categoryAccent

function M.install(class, skin)
	if not class or class.__pobaiSheet then return end
	class.__pobaiSheet = true
	local updateSize, updatePos, draw = class.UpdateSize, class.UpdatePos, class.Draw
	local function enabled(self) return skin.on and not self.isOverlay end

	class.UpdateSize = function(self, ...)
		-- Always let PoB evaluate visibility and refresh skill selectors first.
		updateSize(self, ...)
		if self.controls.popOut then self.controls.popOut.y = enabled(self) and 6 or 3 end
		if not enabled(self) then return end
		local offset = 0
		for i, sub in ipairs(self.subSection) do
			self.controls['toggle' .. i].y = offset + 6
			sub.__pobaiY = offset
			offset = offset + HEADER
			if self.enabled and not self.subSection[1].collapsed and not sub.collapsed then
				for _, row in ipairs(sub.data) do
					if row.enabled then
						row.__pobaiY = offset
						local cellX = LABEL
						for _, cell in ipairs(row) do
							cell.yOffset, cell.height = offset, ROW
							if sub.data.colWidth then
								local span = self.widthCols or 1
								local nativeWidth = 230 * span + 8 * (span - 1)
								cell.width = sub.data.colWidth * (self.width - 136) / (nativeWidth - 136)
								cell.xOffset = cellX
								cellX = cellX + cell.width
							end
						end
						offset = offset + ROW
					end
				end
				offset = offset + 6
			elseif i == 1 then break end
		end
		self.height = offset
	end

	class.UpdatePos = function(self, ...)
		updatePos(self, ...)
		if not enabled(self) then return end
		for _, sub in ipairs(self.subSection) do
			for _, row in ipairs(sub.data) do
				if row.enabled then
					for _, cell in ipairs(row) do
						if cell.control then cell.control.y = cell.y + ROW / 2 - cell.control.height / 2 end
					end
				end
			end
		end
	end

	class.Draw = function(self, viewPort, noTooltip)
		if not enabled(self) then return draw(self, viewPort, noTooltip) end
		local t = POBAI_THEME.tokens()
		local x, y = self:GetPos()
		local width, height = self:GetSize()
		local tab = self.calcsTab
		local accent = categoryAccent(self.colour, t)
		local actor = tab.input.showMinion and tab.calcsEnv.minion or tab.calcsEnv.player
		local mx, my = GetCursorPos()
		local function rect(px, py, w, h, colour)
			POBAI_RAW.SetDrawColor(colour[1], colour[2], colour[3], 1)
			POBAI_RAW.DrawImage(nil, px, py, w, h)
		end
		local function text(px, py, align, size, font, value, colour)
			-- A leading code keeps the colour stable through the theme wrapper and still
			-- lets translate.lua translate the actual PoB label.
			local code = ('^x%02X%02X%02X'):format(
				math.floor(colour[1] * 255 + .5), math.floor(colour[2] * 255 + .5), math.floor(colour[3] * 255 + .5))
			DrawString(px, py, align, size, font, code .. value)
		end
		SetDrawLayer(nil, -10)
		skin.paint(x, y, width, height, 4, t['surface-inner'], t.line)
		for i, sub in ipairs(self.subSection) do
			local sy = y + (sub.__pobaiY or 0)
			rect(x + 1, sy + 1, width - 2, HEADER - 1, accent.header)
			if i > 1 then rect(x + 1, sy, width - 2, 1, t.line) end
			rect(x + 2, sy + 6, 3, HEADER - 12, self.enabled and accent.rail or t['fg-4'])
			local colour = not self.enabled and t['fg-3'] or tab:SearchMatch(sub.label) and t['primary-text'] or t.fg
			-- Clip long section summaries so they never paint underneath collapse/popout.
			SetViewport(x + 12, sy + 7, width - 54, HEADER - 7)
			text(0, 0, 'LEFT', 14, 'VAR BOLD', sub.label or '', colour)
			if self.enabled and sub.data.extra then
				local ex = DrawStringWidth(14, 'VAR BOLD', sub.label or '') + 8
				text(ex, 0, 'LEFT', 14, 'VAR', formatCalcStr(sub.data.extra, actor), t['fg-2'])
			end
			SetViewport()
			if sub.collapsed or not self.enabled or self.subSection[1].collapsed then
				if i == 1 then break end
			else
				local rowIndex = 0
				for _, row in ipairs(sub.data) do
					if row.enabled then
						rowIndex = rowIndex + 1
						local ry = y + row.__pobaiY
						local fill = rowIndex % 2 == 0 and t['table-alt'] or t['surface-inner']
						rect(x + 1, ry, width - 2, ROW, fill)
						-- Main/off-hand grouping stays identifiable without a saturated fill.
						if row.bgCol then
							local c = row.bgCol == colorCodes.MAINHANDBG and t.ok or t.primary
							rect(x + 2, ry + 5, 2, ROW - 10, c)
						end
						if row.label then
							local c = tab:SearchMatch(row.label) and t['primary-text'] or t['fg-2']
							local label = tab:SearchMatch(row.label) and row.label or (row.color or '') .. row.label
							text(x + LABEL - 6, ry + 4, 'RIGHT_X', row.textSize or 14, 'VAR', label, c)
						end
						for _, cell in ipairs(row) do
							if cell.format and tab:CheckFlag(cell) then
								if my >= viewPort.y and my < viewPort.y + viewPort.height
									and mx >= cell.x and mx < cell.x + cell.width and my >= cell.y and my < cell.y + cell.height then
									tab:SetDisplayStat(cell)
								end
								if tab.displayData == cell then
									rect(cell.x, cell.y, cell.width - 1, ROW, t['primary-soft'])
									rect(cell.x, cell.y + ROW - 1, cell.width - 1, 1, t.primary)
								end
								if cell.x > x + LABEL then rect(cell.x - 1, ry + 5, 1, ROW - 10, t.line) end
								local size = row.textSize or 14
								SetViewport(cell.x + 4, cell.y, cell.width - 8, ROW)
								text(0, (ROW - size) / 2, 'LEFT', size, 'VAR', formatCalcStr(cell.format, actor, cell), t.fg)
								SetViewport()
							end
						end
					end
				end
			end
		end
		SetDrawLayer(nil, 0)
		self:DrawControls(viewPort, noTooltip and tab.selControl)
	end
end

function M.installTab(class, skin)
	if not class or class.__pobaiSheetLayout then return end
	class.__pobaiSheetLayout = true
	local draw = class.Draw
	class.Draw = function(self, viewPort, ...)
		-- Use the width available to the five native column groups, up to a readable
		-- width. PoB still arranges sections and drives its own scrollbar and input.
		local columns = math.min(5, math.max(3, math.floor((viewPort.width - 24) / 238)))
		self.colWidth = skin.on and math.max(230, math.min(320, math.floor((viewPort.width - 24) / columns) - 8)) or 230
		for _, section in ipairs(self.sectionList) do
			local span = section.widthCols
			section.width = span * self.colWidth + 8 * (span - 1)
		end
		return draw(self, viewPort, ...)
	end
end

return M
