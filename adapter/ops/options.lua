-- PoB's own options (the Options dialog). Saved to PoB's Settings.xml in the live window.
return function(ops, util)
	local OPTIONS = {
		{ key = 'defaultCharLevel', type = 'integer', min = 1, max = 100, label = 'Default character level for new builds' },
		{ key = 'defaultGemQuality', type = 'integer', min = 0, max = 23, label = 'Default gem quality' },
		{ key = 'defaultItemAffixQuality', type = 'number', min = 0, max = 1, label = 'Default roll for item ranges (0-1)' },
		{ key = 'showThousandsSeparators', type = 'boolean', label = 'Show thousands separators' },
		{ key = 'thousandsSeparator', type = 'string', label = 'Thousands separator' },
		{ key = 'decimalSeparator', type = 'string', label = 'Decimal separator' },
		{ key = 'showTitlebarName', type = 'boolean', label = 'Show build name in the title bar' },
		{ key = 'edgeSearchHighlight', type = 'boolean', label = 'Pin off-screen tree search results to the edge' },
		{ key = 'showWarnings', type = 'boolean', label = 'Show build warnings' },
		{ key = 'slotOnlyTooltips', type = 'boolean', label = 'Only compare items with the hovered slot' },
		{ key = 'notSupportedModTooltips', type = 'boolean', label = 'Show unsupported modifiers in tooltips' },
		{ key = 'nodePowerTheme', type = 'string', label = 'Node power heat map colours' },
		{ key = 'showAnimations', type = 'boolean', label = 'Animate the passive tree' },
	}

	local function list()
		local main = POBAI_MAIN
		local out = {}
		for _, option in ipairs(OPTIONS) do
			if main[option.key] ~= nil then
				out[#out + 1] = { key = option.key, label = option.label, type = option.type, value = main[option.key] }
			end
		end
		return out
	end

	ops['options.list'] = function()
		return { options = list(), saved = POBAI_MODE == 'live' }
	end

	ops['options.set'] = function(args)
		local main = POBAI_MAIN
		local option
		for _, o in ipairs(OPTIONS) do if o.key == args.key then option = o end end
		util.check(option and main[args.key] ~= nil, 'NOT_FOUND', ('Unknown option "%s". See `pob options list`.'):format(tostring(args.key)))
		local value = args.value
		if option.type == 'boolean' then
			util.check(type(value) == 'boolean', 'BAD_VALUE', args.key .. ' takes true or false.')
		elseif option.type == 'string' then
			value = tostring(value)
		else
			value = util.check(tonumber(value), 'BAD_VALUE', args.key .. ' takes a number.')
			if option.type == 'integer' then value = math.floor(value) end
			value = math.min(math.max(value, option.min), option.max)
		end
		main[args.key] = value
		-- The live window writes Settings.xml like PoB's Options dialog; the background engine never does.
		if POBAI_MODE == 'live' and main.SaveSettings then main:SaveSettings() end
		local build = main.modes.BUILD
		if main.mode == 'BUILD' and build and build.spec then build.buildFlag = true end
		return { key = args.key, value = value, saved = POBAI_MODE == 'live' }
	end
end
