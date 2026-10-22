-- Party tab (PartyTab.lua): buffs, curses and enemy effects from other players.
return function(ops, util)
	local FIELDS = { stats = 'editPartyMemberStats', auras = 'editAuras', curses = 'editCurses', warcries = 'editWarcries',
		links = 'editLinks', enemyConditions = 'enemyCond', enemyMods = 'enemyMods' }

	local function tab(build)
		return util.check(build.partyTab and build.partyTab.controls, 'NOT_AVAILABLE', 'This PoB version has no party tab.')
	end

	local function state(build)
		local controls = tab(build)
		local out = {}
		for key, name in pairs(FIELDS) do
			local control = controls[name]
			if control then out[key] = control.buf or '' end
		end
		return out
	end

	local function rebuild(build)
		local controls = tab(build)
		util.check(controls.rebuild, 'NOT_AVAILABLE', 'The party tab cannot be rebuilt in this PoB version.')
		controls.rebuild.onClick()
		build.partyTab.modFlag = true
		util.recalc(build)
	end

	ops['party.get'] = function()
		return { party = state(util.build()) }
	end

	ops['party.set'] = function(args)
		local build = util.build()
		local controls = tab(build)
		local control = util.check(controls[FIELDS[args.field]], 'BAD_ARGS', 'Unknown party field ' .. tostring(args.field))
		local text = args.append and ((control.buf or '') .. ((control.buf or '') ~= '' and '\n' or '') .. args.text) or args.text
		control:SetText(text)
		rebuild(build)
		return { party = state(build) }
	end

	ops['party.clear'] = function()
		local build = util.build()
		local controls = tab(build)
		for _, name in pairs(FIELDS) do if controls[name] then controls[name]:SetText('') end end
		rebuild(build)
		return { party = state(build) }
	end

	ops['party.import'] = function(args)
		local build = util.build()
		local controls = tab(build)
		util.check(controls.importCodeIn and controls.importCodeGo, 'NOT_AVAILABLE', 'This PoB version cannot import party members.')
		controls.importCodeIn:SetText(args.code, true)
		local destination = controls.importCodeDestination
		if destination and args.destination then
			local found
			for i, entry in ipairs(destination.list or {}) do
				local label = type(entry) == 'table' and (entry.label or entry.val) or entry
				if util.lower(label) == util.lower(args.destination) then found = i end
			end
			util.check(found, 'BAD_ARGS', 'Unknown destination ' .. args.destination)
			destination:SetSel(found)
		end
		if controls.appendNotReplace then controls.appendNotReplace.state = args.append or false end
		util.onMain(controls.importCodeGo.onClick)
		util.waitFrame()
		rebuild(build)
		return { party = state(build) }
	end
end
