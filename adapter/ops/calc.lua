-- Calculated stats, what-if calculations, node power and build comparison.
return function(ops, util)
	local STATS = { 'FullDPS', 'CombinedDPS', 'TotalDPS', 'TotalDotDPS', 'AverageHit', 'AverageDamage', 'Speed', 'HitChance', 'CritChance', 'CritMultiplier',
		'BleedDPS', 'IgniteDPS', 'PoisonDPS', 'Life', 'LifeUnreserved', 'LifeRegenRecovery', 'EnergyShield', 'EnergyShieldRegenRecovery', 'Mana', 'ManaUnreserved', 'ManaCost',
		'Spirit', 'SpiritUnreserved', 'Ward', 'Armour', 'Evasion', 'EvadeChance', 'DeflectChance', 'PhysicalDamageReduction', 'EffectiveBlockChance', 'TotalEHP',
		'PhysicalMaximumHitTaken', 'FireMaximumHitTaken', 'ColdMaximumHitTaken', 'LightningMaximumHitTaken', 'ChaosMaximumHitTaken',
		'FireResist', 'ColdResist', 'LightningResist', 'ChaosResist', 'FireResistOverCap', 'ColdResistOverCap', 'LightningResistOverCap',
		'Str', 'Dex', 'Int', 'ReqStr', 'ReqDex', 'ReqInt', 'EffectiveMovementSpeedMod' }
	local DELTA_STATS = { 'FullDPS', 'CombinedDPS', 'TotalDPS', 'AverageHit', 'Speed', 'CritChance', 'Minion.CombinedDPS', 'Life', 'EnergyShield', 'Mana', 'Spirit', 'TotalEHP',
		'Armour', 'Evasion', 'FireResist', 'ColdResist', 'LightningResist', 'ChaosResist' }

	local function strip(text) return (tostring(text or ''):gsub('%^x%x%x%x%x%x%x', ''):gsub('%^%d', '')) end

	local function delta(before, after, keys)
		local out = {}
		for _, key in ipairs(keys) do
			local a, b = before[key], after[key]
			if type(a) == 'number' and type(b) == 'number' and a ~= b then
				out[key] = { before = a, after = b, change = b - a, percent = a ~= 0 and (b - a) / math.abs(a) * 100 or nil }
			end
		end
		return out
	end

	ops['calc.stats'] = function(args)
		local build = util.build()
		local out = build.calcsTab.mainOutput or {}
		local result = { mainSkill = ops.summary(build).mainSkill }
		if args.all then
			result.stats = util.outputs(out)
		else
			result.stats = util.outputs(out, (args.keys and #args.keys > 0) and args.keys or STATS)
		end
		if out.Minion then result.minion = util.outputs(out.Minion, (args.keys and #args.keys > 0) and args.keys or { 'TotalDPS', 'CombinedDPS', 'AverageHit', 'Speed', 'Life', 'EnergyShield', 'TotalEHP' }) end
		local input = build.configTab.input
		result.conditions = { enemyIsBoss = input.enemyIsBoss, enemyLevel = input.enemyLevel }
		return result
	end

	ops['calc.skills'] = function()
		local build = util.build()
		local out = build.calcsTab.mainOutput or {}
		local skills = {}
		for i, s in ipairs(out.SkillDPS or {}) do
			skills[i] = { name = strip(s.name), dps = s.dps, count = s.count, trigger = s.trigger, part = s.skillPart, source = s.source }
		end
		table.sort(skills, function(a, b) return (a.dps or 0) > (b.dps or 0) end)
		return { fullDps = out.FullDPS, fullDotDps = out.FullDotDPS, skills = skills,
			note = #skills == 0 and 'No skill group is included in Full DPS. Use `pob skills set <group> --full-dps true`.' or nil }
	end

	ops['calc.warnings'] = function()
		local build = util.build()
		local lines = {}
		for i, line in ipairs(build.controls.warnings and build.controls.warnings.lines or {}) do lines[i] = strip(line) end
		return { warnings = lines }
	end

	local function pathSet(node)
		local set = {}
		for _, step in ipairs(node.path or { node }) do set[step] = true end
		set[node] = true
		return set
	end

	ops['calc.whatif'] = function(args)
		local build = util.build()
		local keys = (args.keys and #args.keys > 0) and args.keys or DELTA_STATS
		local spec = build.spec
		local before = util.outputs(build.calcsTab.mainOutput, keys)
		local override, described = {}, {}
		if args.node then
			local node = ops.findNode(spec, args.node, 'allocate')
			util.check(not node.alloc, 'ALREADY', node.dn .. ' is already allocated.')
			util.check(node.path, 'NO_PATH', node.dn .. ' is not reachable from your tree.')
			override.addNodes = pathSet(node)
			described[#described + 1] = ('allocate %s (%d points)'):format(node.dn, #node.path)
		end
		if args.removeNode then
			local node = ops.findNode(spec, args.removeNode, 'remove')
			util.check(node.alloc, 'NOT_ALLOCATED', node.dn .. ' is not allocated.')
			override.removeNodes = { [node] = true }
			for _, dep in ipairs(node.depends or {}) do override.removeNodes[dep] = true end
			described[#described + 1] = 'remove ' .. node.dn
		end
		if args.item then
			util.check(args.slot, 'BAD_ARGS', '--item needs --slot.')
			local item = ops.parseItem(args.item)
			override.repSlotName = args.slot
			override.repItem = item
			described[#described + 1] = ('put %s in %s'):format(item.title or item.name or item.baseName, args.slot)
		end
		local after
		if next(override) then
			local calcFunc = build.calcsTab:GetMiscCalculator()
			after = util.outputs(calcFunc(override, true), keys)
		end
		-- Gem and configuration changes are tried for real and then undone.
		if args.gem or args.config then
			local restore = {}
			local tab = build.skillsTab
			local addedGroup
			if args.gem then
				local group = util.check(tab.socketGroupList[build.mainSocketGroup], 'NO_SKILL', 'There is no main skill group.')
				ops['gems.add']({ group = build.mainSocketGroup, gem = args.gem })
				addedGroup = group
				described[#described + 1] = 'add ' .. args.gem .. ' to the main skill'
			end
			if args.config then
				local _, keysByVar = ops.configOptions()
				for key, value in pairs(args.config) do
					util.check(keysByVar[key], 'NOT_FOUND', 'Unknown option ' .. key)
					restore[key] = build.configTab.input[key]
					build.configTab.input[key] = value
					described[#described + 1] = ('%s = %s'):format(key, tostring(value))
				end
				build.configTab:BuildModList()
			end
			util.recalc(build)
			after = util.outputs(build.calcsTab.mainOutput, keys)
			if addedGroup then
				table.remove(addedGroup.gemList)
				tab:ProcessSocketGroup(addedGroup)
				if tab.undo and #tab.undo > 1 then table.remove(tab.undo) end
			end
			if args.config then
				for key, value in pairs(restore) do build.configTab.input[key] = value end
				build.configTab:BuildModList()
			end
			util.recalc(build)
		end
		util.check(after, 'BAD_ARGS', 'Give at least one of --node, --remove-node, --item, --gem or --config.')
		return { change = table.concat(described, '; '), before = before, after = after, delta = delta(before, after, keys) }
	end

	ops['calc.node_power'] = function(args)
		local build = util.build()
		local spec = build.spec
		local calcFunc, base = build.calcsTab:GetMiscCalculator()
		base = base or build.calcsTab.mainOutput
		local stat = args.stat
		if not stat or stat == 'auto' then
			-- Rank by the damage this build actually deals: player Full DPS, else minion DPS.
			stat = (util.stat(base, 'FullDPS') or 0) > 0 and 'FullDPS' or (util.stat(base, 'CombinedDPS') or 0) > 0 and 'CombinedDPS'
				or (util.stat(base, 'Minion.CombinedDPS') or 0) > 0 and 'Minion.CombinedDPS' or 'TotalEHP'
		end
		local baseValue = util.stat(base, stat) or 0
		local wanted = args.type or 'notable'
		local candidates = {}
		for _, node in pairs(spec.nodes) do
			local ok = not node.alloc and node.path and #node.path <= (args.maxDistance or 6) and not node.ascendancyName
			if ok and wanted ~= 'any' then ok = (wanted == 'notable' and node.type == 'Notable') or (wanted == 'keystone' and node.type == 'Keystone') end
			if ok then candidates[#candidates + 1] = node end
		end
		table.sort(candidates, function(a, b) return #a.path < #b.path end)
		local results = {}
		for i = 1, math.min(#candidates, 80) do
			local node = candidates[i]
			local out = calcFunc({ addNodes = pathSet(node) }, true)
			local value = util.stat(out, stat)
			if type(value) == 'number' then
				local gain = value - baseValue
				results[#results + 1] = { id = node.id, name = node.dn, type = node.type, points = #node.path, gain = gain,
					percent = baseValue ~= 0 and gain / math.abs(baseValue) * 100 or nil, perPoint = gain / #node.path, stats = node.sd }
			end
		end
		table.sort(results, function(a, b) return a.gain > b.gain end)
		local page = util.take(results, args.limit or 15)
		return { stat = stat, base = baseValue, evaluated = math.min(#candidates, 80), candidates = #candidates, nodes = page }
	end

	ops['calc.compare_xml'] = function(args)
		local build = util.build()
		local keys = (args.keys and #args.keys > 0) and args.keys or DELTA_STATS
		util.check(type(args.xml) == 'string' and args.xml:find('<PathOfBuilding2', 1, true), 'BAD_BUILD', 'The other build is not a PoE2 Path of Building build.')
		local entry = util.new('CompareEntry', args.xml, 'pob-ai compare')
		local other = entry.GetOutput and entry:GetOutput() or (entry.calcsTab and entry.calcsTab.mainOutput) or {}
		local otherSpec = entry.GetSpec and entry:GetSpec() or entry.spec
		local mine = build.calcsTab.mainOutput
		local function notables(spec)
			local set = {}
			for _, node in pairs(spec and spec.allocNodes or {}) do
				if node.type == 'Notable' or node.type == 'Keystone' or (node.ascendancyName and node.type ~= 'AscendClassStart') then set[node.dn] = true end
			end
			return set
		end
		local a, b = notables(build.spec), notables(otherSpec)
		local onlyMine, onlyOther = {}, {}
		for name in pairs(a) do if not b[name] then onlyMine[#onlyMine + 1] = name end end
		for name in pairs(b) do if not a[name] then onlyOther[#onlyOther + 1] = name end end
		table.sort(onlyMine) table.sort(onlyOther)
		local items = {}
		local otherItems = entry.itemsTab
		if otherItems then
			for name, slot in pairs(build.itemsTab.slots) do
				local oslot = otherItems.slots and otherItems.slots[name]
				local m = build.itemsTab.items[slot.selItemId]
				local o = oslot and otherItems.items[oslot.selItemId]
				local mn, on = m and (m.title or m.name), o and (o.title or o.name)
				if (mn or on) and mn ~= on and not name:find('Jewel Socket') then items[#items + 1] = { slot = name, mine = mn, other = on } end
			end
			table.sort(items, function(x, y) return x.slot < y.slot end)
		end
		return {
			other = { class = otherSpec and otherSpec.curClassName, ascendancy = otherSpec and otherSpec.curAscendClassName, level = entry.characterLevel },
			stats = delta(util.outputs(mine, keys), util.outputs(other, keys), keys),
			passives = { onlyMine = onlyMine, onlyOther = onlyOther },
			items = items,
			note = 'Stat differences combine every difference between the builds; they are not caused by one item or node.',
		}
	end
end
