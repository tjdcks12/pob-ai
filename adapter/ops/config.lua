-- Configuration options (enemy, buffs, conditions) and configuration sets (ConfigTab.lua).
return function(ops, util)
	local configSets = dofile(POBAI_ADAPTER .. '/ops/sets.lua')(util, 'configTab',
		{ sets = 'configSets', order = 'configSetOrderList', active = 'activeConfigSetId', new = 'NewConfigSet', copy = 'CopyConfigSet',
			delete = 'DeleteConfigSet', select = 'SetActiveConfigSet', selectArgs = { false }, undo = true }, 'configuration set')

	local options, byKey
	local function load()
		if options then return options, byKey end
		local ok, list = pcall(require, 'Modules.ConfigOptions')
		if not ok or type(list) ~= 'table' then list = LoadModule('Modules/ConfigOptions') end
		options, byKey = {}, {}
		local section
		for _, entry in ipairs(list) do
			if entry.section then section = entry.section end
			if entry.var then
				entry.__section = section
				options[#options + 1] = entry
				byKey[entry.var] = entry
			end
		end
		return options, byKey
	end
	ops.configOptions = load

	local function strip(text) return (tostring(text or ''):gsub('%^x%x%x%x%x%x%x', ''):gsub('%^%d', '')) end

	local function defaultOf(option)
		if option.defaultIndex and option.list then return option.list[option.defaultIndex].val end
		if option.type == 'list' and option.list and option.list[1] then return option.defaultState ~= nil and option.defaultState or option.list[1].val end
		return option.defaultState
	end

	local function shown(build, option)
		local control = build.configTab.varControls and build.configTab.varControls[option.var]
		if not control or not control.IsShown then return nil end
		local ok, visible = pcall(control.IsShown, control)
		return ok and visible or false
	end

	local function info(build, option)
		local input = build.configTab.input
		local value = input[option.var]
		local entry = { key = option.var, label = strip(option.label), section = option.__section, type = option.type,
			value = value, default = defaultOf(option), placeholder = build.configTab.placeholder[option.var], relevant = shown(build, option) }
		if option.list then
			entry.choices = {}
			for i, choice in ipairs(option.list) do entry.choices[i] = { value = choice.val, label = strip(choice.label) } end
		end
		if option.tooltip and type(option.tooltip) == 'string' then entry.help = strip(option.tooltip):sub(1, 200) end
		return entry
	end

	local function same(a, b)
		if a == nil or a == false or a == 0 or a == '' then a = nil end
		if b == nil or b == false or b == 0 or b == '' then b = nil end
		return a == b
	end

	ops['config.list'] = function(args)
		local build = util.build()
		local list = load()
		local out = {}
		for _, option in ipairs(list) do
			if not option.legacy then
				local entry = info(build, option)
				local matches = util.contains(entry.key .. ' ' .. entry.label .. ' ' .. (entry.section or ''), args.search)
				if matches and (not args.changed or (entry.value ~= nil and not same(entry.value, entry.default))) then out[#out + 1] = entry end
			end
		end
		-- Options PoB would show for this build first, then the rest.
		table.sort(out, function(a, b)
			if (a.relevant ~= false) ~= (b.relevant ~= false) then return a.relevant ~= false end
			return false
		end)
		local page, total = util.take(out, args.limit or 60)
		local custom = {}
		local set = build.configTab.configSets[build.configTab.activeConfigSetId]
		for i, block in ipairs(set and set.customModsList or {}) do custom[i] = { title = block.title, enabled = block.enabled, text = block.text } end
		return { total = total, options = page, customModifiers = #custom > 0 and custom or nil }
	end

	local function coerce(option, value)
		if util.isNull(value) then return nil end
		local t = option.type
		if t == 'check' then
			util.check(type(value) == 'boolean', 'BAD_VALUE', option.var .. ' takes true or false.')
		elseif t == 'text' then
			value = tostring(value)
		elseif t == 'list' then
			for _, choice in ipairs(option.list or {}) do
				if choice.val == value or util.lower(strip(choice.label)) == util.lower(value) or tostring(choice.val) == tostring(value) then return choice.val end
			end
			local labels = {}
			for i, choice in ipairs(option.list or {}) do labels[i] = tostring(choice.val) end
			util.fail('BAD_VALUE', option.var .. ' must be one of: ' .. table.concat(labels, ', '))
		else
			value = tonumber(value)
			util.check(value and math.abs(value) <= 1e9, 'BAD_VALUE', option.var .. ' takes a number.')
			if t ~= 'float' then util.check(value == math.floor(value), 'BAD_VALUE', option.var .. ' takes a whole number.') end
		end
		return value
	end

	local function apply(build, key, value)
		local _, keys = load()
		local option = util.check(keys[key], 'NOT_FOUND', ('Unknown option "%s". Find keys with `pob config list --search`.'):format(tostring(key)))
		local tab = build.configTab
		local before = util.outputs(build.calcsTab.mainOutput, { 'FullDPS', 'CombinedDPS', 'TotalEHP', 'Life' })
		tab.input[key] = value
		if tab.UpdateControls then pcall(tab.UpdateControls, tab) end
		tab:BuildModList()
		util.changed(build, tab)
		return { option = info(build, option), before = before, after = util.outputs(build.calcsTab.mainOutput, { 'FullDPS', 'CombinedDPS', 'TotalEHP', 'Life' }) }
	end

	ops['config.set'] = function(args)
		local build = util.build()
		local _, keys = load()
		local option = util.check(keys[args.key], 'NOT_FOUND', ('Unknown option "%s". Find keys with `pob config list --search`.'):format(tostring(args.key)))
		return apply(build, args.key, coerce(option, args.value))
	end

	ops['config.reset'] = function(args)
		local build = util.build()
		local _, keys = load()
		local option = util.check(keys[args.key], 'NOT_FOUND', ('Unknown option "%s".'):format(tostring(args.key)))
		return apply(build, args.key, defaultOf(option))
	end

	ops['config.sets'] = function() return { sets = configSets.list() } end
	ops['config.set_select'] = function(args) return configSets.select(args.set) end
	ops['config.set_new'] = function(args) return configSets.create(args.name, args.copy) end
	ops['config.set_delete'] = function(args) return configSets.delete(args.set) end

end
