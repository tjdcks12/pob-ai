-- Skill, item and configuration sets share one shape in PoB: a table of sets, an order list
-- and an active id, with New/Copy/Delete/SetActive methods on the tab.
return function(util, tabName, names, label)
	local sets = {}

	local function tab() return util.build()[tabName] end

	function sets.list()
		local t = tab()
		local out = {}
		for position, id in ipairs(t[names.order]) do
			local set = t[names.sets][id]
			if set then out[#out + 1] = { id = id, position = position, title = set.title or 'Default', active = id == t[names.active] } end
		end
		return out
	end

	function sets.find(query)
		return util.pick(sets.list(), query, function(s) return s.title end, function(s) return s.id end, label)
	end

	local function sync(build)
		if build.SyncLoadouts then build:SyncLoadouts() end
		if names.undo then local t = build[tabName] if t.AddUndoState then t:AddUndoState() end end
		util.recalc(build)
	end

	function sets.select(query)
		local build = util.build()
		local set = sets.find(query)
		local t = build[tabName]
		if names.selectArgs then t[names.select](t, set.id, unpack(names.selectArgs)) else t[names.select](t, set.id) end
		sync(build)
		return { active = set.title, sets = sets.list() }
	end

	function sets.create(name, copy)
		local build = util.build()
		local t = build[tabName]
		local set = copy and t[names.copy](t, t[names.active], name) or t[names.new](t, nil, name or ('Set ' .. (#t[names.order] + 1)))
		if names.selectArgs then t[names.select](t, set.id, unpack(names.selectArgs)) else t[names.select](t, set.id) end
		sync(build)
		return { active = set.title, sets = sets.list() }
	end

	function sets.delete(query)
		local build = util.build()
		local t = build[tabName]
		util.check(#t[names.order] > 1, 'NOT_ALLOWED', 'The last ' .. label .. ' cannot be deleted.')
		local set = sets.find(query)
		local wasActive = set.id == t[names.active]
		t[names.delete](t, set.id, set.position)
		if wasActive then
			local nextId = t[names.order][math.max(1, set.position - 1)]
			if names.selectArgs then t[names.select](t, nextId, unpack(names.selectArgs)) else t[names.select](t, nextId) end
		end
		sync(build)
		return { sets = sets.list() }
	end

	function sets.rename(name)
		local build = util.build()
		local t = build[tabName]
		t[names.sets][t[names.active]].title = name
		t.modFlag = true
		if build.SyncLoadouts then build:SyncLoadouts() end
		return { sets = sets.list() }
	end

	return sets
end
