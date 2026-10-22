-- Items, slots and item sets. Mirrors the Items tab (ItemsTab.lua, ItemDBControl.lua).
return function(ops, util)
	local itemSets = dofile(POBAI_ADAPTER .. '/ops/sets.lua')(util, 'itemsTab',
		{ sets = 'itemSets', order = 'itemSetOrderList', active = 'activeItemSetId', new = 'NewItemSet', copy = 'CopyItemSet',
			delete = 'DeleteItemSet', select = 'SetActiveItemSet', undo = true }, 'item set')

	local function lines(list)
		local out, unsupported = {}, {}
		for _, modLine in ipairs(list or {}) do
			if modLine.line then
				out[#out + 1] = modLine.line
				if modLine.extra then unsupported[#unsupported + 1] = modLine.line end
			end
		end
		return out, unsupported
	end

	local function equippedIn(tab, item)
		local slots = {}
		for name, slot in pairs(tab.slots) do
			if slot.selItemId == item.id then slots[#slots + 1] = name end
		end
		table.sort(slots)
		return slots
	end

	local function itemInfo(tab, item, full)
		local implicits, u1 = lines(item.implicitModLines)
		local explicits, u2 = lines(item.explicitModLines)
		local unsupported = {}
		for _, l in ipairs(u1) do unsupported[#unsupported + 1] = l end
		for _, l in ipairs(u2) do unsupported[#unsupported + 1] = l end
		local out = {
			id = item.id, name = item.title or item.name, base = item.baseName, rarity = item.rarity, type = item.type,
			quality = item.quality, itemLevel = item.itemLevel, corrupted = item.corrupted or nil, equippedIn = equippedIn(tab, item),
			implicits = implicits, explicits = explicits, unsupported = #unsupported > 0 and unsupported or nil,
		}
		if full then
			out.enchants = (lines(item.enchantModLines))
			out.runes = (lines(item.runeModLines))
			out.text = item:BuildRaw()
			out.primarySlot = item:GetPrimarySlot()
		end
		return out
	end

	local function slotNames(tab)
		local names = {}
		for _, slot in ipairs(tab.orderedSlots) do
			-- Item jewel sockets only matter once something is socketed or the item has sockets.
			local socket = slot.slotName:match('^(.-) Jewel Socket (%d+)$')
			local relevant = not socket or slot.selItemId ~= 0
			if socket and not relevant then
				local parent = tab.slots[socket]
				local item = parent and tab.items[parent.selItemId]
				relevant = item and (item.jewelSocketCount or 0) >= tonumber(slot.slotName:match('(%d+)$'))
			end
			if not slot.nodeId and relevant then names[#names + 1] = slot.slotName end
		end
		return names
	end

	local function findSlot(tab, query)
		local names = {}
		for name in pairs(tab.slots) do names[#names + 1] = name end
		table.sort(names)
		local name = util.pick(names, query, function(n) return n end, nil, 'item slot')
		return tab.slots[name], name
	end

	local function findItem(tab, query)
		local id = tonumber(query)
		if id and tab.items[id] then return tab.items[id] end
		local slot = tab.slots[query]
		if not slot then
			for name, s in pairs(tab.slots) do if util.lower(name) == util.lower(query) then slot = s end end
		end
		if slot and slot.selItemId ~= 0 and tab.items[slot.selItemId] then return tab.items[slot.selItemId] end
		local list = {}
		for _, itemId in ipairs(tab.itemOrderList) do list[#list + 1] = tab.items[itemId] end
		return util.pick(list, query, function(i) return i.title or i.name or i.baseName end, function(i) return i.id end, 'item')
	end

	local function equip(build, item, slotQuery)
		local tab = build.itemsTab
		local slot, name = findSlot(tab, slotQuery)
		if slot.weaponSet == 1 and tab.activeItemSet.useSecondWeaponSet and not name:find('Swap') and tab.slots[name .. ' Swap'] then
			slot, name = tab.slots[name .. ' Swap'], name .. ' Swap'
		end
		util.check(tab:IsItemValidForSlot(item, name), 'WRONG_SLOT', ('%s cannot go in %s.'):format(item.title or item.name or item.baseName, name))
		slot:SetSelItemId(item.id)
		return name
	end

	local function finish(build)
		local tab = build.itemsTab
		tab:PopulateSlots()
		util.changed(build, tab)
	end

	local function parse(text)
		local ok, item = pcall(util.new, 'Item', text)
		util.check(ok and item and item.base, 'BAD_ITEM', 'PoB does not recognise this item. Check the base type line (English item text is required).')
		if item.NormaliseQuality then item:NormaliseQuality() end
		return item
	end

	local function addItem(build, item, equipSlot)
		local tab = build.itemsTab
		tab:AddItem(item, true)
		local slot
		if equipSlot then
			local ok, err = pcall(equip, build, item, equipSlot)
			if not ok then
				tab.items[item.id] = nil
				for i, id in ipairs(tab.itemOrderList) do if id == item.id then table.remove(tab.itemOrderList, i) break end end
				error(err, 0)
			end
			slot = err
		end
		finish(build)
		local result = itemInfo(tab, item, false)
		result.equippedIn = slot and { slot } or result.equippedIn
		result.suggestedSlot = not slot and item:GetPrimarySlot() or nil
		return result
	end

	ops['items.list'] = function()
		local build = util.build()
		local tab = build.itemsTab
		local equipped = {}
		for _, name in ipairs(slotNames(tab)) do
			local slot = tab.slots[name]
			local item = tab.items[slot.selItemId]
			local entry = { slot = name, item = item and (item.title or item.name) or nil, itemId = item and item.id or nil, base = item and item.baseName or nil, rarity = item and item.rarity or nil }
			if slot.controls and slot.controls.activate then entry.active = slot.active or false end
			equipped[#equipped + 1] = entry
		end
		local jewels = {}
		for nodeId, itemId in pairs(build.spec.jewels or {}) do
			local item = tab.items[itemId]
			if item then jewels[#jewels + 1] = { node = nodeId, item = item.title or item.name, itemId = itemId } end
		end
		local all = {}
		for _, id in ipairs(tab.itemOrderList) do
			local item = tab.items[id]
			if item then all[#all + 1] = { id = id, name = item.title or item.name, base = item.baseName, rarity = item.rarity, equippedIn = equippedIn(tab, item) } end
		end
		local set = tab.activeItemSet
		return { itemSet = set and set.title or 'Default', weaponSet = set and set.useSecondWeaponSet and 2 or 1, equipped = equipped, treeJewels = jewels, items = all }
	end

	ops['items.show'] = function(args)
		local build = util.build()
		return itemInfo(build.itemsTab, findItem(build.itemsTab, args.item), true)
	end

	ops['items.slots'] = function()
		local build = util.build()
		return { slots = slotNames(build.itemsTab) }
	end

	ops['items.add'] = function(args)
		local build = util.build()
		return addItem(build, parse(args.text), args.equip)
	end

	local function loadUniques()
		local main = POBAI_MAIN
		local guard = 0
		while main.uniqueDB and main.uniqueDB.loading and guard < 2000 do
			util.waitFrame()
			guard = guard + 1
		end
		return util.check(main.uniqueDB and main.uniqueDB.list, 'NOT_READY', 'PoB has not finished loading its unique list.')
	end

	ops['items.uniques'] = function(args)
		util.build()
		local list = loadUniques()
		local hits = {}
		local match = util.matchSet(args.match)
		for name, item in pairs(list) do
			local text = name .. ' ' .. (item.baseName or '') .. ' ' .. table.concat((lines(item.explicitModLines)), ' ')
			if (match and match[name:match('^(.-), ') or name]) or (not match and util.contains(text, args.text)) then
				hits[#hits + 1] = { name = name, base = item.baseName, type = item.type, variants = item.variantList and #item.variantList or nil, nameMatch = util.contains(name, args.text) }
			end
		end
		table.sort(hits, function(a, b)
			if a.nameMatch ~= b.nameMatch then return a.nameMatch end
			return a.name < b.name
		end)
		local page, total = util.take(hits, args.limit or 20)
		for _, h in ipairs(page) do h.nameMatch = nil end
		return { total = total, uniques = page }
	end

	ops['items.add_unique'] = function(args)
		local build = util.build()
		local list = loadUniques()
		local names = {}
		for name in pairs(list) do names[#names + 1] = name end
		table.sort(names)
		local name = util.pick(names, args.name, function(n) return n end, nil, 'unique item')
		local item = parse(list[name].raw)
		if args.variant then
			util.check(item.variantList and item.variantList[args.variant], 'NOT_FOUND', ('%s has %d variants.'):format(name, item.variantList and #item.variantList or 0))
			item.variant = args.variant
			item:BuildAndParseRaw()
		end
		local slot = args.equip
		if slot == nil then slot = item:GetPrimarySlot() end
		local result = addItem(build, item, slot)
		if item.variantList then
			result.variants = item.variantList
			result.variant = item.variant
		end
		return result
	end

	ops['items.craft'] = function(args)
		local build = util.build()
		local base = build.data.itemBases[args.base]
		if not base then
			local names = {}
			for n in pairs(build.data.itemBases) do names[#names + 1] = n end
			table.sort(names)
			args.base = util.pick(names, args.base, function(n) return n end, nil, 'base type')
		end
		local rarity = args.rarity or 'RARE'
		local text = { 'Rarity: ' .. rarity }
		if rarity == 'RARE' or rarity == 'UNIQUE' then text[#text + 1] = args.name or 'Crafted Item' end
		text[#text + 1] = args.base
		if args.quality then text[#text + 1] = 'Quality: +' .. args.quality .. '%' end
		local implicits = args.implicit or {}
		text[#text + 1] = 'Implicits: ' .. #implicits
		for _, l in ipairs(implicits) do text[#text + 1] = l end
		for _, l in ipairs(args.mod or {}) do text[#text + 1] = l end
		local item = parse(table.concat(text, '\n'))
		local result = addItem(build, item, args.equip)
		if result.unsupported then result.warning = 'PoB does not understand these lines; they have no effect on calculations.' end
		return result
	end

	ops['items.equip'] = function(args)
		local build = util.build()
		local item = findItem(build.itemsTab, args.item)
		local slot = equip(build, item, args.slot)
		finish(build)
		return { item = item.title or item.name, slot = slot }
	end

	ops['items.unequip'] = function(args)
		local build = util.build()
		local slot, name = findSlot(build.itemsTab, args.slot)
		local itemId = slot.selItemId
		slot:SetSelItemId(0)
		finish(build)
		local item = build.itemsTab.items[itemId]
		return { slot = name, removed = item and (item.title or item.name) or nil }
	end

	ops['items.remove'] = function(args)
		local build = util.build()
		local tab = build.itemsTab
		local item = findItem(tab, args.item)
		local name = item.title or item.name
		tab:DeleteItem(item, true)
		finish(build)
		return { removed = name }
	end

	ops['items.toggle'] = function(args)
		local build = util.build()
		local tab = build.itemsTab
		local slot, name = findSlot(tab, args.slot)
		util.check(slot.controls and slot.controls.activate, 'NOT_TOGGLE', name .. ' is not a flask or charm slot.')
		slot.active = args.active
		slot.controls.activate.state = args.active
		tab.activeItemSet[name].active = args.active
		util.changed(build, tab)
		return { slot = name, active = args.active }
	end

	ops['items.bases'] = function(args)
		local build = util.build()
		local hits = {}
		local match = util.matchSet(args.match)
		for name, base in pairs(build.data.itemBases) do
			local text = name .. ' ' .. (base.type or '') .. ' ' .. (base.subType or '')
			if (match and match[name]) or (not match and util.contains(text, args.text)) then
				hits[#hits + 1] = { name = name, type = base.type, subType = base.subType, level = base.req and base.req.level or nil, implicit = base.implicit }
			end
		end
		table.sort(hits, function(a, b) return a.name < b.name end)
		local page, total = util.take(hits, args.limit or 20)
		return { total = total, bases = page }
	end

	ops['items.weapon_set'] = function(args)
		local build = util.build()
		local tab = build.itemsTab
		tab.activeItemSet.useSecondWeaponSet = args.set == 2
		util.changed(build, tab)
		return { weaponSet = args.set }
	end

	ops['items.sets'] = function() return { sets = itemSets.list() } end
	ops['items.set_select'] = function(args) return itemSets.select(args.set) end
	ops['items.set_new'] = function(args) return itemSets.create(args.name, args.copy) end
	ops['items.set_delete'] = function(args) return itemSets.delete(args.set) end

	-- ---- editing an existing item (keeps its id, so slots that hold it keep it) ----
	local function replaceItem(build, old, text)
		local tab = build.itemsTab
		local item = parse(text)
		item.id = old.id
		tab:AddItem(item, true)
		finish(build)
		return itemInfo(tab, item, true)
	end

	local function rawLines(item)
		local lines = {}
		for line in (item:BuildRaw() .. '\n'):gmatch('([^\n]*)\n') do lines[#lines + 1] = line end
		return lines
	end

	--- Position after the item's property and requirement header, where modifier lines start.
	local function modStart(lines)
		for i, line in ipairs(lines) do
			if line:match('^Implicits: %d+') then return i + 1 + tonumber(line:match('%d+')) end
		end
		return #lines + 1
	end

	ops['items.edit'] = function(args)
		local build = util.build()
		return replaceItem(build, findItem(build.itemsTab, args.item), args.text)
	end

	ops['items.mod_add'] = function(args)
		local build = util.build()
		local item = findItem(build.itemsTab, args.item)
		local lines = rawLines(item)
		local kind = args.kind or 'explicit'
		if kind == 'implicit' then
			for i, line in ipairs(lines) do
				local n = line:match('^Implicits: (%d+)')
				if n then
					lines[i] = 'Implicits: ' .. (tonumber(n) + 1)
					table.insert(lines, i + 1 + tonumber(n), args.line)
					break
				end
			end
		else
			local prefix = ({ explicit = '', crafted = '{crafted}', enchant = '{enchant}', rune = '{rune}', fractured = '{fractured}', desecrated = '{desecrated}' })[kind] or ''
			-- Enchants and runes sit with the implicits in PoB's text; explicit lines go at the end.
			table.insert(lines, (kind == 'enchant' or kind == 'rune') and modStart(lines) or #lines + 1, prefix .. args.line)
		end
		local result = replaceItem(build, item, table.concat(lines, '\n'))
		if result.unsupported then result.warning = 'PoB does not understand some lines; they have no effect on calculations.' end
		return result
	end

	ops['items.mod_remove'] = function(args)
		local build = util.build()
		local item = findItem(build.itemsTab, args.item)
		local lines = rawLines(item)
		local start = modStart(lines)
		local implicitIndex
		for i, line in ipairs(lines) do if line:match('^Implicits: %d+') then implicitIndex = i end end
		local candidates = {}
		for i = (implicitIndex or start - 1) + 1, #lines do
			local text = lines[i]:gsub('^{[^}]*}', ''):gsub('^{[^}]*}', '')
			if text ~= '' and text ~= 'Corrupted' then candidates[#candidates + 1] = { index = i, text = text } end
		end
		local hit = util.pick(candidates, args.line, function(c) return c.text end, nil, 'modifier line on ' .. (item.title or item.name))
		table.remove(lines, hit.index)
		if implicitIndex and hit.index < start then
			lines[implicitIndex] = 'Implicits: ' .. (tonumber(lines[implicitIndex]:match('%d+')) - 1)
		end
		return replaceItem(build, item, table.concat(lines, '\n'))
	end

	ops['items.anoint'] = function(args)
		local build = util.build()
		local item = findItem(build.itemsTab, args.item)
		local node = ops.findNode(build.spec, args.notable, 'read')
		util.check(node.type == 'Notable', 'NOT_NOTABLE', node.dn .. ' is not a notable passive.')
		local lines = rawLines(item)
		for i = #lines, 1, -1 do
			if lines[i]:match('^{enchant}.*Allocates ') then table.remove(lines, i) end
		end
		table.insert(lines, modStart(lines), '{enchant}Allocates ' .. node.dn)
		return replaceItem(build, item, table.concat(lines, '\n'))
	end

	ops['items.corrupt'] = function(args)
		local build = util.build()
		local item = findItem(build.itemsTab, args.item)
		local lines = rawLines(item)
		local corrupted = false
		for _, line in ipairs(lines) do if line == 'Corrupted' then corrupted = true end end
		for _, implicit in ipairs(args.implicit or {}) do
			for i, line in ipairs(lines) do
				local n = line:match('^Implicits: (%d+)')
				if n then
					lines[i] = 'Implicits: ' .. (tonumber(n) + 1)
					table.insert(lines, i + 1 + tonumber(n), implicit)
					break
				end
			end
		end
		if not corrupted then lines[#lines + 1] = 'Corrupted' end
		return replaceItem(build, item, table.concat(lines, '\n'))
	end

	ops['items.runes'] = function(args)
		util.build()
		local hits = {}
		local match = util.matchSet(args.match)
		for name, rune in pairs(data.itemMods.Runes or {}) do
			local text = name
			for _, mod in pairs(type(rune) == 'table' and rune or {}) do
				if type(mod) == 'table' and mod[1] then text = text .. ' ' .. tostring(mod[1]) end
			end
			if (match and match[name]) or (not match and util.contains(text, args.search)) then hits[#hits + 1] = name end
		end
		table.sort(hits)
		local page, total = util.take(hits, args.limit or 30)
		return { total = total, runes = page }
	end

	ops['items.set_rune'] = function(args)
		local build = util.build()
		local item = findItem(build.itemsTab, args.item)
		local lines = rawLines(item)
		local runeLines = {}
		for i, line in ipairs(lines) do if line:match('^Rune: ') then runeLines[#runeLines + 1] = i end end
		util.check(#runeLines > 0, 'NO_SOCKETS', (item.title or item.name) .. ' has no rune sockets.')
		util.check(runeLines[args.socket], 'NOT_FOUND', ('%s has %d sockets.'):format(item.title or item.name, #runeLines))
		local name = 'None'
		if util.lower(args.rune) ~= 'none' then
			local names = {}
			for n in pairs(data.itemMods.Runes or {}) do names[#names + 1] = n end
			table.sort(names)
			name = util.pick(names, args.rune, function(n) return n end, nil, 'rune')
		end
		lines[runeLines[args.socket]] = 'Rune: ' .. name
		-- Rune modifier lines are rebuilt from the socketed runes.
		for i = #lines, 1, -1 do if lines[i]:match('^{rune}') then table.remove(lines, i) end end
		local result = replaceItem(build, item, table.concat(lines, '\n'))
		local saved = build.itemsTab.items[item.id]
		if saved.UpdateRunes then saved:UpdateRunes() saved:BuildModList() util.changed(build, build.itemsTab) end
		return result
	end

	--- Trade site search for items like this one (PoB's "Buy similar" query with every modifier).
	ops['items.trade_query'] = function(args)
		local build = util.build()
		local tab = build.itemsTab
		local item = findItem(tab, args.item)
		local ok, similar = pcall(LoadModule, 'Classes/CompareBuySimilar')
		util.check(ok and similar and similar.addModEntries, 'NOT_AVAILABLE', 'This PoB version cannot build trade searches.')
		local helpers = LoadModule('Classes/TradeHelpers')
		local unique = item.rarity == 'UNIQUE' or item.rarity == 'RELIC'
		local entries = similar.addModEntries(item, {
			{ list = item.enchantModLines, type = 'enchant' }, { list = item.implicitModLines, type = 'implicit' }, { list = item.explicitModLines, type = 'explicit' } })
		local query = { status = { option = args.status or 'available' }, stats = { { type = 'and', filters = {} } } }
		local filters = {}
		if unique then
			query.name = (item.title or item.name):gsub('^Foulborn%s+', '')
			query.type = item.baseName
		else
			local slot = equippedIn(tab, item)[1] or item:GetPrimarySlot()
			local category = helpers.getTradeCategory and helpers.getTradeCategory(slot, item)
			if category then filters.type_filters = { filters = { category = { option = category } } } end
			if args.base then query.type = item.baseName end
		end
		local used, skipped = {}, {}
		local scale = (args.minPercent or 90) / 100
		for _, entry in ipairs(entries) do
			if not unique and #entry.tradeIds >= 1 then
				local function filterFor(id)
					local filter = { id = id }
					if entry.isOption then filter.value = { min = entry.value, max = entry.value }
					elseif entry.value then
						local v = entry.value * scale
						if entry.invert then filter.value = { max = -math.floor(v) } else filter.value = { min = math.floor(v * 100 + 0.5) / 100 } end
					end
					return filter
				end
				if #entry.tradeIds == 1 then
					table.insert(query.stats[1].filters, filterFor(entry.tradeIds[1]))
				else
					local count = { type = 'count', value = { min = 1 }, filters = {} }
					for _, id in ipairs(entry.tradeIds) do table.insert(count.filters, filterFor(id)) end
					table.insert(query.stats, count)
				end
				used[#used + 1] = table.concat(entry.formattedLines or {}, ' / ')
			elseif #entry.tradeIds == 0 then
				skipped[#skipped + 1] = table.concat(entry.formattedLines or {}, ' / ')
			end
		end
		if next(filters) then query.filters = filters end
		return { item = item.title or item.name, query = { query = query, sort = { price = 'asc' } }, modifiers = used,
			notSearchable = #skipped > 0 and skipped or nil }
	end

	ops.itemInfo = itemInfo
	ops.parseItem = parse
end
