-- Build files, character and summary operations.
return function(ops, util)
	local SUMMARY_STATS = { 'FullDPS', 'CombinedDPS', 'TotalDPS', 'TotalDotDPS', 'AverageHit', 'Speed', 'CritChance', 'HitChance',
		'Life', 'LifeUnreserved', 'EnergyShield', 'Mana', 'ManaUnreserved', 'Spirit', 'SpiritUnreserved', 'Ward', 'Armour', 'Evasion',
		'TotalEHP', 'Minion.CombinedDPS', 'Minion.TotalDPS', 'FireResist', 'ColdResist', 'LightningResist', 'ChaosResist', 'BlockChance', 'EffectiveMovementSpeedMod' }

	local function mainSkill(build)
		local group = build.skillsTab.socketGroupList[build.mainSocketGroup]
		if not group then return nil end
		local list = group.displaySkillList
		local active = list and list[group.mainActiveSkill or 1]
		local effect = active and active.activeEffect
		return effect and effect.grantedEffect and effect.grantedEffect.name or group.displayLabel or group.label
	end

	local function pointInfo(build)
		local spec = build.spec
		local used, ascUsed, _, sockets, weapon1, weapon2 = spec:CountAllocNodes()
		return { used = used, ascendancy = ascUsed, jewelSockets = sockets, weaponSet1 = weapon1, weaponSet2 = weapon2 }
	end

	function ops.summary(build)
		local spec = build.spec
		local out = build.calcsTab.mainOutput or {}
		local ascendancy = spec.curAscendClassName
		if ascendancy == 'None' then ascendancy = nil end
		return {
			loaded = true,
			name = build.buildName,
			file = build.dbFileName or nil,
			unsaved = build.unsaved or false,
			level = build.characterLevel,
			levelMode = build.characterLevelAutoMode and 'auto' or 'manual',
			class = spec.curClassName,
			ascendancy = ascendancy,
			mainSkill = mainSkill(build),
			mainGroup = build.mainSocketGroup,
			treeVersion = spec.treeVersion,
			points = pointInfo(build),
			tab = POBAI_MODE == 'live' and build.viewMode or nil,
			stats = util.outputs(out, SUMMARY_STATS),
			warnings = #(build.controls.warnings and build.controls.warnings.lines or {}),
		}
	end

	ops['engine.info'] = function()
		local manifest = pobai_read_file('manifest.xml') or ''
		local main = POBAI_MAIN
		return {
			mode = POBAI_MODE,
			version = manifest:match('<Version[^>]-number="([^"]+)"'),
			branch = manifest:match('<Version[^>]-branch="([^"]+)"'),
			screen = main.mode,
			buildLoaded = main.mode == 'BUILD',
			buildPath = main.buildPath,
			treeVersions = treeVersionList,
			frames = POBAI_FRAMES,
			latestTreeVersion = latestTreeVersion,
		}
	end

	ops['engine.ops'] = function()
		local names = {}
		for name, fn in pairs(POBAI_OPS) do
			if type(fn) == 'function' and name:find('.', 1, true) then names[#names + 1] = name end
		end
		table.sort(names)
		return { ops = names }
	end

	ops['build.summary'] = function()
		local main = POBAI_MAIN
		if main.mode ~= 'BUILD' or not main.modes.BUILD or not main.modes.BUILD.spec then return { loaded = false, screen = main.mode } end
		return ops.summary(main.modes.BUILD)
	end

	ops['build.paths'] = function()
		return { buildPath = POBAI_MAIN.buildPath, userPath = POBAI_MAIN.userPath, defaultBuildPath = POBAI_MAIN.defaultBuildPath }
	end

	local function guardUnsaved(args)
		local main = POBAI_MAIN
		if POBAI_MODE ~= 'live' or args.discard then return end
		local build = main.modes.BUILD
		if main.mode == 'BUILD' and build and build.unsaved then
			util.fail('UNSAVED', 'The open build has unsaved changes. Save it first (`pob build save`) or pass --discard.')
		end
	end

	--- Replaces the open build. Synchronous while a build is open, like PoB's import does.
	local function openBuild(dbFileName, name, xml)
		local main = POBAI_MAIN
		local build = main.modes.BUILD
		if main.mode == 'BUILD' and build and build.spec then
			build:Shutdown()
			build:Init(dbFileName, name, xml, false, nil)
			build.viewMode = 'TREE'
		else
			main:SetMode('BUILD', dbFileName, name, xml)
		end
		util.waitFrame()
		build = util.build()
		if not build.targetVersion then
			util.fail('NEEDS_CONVERSION', 'PoB asks to convert this build to the current game version. Confirm the prompt in the PoB window.')
		end
		if build.buildFlag then util.recalc(build) end
		return build
	end

	ops['build.load'] = function(args)
		guardUnsaved(args)
		util.check(type(args.xml) == 'string' and args.xml:find('<PathOfBuilding2', 1, true), 'BAD_BUILD', 'Not a PoE2 Path of Building build.')
		local name = args.name
		local dbFileName = false
		if args.file and args.file ~= '' then
			dbFileName = POBAI_MAIN.buildPath .. args.file
			name = args.file:match('([^/\\]+)%.xml$') or name
		end
		local build = openBuild(dbFileName, name or 'Imported build', args.xml)
		return ops.summary(build)
	end

	ops['build.new'] = function(args)
		guardUnsaved(args)
		local build = openBuild(false, args.name or 'New build', nil)
		if args.class then ops['character.class']({ class = args.class }) end
		if args.ascendancy then ops['character.ascendancy']({ ascendancy = args.ascendancy }) end
		if args.level then ops['character.level']({ level = args.level }) end
		build.modFlag = true
		return ops.summary(build)
	end

	ops['build.xml'] = function()
		local build = util.build()
		local file = build.dbFileName or nil
		if file and POBAI_MAIN.buildPath and file:sub(1, #POBAI_MAIN.buildPath) == POBAI_MAIN.buildPath then
			file = file:sub(#POBAI_MAIN.buildPath + 1)
		end
		return { xml = build:SaveDB('pob-ai'), name = build.buildName, file = file }
	end

	local function safeName(name)
		local clean = tostring(name):gsub('[\\/:%*%?"<>|%c]', ''):gsub('^%s+', ''):gsub('%s+$', '')
		util.check(clean ~= '', 'BAD_NAME', 'The build name is empty after removing characters files cannot use.')
		return clean
	end

	ops['build.save'] = function(args)
		local build = util.build()
		local main = POBAI_MAIN
		local path = build.dbFileName
		if args.name or not path then
			local name = safeName(args.name or build.buildName or 'New build')
			local subPath = build.dbFileSubPath or ''
			local candidate = main.buildPath .. subPath .. name .. '.xml'
			local n = 2
			while not args.overwrite and pobai_read_file(candidate) and candidate ~= build.dbFileName do
				candidate = main.buildPath .. subPath .. name .. ' (' .. n .. ').xml'
				n = n + 1
			end
			path = candidate
			build.dbFileName = path
			build.buildName = path:match('([^/\\]+)%.xml$')
			build.dbFileSubPath = subPath
		end
		local xml = build:SaveDB(build.buildName)
		util.check(xml, 'SAVE_FAILED', 'PoB could not serialise the build.')
		pobai_write_file(path, xml)
		util.check(pobai_read_file(path) == xml, 'SAVE_FAILED', 'The saved file could not be read back: ' .. path)
		build:ResetModFlags()
		if build.spec.SetWindowTitleWithBuildClass and POBAI_MODE == 'live' then build.spec:SetWindowTitleWithBuildClass() end
		return { saved = true, file = path, name = build.buildName }
	end

	ops['build.rename'] = function(args)
		local build = util.build()
		build.buildName = safeName(args.name)
		build.modFlag = true
		if POBAI_MODE == 'live' and build.spec.SetWindowTitleWithBuildClass then build.spec:SetWindowTitleWithBuildClass() end
		return { name = build.buildName, note = 'The file keeps its name until you save with --name.' }
	end

	-- ---- character ----
	local function classes(build)
		local list = {}
		for id, class in pairs(build.spec.tree.classes) do
			local asc = {}
			for ascId, a in pairs(class.classes or {}) do
				if type(ascId) == 'number' and ascId > 0 then asc[#asc + 1] = { id = ascId, name = a.name } end
			end
			table.sort(asc, function(a, b) return a.id < b.id end)
			list[#list + 1] = { id = id, name = class.name, ascendancies = asc }
		end
		table.sort(list, function(a, b) return a.id < b.id end)
		return list
	end

	ops['character.classes'] = function()
		return { classes = classes(util.build()) }
	end

	ops['character.level'] = function(args)
		local build = util.build()
		local level = math.min(math.max(math.floor(args.level), 1), 100)
		build.characterLevel = level
		build.characterLevelAutoMode = false
		if build.controls.levelScalingButton then build.controls.levelScalingButton.label = 'Manual' end
		if build.controls.characterLevel then build.controls.characterLevel:SetText(level) end
		build.configTab:BuildModList()
		build.modFlag = true
		util.recalc(build)
		return { level = level }
	end

	ops['character.class'] = function(args)
		local build = util.build()
		local spec = build.spec
		local class = util.pick(classes(build), args.class, function(c) return c.name end, function(c) return c.id end, 'class')
		if class.id ~= spec.curClassId then
			if args.connect and spec:CountAllocNodes() > 0 and not spec:IsClassConnected(class.id) then
				util.check(spec:ConnectToClass(class.id), 'NO_PATH', 'No path connects your tree to the ' .. class.name .. ' start.')
			end
			spec:SelectClass(class.id)
			spec:AddUndoState()
			if POBAI_MODE == 'live' then spec:SetWindowTitleWithBuildClass() end
			build.treeTab.viewer.searchStrCached = ''
			util.recalc(build)
		end
		return { class = spec.curClassName, pointsUsed = (spec:CountAllocNodes()) }
	end

	ops['character.ascendancy'] = function(args)
		local build = util.build()
		local spec = build.spec
		local id = 0
		if util.lower(args.ascendancy) ~= 'none' then
			local list = classes(build)
			local current
			for _, c in ipairs(list) do if c.id == spec.curClassId then current = c end end
			local asc = util.pick(current.ascendancies, args.ascendancy, function(a) return a.name end, function(a) return a.id end, 'ascendancy of ' .. current.name)
			id = asc.id
		end
		spec:SelectAscendClass(id)
		spec:AddUndoState()
		if POBAI_MODE == 'live' then spec:SetWindowTitleWithBuildClass() end
		util.recalc(build)
		return { ascendancy = spec.curAscendClassName }
	end
end
