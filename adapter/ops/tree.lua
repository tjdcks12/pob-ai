-- Passive tree operations. They follow what PoB's tree view does on a click
-- (PassiveTreeView/TreeTab), including undo and recalculation.
return function(ops, util)
	local HIDDEN = { OnlyImage = true, ClassStart = true, AscendClassStart = true }
	local ATTRIBUTES = { str = 1, dex = 2, int = 3 }

	local function kind(node)
		if node.ascendancyName then return 'ascendancy' end
		if node.type == 'Keystone' then return 'keystone' end
		if node.type == 'Notable' then return 'notable' end
		if node.type == 'Socket' then return 'socket' end
		if node.isAttribute then return 'attribute' end
		return 'normal'
	end

	local function distance(node)
		if node.alloc then return 0 end
		if node.path then return #node.path end
		return nil
	end

	local function info(node, withPath)
		local out = {
			id = node.id, name = node.dn or node.name, type = kind(node), stats = node.sd,
			allocated = node.alloc or false, distance = distance(node), ascendancy = node.ascendancyName,
			weaponSet = (node.alloc and node.allocMode and node.allocMode > 0) and node.allocMode or nil,
		}
		if withPath and node.path and not node.alloc then
			local path = {}
			for i = #node.path, 1, -1 do
				local step = node.path[i]
				path[#path + 1] = { id = step.id, name = step.dn, type = kind(step) }
			end
			out.path = path
		end
		return out
	end
	ops.nodeInfo = info

	local function candidates(spec, query)
		local id = tonumber(query)
		if id and spec.nodes[id] then return { spec.nodes[id] } end
		local exact, partial = {}, {}
		local wanted = util.lower(query)
		for _, node in pairs(spec.nodes) do
			if not HIDDEN[node.type] and node.dn then
				local name = util.lower(node.dn)
				if name == wanted then exact[#exact + 1] = node
				elseif name:find(wanted, 1, true) then partial[#partial + 1] = node end
			end
		end
		return #exact > 0 and exact or partial
	end

	--- Resolves a node name. Several nodes can share a name (small attribute nodes); then the
	--- one the action applies to is chosen: nearest unallocated to allocate, an allocated one to remove.
	function ops.findNode(spec, query, purpose)
		local list = candidates(spec, query)
		if #list == 0 then util.fail('NOT_FOUND', ('No passive node matches "%s". Try `pob tree search`.'):format(tostring(query))) end
		if #list == 1 then return list[1] end
		local sameName = true
		for _, node in ipairs(list) do if node.dn ~= list[1].dn then sameName = false end end
		if sameName then
			local best
			for _, node in ipairs(list) do
				if purpose == 'remove' then
					if node.alloc then best = best or node end
				elseif not node.alloc and node.path then
					if not best or #node.path < #best.path then best = node end
				end
			end
			if best then return best end
			if purpose ~= 'remove' then
				for _, node in ipairs(list) do if node.alloc then return node end end
			end
			return list[1]
		end
		local names = {}
		for i = 1, math.min(#list, 15) do names[i] = ('%s (%d)'):format(list[i].dn, list[i].id) end
		util.fail('AMBIGUOUS', ('"%s" matches %d nodes. Use the full name or the id.'):format(tostring(query), #list), { candidates = names })
	end

	local function allocatedSet(spec)
		local set, count = {}, 0
		for id in pairs(spec.allocNodes) do set[id] = true count = count + 1 end
		return set, count
	end

	ops['tree.summary'] = function()
		local build = util.build()
		local spec = build.spec
		local used, ascUsed, _, sockets, weapon1, weapon2 = spec:CountAllocNodes()
		local keystones, notables, ascendancy, jewels, attributes = {}, {}, {}, {}, { str = 0, dex = 0, int = 0 }
		for id, node in pairs(spec.allocNodes) do
			local k = kind(node)
			if k == 'keystone' then keystones[#keystones + 1] = node.dn
			elseif k == 'ascendancy' and node.type ~= 'AscendClassStart' then ascendancy[#ascendancy + 1] = node.dn
			elseif k == 'notable' then notables[#notables + 1] = node.dn
			elseif k == 'socket' then
				local itemId = spec.jewels[id]
				local item = itemId and build.itemsTab.items[itemId]
				jewels[#jewels + 1] = { node = id, jewel = item and (item.name or item.baseName) or nil }
			end
			if node.isAttribute then
				local sd = table.concat(node.sd or {}, ' ')
				if sd:find('Strength') then attributes.str = attributes.str + 1
				elseif sd:find('Dexterity') then attributes.dex = attributes.dex + 1
				elseif sd:find('Intelligence') then attributes.int = attributes.int + 1 end
			end
		end
		table.sort(keystones) table.sort(notables) table.sort(ascendancy)
		return {
			set = spec.title or 'Default', treeVersion = spec.treeVersion,
			class = spec.curClassName, ascendancy = spec.curAscendClassName ~= 'None' and spec.curAscendClassName or nil,
			points = { used = used, ascendancy = ascUsed, weaponSet1 = weapon1, weaponSet2 = weapon2, jewelSockets = sockets },
			keystones = keystones, notables = notables, ascendancyNodes = ascendancy, jewelSockets = jewels, attributeChoices = attributes,
		}
	end

	ops['tree.search'] = function(args)
		local spec = util.build().spec
		local hits = {}
		for _, node in pairs(spec.nodes) do
			if not HIDDEN[node.type] and node.dn then
				local k = kind(node)
				local text = node.dn .. '\n' .. table.concat(node.sd or {}, '\n')
				if util.contains(text, args.text)
					and (not args.type or args.type == k)
					and (args.allocated == nil or (node.alloc or false) == args.allocated) then
					hits[#hits + 1] = node
				end
			end
		end
		local rank = { keystone = 0, notable = 1, ascendancy = 2, socket = 3, attribute = 4, normal = 5 }
		table.sort(hits, function(a, b)
			local da, db = distance(a) or 999, distance(b) or 999
			if da ~= db then return da < db end
			local ra, rb = rank[kind(a)], rank[kind(b)]
			if ra ~= rb then return ra < rb end
			return a.id < b.id
		end)
		local page, total = util.take(hits, args.limit or 25)
		local out = {}
		for i, node in ipairs(page) do out[i] = info(node) end
		return { total = total, nodes = out }
	end

	ops['tree.node'] = function(args)
		local spec = util.build().spec
		return info(ops.findNode(spec, args.node, 'read'), true)
	end

	ops['tree.allocate'] = function(args)
		local build = util.build()
		local spec = build.spec
		local node = ops.findNode(spec, args.node, 'allocate')
		if node.alloc then return { node = info(node), alreadyAllocated = true } end
		local mode = args.weaponSet or 0
		if mode > 0 and (node.type == 'Keystone' or node.type == 'Socket' or node.containJewelSocket) then
			util.fail('NOT_ALLOWED', 'Keystones and jewel sockets cannot be weapon set passives.')
		end
		util.check(node.path, 'NO_PATH', ('%s is not reachable from your tree.'):format(node.dn))
		local before, beforeCount = allocatedSet(spec)
		-- Attribute nodes on the path take the chosen attribute, like PoB's last popup choice.
		if args.attribute then spec.attributeIndex = ATTRIBUTES[args.attribute] end
		local previous = spec.allocMode
		spec.allocMode = mode
		local ok, err = pcall(spec.AllocNode, spec, node)
		spec.allocMode = previous
		if not ok then error(err, 0) end
		util.check(node.alloc, 'NOT_ALLOCATED', ('PoB did not allocate %s.'):format(node.dn))
		local added = {}
		for id, n in pairs(spec.allocNodes) do if not before[id] then added[#added + 1] = n.dn end end
		util.changed(build, spec)
		local _, afterCount = allocatedSet(spec)
		return { node = info(node), added = added, pointsSpent = afterCount - beforeCount }
	end

	ops['tree.deallocate'] = function(args)
		local build = util.build()
		local spec = build.spec
		local node = ops.findNode(spec, args.node, 'remove')
		util.check(node.alloc, 'NOT_ALLOCATED', ('%s is not allocated.'):format(node.dn))
		util.check(node.type ~= 'ClassStart' and node.type ~= 'AscendClassStart', 'NOT_ALLOWED', 'Start nodes cannot be removed.')
		local before = allocatedSet(spec)
		spec:DeallocNode(node)
		local removed = {}
		for id, n in pairs(before) do if n and not spec.allocNodes[id] then removed[#removed + 1] = spec.nodes[id].dn end end
		util.changed(build, spec)
		return { removed = removed }
	end

	ops['tree.attribute'] = function(args)
		local build = util.build()
		local spec = build.spec
		local node = ops.findNode(spec, args.node, 'read')
		util.check(node.isAttribute, 'NOT_ATTRIBUTE', ('%s is not an attribute node.'):format(node.dn))
		spec:SwitchAttributeNode(node.id, ATTRIBUTES[args.attribute])
		spec.attributeIndex = ATTRIBUTES[args.attribute]
		if node.alloc then spec:BuildAllDependsAndPaths() end
		util.changed(build, spec)
		return { node = info(spec.nodes[node.id]) }
	end

	ops['tree.reset'] = function(args)
		local build = util.build()
		local spec = build.spec
		local keep = {}
		if args.keepAscendancy ~= false then
			for _, node in pairs(spec.allocNodes) do
				if node.ascendancyName and node.type ~= 'AscendClassStart' then keep[#keep + 1] = node.id end
			end
		end
		wipeTable(spec.hashOverrides)
		spec:ResetNodes()
		spec:BuildAllDependsAndPaths()
		for _, id in ipairs(keep) do
			local node = spec.nodes[id]
			if node and not node.alloc and node.path then spec:AllocNode(node) end
		end
		util.changed(build, spec)
		return { pointsUsed = (spec:CountAllocNodes()), keptAscendancy = #keep }
	end

	-- ---- tree sets ----
	local function setList(build)
		local list = {}
		for i, spec in ipairs(build.treeTab.specList) do
			list[i] = { id = i, title = spec.title or 'Default', treeVersion = spec.treeVersion, active = i == build.treeTab.activeSpec, points = (spec:CountAllocNodes()) }
		end
		return list
	end
	local function findSet(build, query)
		return util.pick(setList(build), query, function(s) return s.title end, function(s) return s.id end, 'passive tree set')
	end

	ops['tree.sets'] = function() return { sets = setList(util.build()) } end

	ops['tree.set_select'] = function(args)
		local build = util.build()
		local set = findSet(build, args.set)
		build.treeTab:SetActiveSpec(set.id)
		util.recalc(build)
		return { active = setList(build)[set.id] }
	end

	local function afterSetChange(build)
		build.treeTab.modFlag = true
		if build.SyncLoadouts then build:SyncLoadouts() end
	end

	ops['tree.set_new'] = function(args)
		local build = util.build()
		local tab = build.treeTab
		if args.copy then
			tab:CopyTree(tab.activeSpec, args.name)
		else
			local spec = util.new('PassiveSpec', build, latestTreeVersion)
			spec.title = args.name or ('Tree ' .. (#tab.specList + 1))
			spec:SelectClass(build.spec.curClassId)
			spec:SelectAscendClass(build.spec.curAscendClassId)
			table.insert(tab.specList, spec)
		end
		tab:SetActiveSpec(#tab.specList)
		afterSetChange(build)
		util.recalc(build)
		return { active = setList(build)[#tab.specList] }
	end

	ops['tree.set_rename'] = function(args)
		local build = util.build()
		build.spec.title = args.name
		afterSetChange(build)
		return { active = setList(build)[build.treeTab.activeSpec] }
	end

	ops['tree.set_delete'] = function(args)
		local build = util.build()
		local tab = build.treeTab
		util.check(#tab.specList > 1, 'NOT_ALLOWED', 'The last passive tree set cannot be deleted.')
		local set = findSet(build, args.set)
		local wasActive = set.id == tab.activeSpec
		table.remove(tab.specList, set.id)
		if wasActive or tab.activeSpec > #tab.specList then
			tab:SetActiveSpec(math.max(1, set.id - 1))
		elseif set.id < tab.activeSpec then
			tab.activeSpec = tab.activeSpec - 1
		end
		afterSetChange(build)
		util.recalc(build)
		return { sets = setList(build) }
	end

	ops['tree.versions'] = function()
		local spec = util.build().spec
		local list = {}
		for _, v in ipairs(treeVersionList or {}) do list[#list + 1] = { id = v, name = treeVersions[v] and treeVersions[v].display or v } end
		return { current = spec.treeVersion, latest = latestTreeVersion, versions = list }
	end

	ops['tree.convert'] = function(args)
		local build = util.build()
		util.check(treeVersions[args.version], 'BAD_VERSION', 'Unknown tree version. See `pob tree versions`.')
		local before = (build.spec:CountAllocNodes())
		build.treeTab:ConvertToVersion(args.version, true, false)
		util.changed(build, build.spec)
		return { treeVersion = build.spec.treeVersion, pointsBefore = before, pointsAfter = (build.spec:CountAllocNodes()) }
	end
end
