-- Skill groups, gems and skill sets. Mirrors the Skills tab's own edits (SkillsTab.lua).
return function(ops, util)
	local skillSets = dofile(POBAI_ADAPTER .. '/ops/sets.lua')(util, 'skillsTab',
		{ sets = 'skillSets', order = 'skillSetOrderList', active = 'activeSkillSetId', new = 'NewSkillSet', copy = 'CopySkillSet',
			delete = 'DeleteSkillSet', select = 'SetActiveSkillSet', undo = true }, 'skill set')

	local function gemName(gem)
		return (gem.grantedEffect and gem.grantedEffect.name) or (gem.gemData and gem.gemData.name) or gem.nameSpec
	end

	local function groupInfo(build, index, group)
		local gems = {}
		for i, gem in ipairs(group.gemList or {}) do
			gems[i] = { index = i, name = gemName(gem), level = gem.level, quality = gem.quality, enabled = gem.enabled ~= false,
				support = (gem.grantedEffect and gem.grantedEffect.support) or (gem.gemData and gem.gemData.grantedEffect and gem.gemData.grantedEffect.support) or false,
				count = gem.count, error = gem.errMsg }
		end
		local active = {}
		for i, skill in ipairs(group.displaySkillList or {}) do
			local effect = skill.activeEffect
			active[i] = effect and effect.grantedEffect and effect.grantedEffect.name or ('Skill ' .. i)
		end
		return {
			group = index, label = group.label ~= '' and group.label or nil, displayLabel = group.displayLabel,
			enabled = group.enabled ~= false, fullDps = group.includeInFullDPS or false, count = group.groupCount or 1,
			main = index == build.mainSocketGroup, mainActive = group.mainActiveSkill or 1, activeSkills = active,
			source = group.source, slot = group.slot, gems = gems,
		}
	end

	local function group(build, index)
		return util.check(build.skillsTab.socketGroupList[index], 'NOT_FOUND', ('There is no skill group %s. See `pob skills list`.'):format(tostring(index)))
	end

	--- New gem instance shaped like the one the Skills tab creates (SkillsTab.lua gem slot handler).
	local function newGem(build, name, level, quality)
		local tab = build.skillsTab
		local message, data = tab:FindSkillGem(name)
		util.check(data, 'NOT_FOUND', message or ('No gem named "%s". Try `pob gems search`.'):format(name))
		local gem = { nameSpec = data.name, gemId = data.id, level = 1, quality = quality or tab.defaultGemQuality or 0, enabled = true,
			enableGlobal1 = true, enableGlobal2 = true, count = 1, new = true, corrupted = false, corruptLevel = 0 }
		return gem, data, level
	end

	local function finishGem(tab, group, gem, data, level)
		gem.skillId = nil
		tab:ProcessSocketGroup(group)
		gem.level = level or tab:ProcessGemLevel(gem.gemData or data)
		gem.naturalMaxLevel = gem.naturalMaxLevel or gem.level
		gem.new = nil
		tab:ProcessSocketGroup(group)
		if gem.errMsg then util.fail('BAD_GEM', gem.errMsg) end
	end

	local function done(build, displayGroup)
		local tab = build.skillsTab
		if displayGroup then tab:SetDisplayGroup(displayGroup) end
		util.changed(build, tab)
	end

	ops['skills.list'] = function()
		local build = util.build()
		local groups = {}
		for i, g in ipairs(build.skillsTab.socketGroupList) do groups[i] = groupInfo(build, i, g) end
		local set = build.skillsTab.skillSets[build.skillsTab.activeSkillSetId]
		return { skillSet = set and set.title or 'Default', mainGroup = build.mainSocketGroup, groups = groups }
	end

	ops['skills.add'] = function(args)
		local build = util.build()
		local tab = build.skillsTab
		local g = { label = args.label or '', enabled = true, includeInFullDPS = false, gemList = {} }
		if args.slot then g.slot = args.slot end
		local pending = {}
		for _, name in ipairs(args.gems) do
			local gem, data = newGem(build, name, args.level, args.quality)
			table.insert(g.gemList, gem)
			pending[#pending + 1] = { gem = gem, data = data }
		end
		table.insert(tab.socketGroupList, g)
		local ok, err = pcall(function()
			for _, p in ipairs(pending) do finishGem(tab, g, p.gem, p.data, args.level) end
		end)
		if not ok then
			table.remove(tab.socketGroupList)
			error(err, 0)
		end
		if #tab.socketGroupList == 1 then build.mainSocketGroup = 1 end
		done(build, g)
		return groupInfo(build, #tab.socketGroupList, g)
	end

	ops['skills.remove'] = function(args)
		local build = util.build()
		local tab = build.skillsTab
		local g = group(build, args.group)
		util.check(not g.source, 'NOT_ALLOWED', 'This group comes from an item and cannot be removed; disable it instead.')
		table.remove(tab.socketGroupList, args.group)
		if build.mainSocketGroup > args.group then build.mainSocketGroup = build.mainSocketGroup - 1 end
		build.mainSocketGroup = math.max(1, math.min(build.mainSocketGroup, #tab.socketGroupList))
		local input = build.calcsTab.input
		if input.skill_number and input.skill_number > args.group then input.skill_number = input.skill_number - 1 end
		if tab.displayGroup == g then tab:SetDisplayGroup(nil) end
		util.changed(build, tab)
		return { removed = args.group, groups = #tab.socketGroupList }
	end

	ops['skills.set'] = function(args)
		local build = util.build()
		local g = group(build, args.group)
		if args.enabled ~= nil then g.enabled = args.enabled end
		if args.label then g.label = args.label end
		if args.slot then g.slot = args.slot end
		if args.fullDps ~= nil then g.includeInFullDPS = args.fullDps end
		if args.count then g.groupCount = math.max(1, args.count) end
		build.skillsTab:ProcessSocketGroup(g)
		done(build, g)
		return groupInfo(build, args.group, g)
	end

	local function sourceInstance(g)
		local skill = g.displaySkillList and g.displaySkillList[g.mainActiveSkill or 1]
		return skill and skill.activeEffect and skill.activeEffect.srcInstance, skill
	end

	ops['skills.main'] = function(args)
		local build = util.build()
		local g = group(build, args.group)
		build.mainSocketGroup = args.group
		if args.active then
			util.check(g.displaySkillList and g.displaySkillList[args.active], 'NOT_FOUND', 'That group has no active skill number ' .. args.active .. '.')
			g.mainActiveSkill = args.active
		end
		util.recalc(build)
		local src, skill = sourceInstance(g)
		if args.part then
			util.check(src, 'NOT_FOUND', 'This skill has no parts.')
			local parts = skill.activeEffect.grantedEffect.parts
			util.check(parts and parts[args.part], 'NOT_FOUND', 'This skill has ' .. (parts and #parts or 0) .. ' parts.')
			src.skillPart = args.part
		end
		if args.minion then
			util.check(src, 'NOT_FOUND', 'This skill has no minions.')
			local list = {}
			for id, minion in pairs(build.data.minions or data.minions or {}) do list[#list + 1] = { id = id, name = minion.name or id } end
			local minion = util.pick(list, args.minion, function(m) return m.name end, function(m) return m.id end, 'minion')
			src.skillMinion = minion.id
		end
		build.modFlag = true
		util.changed(build, build.skillsTab)
		local parts = {}
		if skill and skill.activeEffect and skill.activeEffect.grantedEffect.parts then
			for i, p in ipairs(skill.activeEffect.grantedEffect.parts) do parts[i] = p.name end
		end
		return { main = groupInfo(build, args.group, g), parts = parts, stats = util.outputs(build.calcsTab.mainOutput, { 'FullDPS', 'CombinedDPS', 'TotalDPS', 'AverageHit', 'Speed' }) }
	end

	ops['skills.sets'] = function() return { sets = skillSets.list() } end
	ops['skills.set_select'] = function(args) return skillSets.select(args.set) end
	ops['skills.set_new'] = function(args) return skillSets.create(args.name, args.copy) end
	ops['skills.set_delete'] = function(args) return skillSets.delete(args.set) end

	-- ---- gems ----
	ops['gems.search'] = function(args)
		local build = util.build()
		local hits = {}
		for id, gem in pairs(build.data.gems) do
			local effect = gem.grantedEffect
			local support = effect and effect.support or false
			local text = (gem.name or '') .. ' ' .. (gem.tagString or '') .. ' ' .. (effect and effect.description or '')
			if util.contains(text, args.text) and (not args.kind or (args.kind == 'support') == support) then
				hits[#hits + 1] = { name = gem.name, id = id, support = support, tags = gem.tagString, maxLevel = gem.naturalMaxLevel,
					requires = { str = gem.reqStr, dex = gem.reqDex, int = gem.reqInt }, nameMatch = util.contains(gem.name, args.text) }
			end
		end
		table.sort(hits, function(a, b)
			if a.nameMatch ~= b.nameMatch then return a.nameMatch end
			return a.name < b.name
		end)
		local page, total = util.take(hits, args.limit or 25)
		for _, h in ipairs(page) do h.nameMatch = nil end
		return { total = total, gems = page }
	end

	ops['gems.add'] = function(args)
		local build = util.build()
		local tab = build.skillsTab
		local g = group(build, args.group)
		local gem, data = newGem(build, args.gem, args.level, args.quality)
		table.insert(g.gemList, gem)
		local ok, err = pcall(finishGem, tab, g, gem, data, args.level)
		if not ok then table.remove(g.gemList) tab:ProcessSocketGroup(g) error(err, 0) end
		done(build, g)
		return groupInfo(build, args.group, g)
	end

	ops['gems.set'] = function(args)
		local build = util.build()
		local tab = build.skillsTab
		local g = group(build, args.group)
		local gem = util.check(g.gemList[args.index], 'NOT_FOUND', ('Group %d has no gem %d.'):format(args.group, args.index))
		if args.gem then
			local replacement, data = newGem(build, args.gem, args.level, args.quality or gem.quality)
			g.gemList[args.index] = replacement
			local ok, err = pcall(finishGem, tab, g, replacement, data, args.level)
			if not ok then g.gemList[args.index] = gem tab:ProcessSocketGroup(g) error(err, 0) end
			gem = replacement
		end
		if args.level then gem.level = args.level end
		if args.quality then gem.quality = args.quality end
		if args.enabled ~= nil then gem.enabled = args.enabled end
		if args.count then gem.count = args.count end
		if args.part then gem.skillPart = args.part end
		tab:ProcessSocketGroup(g)
		if gem.errMsg then util.fail('BAD_GEM', gem.errMsg) end
		if args.level then util.check(gem.level == args.level, 'BAD_LEVEL', ('%s cannot be level %d.'):format(gemName(gem), args.level)) end
		done(build, g)
		return groupInfo(build, args.group, g)
	end

	ops['gems.remove'] = function(args)
		local build = util.build()
		local g = group(build, args.group)
		util.check(g.gemList[args.index], 'NOT_FOUND', ('Group %d has no gem %d.'):format(args.group, args.index))
		table.remove(g.gemList, args.index)
		build.skillsTab:ProcessSocketGroup(g)
		done(build, g)
		return groupInfo(build, args.group, g)
	end
end
