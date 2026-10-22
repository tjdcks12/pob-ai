-- PoB window navigation and highlights for the agent ("show me where …"). Live window only.
return function(ops, util)
	local TABS = { tree = 'TREE', skills = 'SKILLS', items = 'ITEMS', calcs = 'CALCS', config = 'CONFIG', notes = 'NOTES', import = 'IMPORT', party = 'PARTY', compare = 'COMPARE' }

	local function live()
		util.check(POBAI_MODE == 'live', 'LIVE_REQUIRED', 'This needs the PoB window. Open it with `pob open`.')
		util.check(not (POBAI_MAIN.popups and POBAI_MAIN.popups[1]), 'POPUP_OPEN', 'A dialog is open in PoB. Close it first.')
		return util.build()
	end

	-- The overlay draws with PoB's bitmap fonts, which have ASCII glyphs only.
	local function caption(text)
		if not text or text == '' then return nil end
		local ascii = tostring(text):gsub('[\128-\255]+', ''):gsub('%s+', ' ')
		return ascii:match('%S') and ascii or nil
	end

	local function openTab(build, tab)
		local mode = util.check(TABS[tab], 'BAD_ARGS', 'Unknown tab ' .. tostring(tab))
		if build.viewMode ~= mode then
			if mode == 'IMPORT' and build.importTab and build.importTab.RefreshAuthStatus then pcall(build.importTab.RefreshAuthStatus, build.importTab) end
			build.viewMode = mode
			util.waitFrame(2)
		end
		return mode
	end

	local function tabButton(build, mode)
		return build.controls['mode' .. mode:sub(1, 1) .. mode:sub(2):lower()]
	end

	ops['ui.state'] = function()
		local build = live()
		local tab = ({ TREE = build.treeTab, SKILLS = build.skillsTab, ITEMS = build.itemsTab, CALCS = build.calcsTab, CONFIG = build.configTab,
			NOTES = build.notesTab, IMPORT = build.importTab, PARTY = build.partyTab, COMPARE = build.compareTab })[build.viewMode]
		local controls = {}
		for name, control in pairs(tab and tab.controls or {}) do
			local ok, shown = pcall(function() return not control.IsShown or control:IsShown() end)
			if ok and shown then controls[#controls + 1] = name end
		end
		table.sort(controls)
		return { tab = build.viewMode, build = build.buildName, unsaved = build.unsaved or false, controls = controls,
			selectedGroup = build.skillsTab.displayGroup and build.skillsTab.displayGroup.displayLabel or nil }
	end

	ops['ui.tab'] = function(args)
		local build = live()
		local mode = openTab(build, args.tab)
		local button = tabButton(build, mode)
		if button then POBAI_OVERLAY.show({ control = button }, caption(args.caption), 6) end
		return { tab = mode }
	end

	ops['ui.clear'] = function()
		live()
		POBAI_OVERLAY.clear()
		return { cleared = true }
	end

	-- ---- passive tree ----
	local function captureViewport(viewer)
		if viewer.__pobai then return end
		viewer.__pobai = true
		local draw = viewer.Draw
		viewer.Draw = function(self, build, viewPort, ...)
			self.__pobaiViewport = viewPort
			return draw(self, build, viewPort, ...)
		end
	end

	ops['ui.show_node'] = function(args)
		local build = live()
		local node = ops.findNode(build.spec, args.node, 'read')
		openTab(build, 'tree')
		local viewer = build.treeTab.viewer
		captureViewport(viewer)
		util.waitFrame()
		local vp = util.check(viewer.__pobaiViewport, 'NOT_READY', 'The passive tree is not drawn yet; try again.')
		-- Centre on the node at a readable zoom (PoB's own jump uses the maximum zoom).
		viewer.zoomLevel = 11
		viewer.zoom = 1.2 ^ viewer.zoomLevel
		local scale = math.min(vp.width, vp.height) / build.spec.tree.size * viewer.zoom
		viewer.zoomX = -node.x * scale
		viewer.zoomY = -node.y * scale
		local label = caption(args.caption) or caption(node.dn)
		POBAI_OVERLAY.show({ draw = function(pulse)
			local view = viewer.__pobaiViewport
			if not view or build.viewMode ~= 'TREE' then return end
			local s = math.min(view.width, view.height) / build.spec.tree.size * viewer.zoom
			local x = node.x * s + viewer.zoomX + view.x + view.width / 2
			local y = node.y * s + viewer.zoomY + view.y + view.height / 2
			local r = math.max(16, (node.type == 'Keystone' and 85 or node.type == 'Notable' and 65 or 45) * s)
			SetDrawColor(1, 0.78, 0.2, pulse)
			local t = 3
			DrawImage(nil, x - r - t, y - r - t, 2 * r + 2 * t, t)
			DrawImage(nil, x - r - t, y + r, 2 * r + 2 * t, t)
			DrawImage(nil, x - r - t, y - r, t, 2 * r)
			DrawImage(nil, x + r, y - r, t, 2 * r)
			if label then
				local w = DrawStringWidth(16, 'VAR', label) + 16
				SetDrawColor(0.08, 0.08, 0.1, 0.92)
				DrawImage(nil, x - w / 2, y - r - 32, w, 22)
				SetDrawColor(1, 0.85, 0.35, 1)
				DrawString(x - w / 2 + 8, y - r - 29, 'LEFT', 16, 'VAR', label)
			end
		end }, nil, 10)
		return { tab = 'TREE', node = ops.nodeInfo(node) }
	end

	-- ---- items ----
	ops['ui.show_slot'] = function(args)
		local build = live()
		local tab = build.itemsTab
		local names = {}
		for name in pairs(tab.slots) do names[#names + 1] = name end
		table.sort(names)
		local name = util.pick(names, args.slot, function(n) return n end, nil, 'item slot')
		openTab(build, 'items')
		local slot = tab.slots[name]
		POBAI_OVERLAY.show({ control = slot }, caption(args.caption) or name, 8)
		local item = tab.items[slot.selItemId]
		return { tab = 'ITEMS', slot = name, item = item and (item.title or item.name) or nil }
	end

	-- ---- skills ----
	ops['ui.show_gem'] = function(args)
		local build = live()
		local tab = build.skillsTab
		local group = util.check(tab.socketGroupList[args.group], 'NOT_FOUND', 'There is no skill group ' .. args.group .. '.')
		openTab(build, 'skills')
		tab:SetDisplayGroup(group)
		local list = tab.controls.groupList
		if list then list.selIndex = args.group list.selValue = group end
		util.waitFrame()
		local target = { control = list }
		if args.index then
			local slot = util.check(tab.gemSlots and tab.gemSlots[args.index], 'NOT_FOUND', 'Group ' .. args.group .. ' has no gem ' .. args.index .. '.')
			target = { control = slot.nameSpec }
		end
		POBAI_OVERLAY.show(target, caption(args.caption) or caption(group.displayLabel), 8)
		return { tab = 'SKILLS', group = args.group, label = group.displayLabel }
	end

	-- ---- configuration ----
	ops['ui.show_config'] = function(args)
		local build = live()
		local tab = build.configTab
		local _, byKey = ops.configOptions()
		local option = util.check(byKey[args.key], 'NOT_FOUND', ('Unknown option "%s".'):format(tostring(args.key)))
		openTab(build, 'config')
		for _, section in ipairs(tab.sectionList or {}) do
			for _, control in ipairs(section.varControlList or {}) do
				if control == tab.varControls[args.key] then section.collapsed = false end
			end
		end
		util.waitFrame()
		local control = util.check(tab.varControls[args.key], 'NOT_FOUND', 'PoB has no control for ' .. args.key .. '.')
		util.check(not control.IsShown or control:IsShown(), 'NOT_SHOWN', 'PoB hides this option for the current build (it does not apply).')
		local _, y = control:GetPos()
		local _, h = control:GetSize()
		local _, screenH = GetVirtualScreenSize()
		local bar = tab.controls.scrollBar
		if bar and (y < 120 or y + h > screenH - 40) then
			bar:SetOffset(bar.offset + y - math.floor(screenH / 3))
			util.waitFrame()
		end
		local cx, cy = control:GetPos()
		local cw, ch = control:GetSize()
		local left = math.max(cx - 300, (tab.x or 0) + 4)
		POBAI_OVERLAY.show({ rect = { left, cy - 2, cx + cw - left + 2, ch + 4 } }, caption(args.caption) or caption(option.label:gsub('%^x%x%x%x%x%x%x', ''):gsub('%^%d', '')), 8)
		return { tab = 'CONFIG', key = args.key, value = tab.input[args.key] }
	end

	-- ---- stats ----
	ops['ui.show_stat'] = function(args)
		local build = live()
		openTab(build, 'calcs')
		local search = build.calcsTab.controls.search
		util.check(search, 'NOT_AVAILABLE', 'This PoB version has no Calcs search box.')
		-- PoB's own Calcs search highlights every row whose label matches.
		local text = args.stat
		local labels = { FullDPS = 'Full DPS', CombinedDPS = 'Combined DPS', TotalDPS = 'Total DPS', TotalEHP = 'Effective Hit Pool', AverageHit = 'Average Hit',
			CritChance = 'Crit Chance', EnergyShield = 'Energy Shield', MovementSpeed = 'Movement Speed' }
		text = labels[text] or text
		search:SetText(text, true)
		util.waitFrame()
		POBAI_OVERLAY.show({ control = search }, caption(args.caption) or 'Matching rows are highlighted', 8)
		return { tab = 'CALCS', search = text }
	end

	ops['ui.show_control'] = function(args)
		local build = live()
		local tab = ({ TREE = build.treeTab, SKILLS = build.skillsTab, ITEMS = build.itemsTab, CALCS = build.calcsTab, CONFIG = build.configTab,
			NOTES = build.notesTab, IMPORT = build.importTab, PARTY = build.partyTab, COMPARE = build.compareTab })[build.viewMode]
		local control = (tab and tab.controls and tab.controls[args.control]) or build.controls[args.control]
		util.check(control, 'NOT_FOUND', 'No control named ' .. args.control .. ' on this tab. See `pob ui state`.')
		POBAI_OVERLAY.show({ control = control }, caption(args.caption), 8)
		return { tab = build.viewMode, control = args.control }
	end

	ops['ui.theme'] = function(args)
		live()
		POBAI_THEME.apply(args.theme)
		return { theme = args.theme }
	end
end
