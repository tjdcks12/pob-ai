-- Opt-in refresh of one named character into one already-saved live build.
-- Downloads finish before any build edit; changes during the download abort.
return function(ops, util)
	local json = require('dkjson')
	local function context()
		util.check(POBAI_MODE == 'live', 'LIVE_REQUIRED', 'Open PoB to refresh a character.')
		local build = util.build()
		return build.importTab, build
	end
	local function identity(skill)
		local effect = skill and skill.activeEffect
		if not effect then return nil end
		local src = effect.srcInstance or {}
		return { id = effect.grantedEffect.id, minion = src.skillMinion, minionSkill = src.skillMinionSkill, statSet = src.statSetIndex }
	end
	local function same(a, b)
		if not a or not b then return false end
		for _, key in ipairs({'id', 'minion', 'minionSkill', 'statSet'}) do if a[key] ~= b[key] then return false end end
		return true
	end
	local function canonical(value)
		if type(value) ~= 'table' or value == json.null then return json.encode(value) end
		if value[1] ~= nil then local entries = {}; for _, entry in ipairs(value) do entries[#entries + 1] = canonical(entry) end; return '[' .. table.concat(entries, ',') .. ']' end
		local keys, entries = {}, {}
		for key in pairs(value) do keys[#keys + 1] = key end
		table.sort(keys, function(a, b) return tostring(a) < tostring(b) end)
		for _, key in ipairs(keys) do entries[#entries + 1] = json.encode(tostring(key)) .. ':' .. canonical(value[key]) end
		return '{' .. table.concat(entries, ',') .. '}'
	end
	local function normalize(file) return tostring(file or ''):gsub('\\', '/'):lower() end
	local function dirty(build)
		if build.unsaved or build.modFlag then return true end
		for _, owner in ipairs({build.spec, build.itemsTab, build.skillsTab, build.configTab}) do if owner and owner.modFlag then return true end end
		return false
	end
	ops['account.sync_context'] = function(args)
		local tab, build = context()
		if args.reload then ops['account.characters']({}) end
		local characters, suggested = {}, nil
		for _, char in ipairs(tab.lastCharList or {}) do
			characters[#characters + 1] = {name = char.name, id = char.id, class = char.class, level = char.level, league = char.league}
			if tab.lastCharacterHash == common.sha1(char.name) then suggested = char.name end
		end
		return {available = true, signedIn = POBAI_MAIN.api and POBAI_MAIN.api.authToken ~= nil or false,
			file = build.dbFileName or nil, unsaved = dirty(build), characters = characters, suggestedCharacter = suggested}
	end
	ops['account.refresh'] = function(args)
		local tab, build = context()
		util.check(not dirty(build), 'UNSAVED', 'Save your PoB edits before refreshing.')
		util.check(build.dbFileName and normalize(build.dbFileName) == normalize(args.file), 'SYNC_BUILD_CHANGED', 'The selected PoB file is no longer open.')
		local file, name, view = build.dbFileName, build.buildName, build.viewMode
		local original = build:SaveDB(name)
		local disk = pobai_read_file(file)
		util.check(original and disk, 'SYNC_FILE_CHANGED', 'The saved PoB file cannot be read.')
		local selected = identity(build.calcsTab.mainEnv.player.mainSkill)
		local oldGroup = build.skillsTab.socketGroupList[build.mainSocketGroup]
		local selectedSlot, selectedSource = oldGroup and oldGroup.slot, oldGroup and oldGroup.source
		local weapon = build.itemsTab.activeItemSet.useSecondWeaponSet
		local input = {}; for key, value in pairs(build.configTab.input) do input[key] = value end
		ops['account.characters']({})
		tab:BuildCharacterList(nil)
		local found
		for i, entry in ipairs(tab.controls.charSelect.list) do
			if entry.char and entry.char.name == args.character and (not args.characterId or entry.char.id == args.characterId) then found = i; break end
		end
		util.check(found, 'NOT_FOUND', 'The selected account character no longer exists.')
		tab.controls.charSelect.selIndex = found
		local data
		util.onMain(tab.DownloadCharacter, tab, function(character) data = character end)
		local deadline = GetTime() + 60000
		while GetTime() < deadline and not data and tab.charImportMode == 'IMPORTING' do util.waitFrame() end
		util.check(data and data.name == args.character, 'DOWNLOAD_FAILED', 'Character download did not complete.')
		util.check(util.build() == build and build.dbFileName == file and not dirty(build) and build:SaveDB(name) == original,
			'SYNC_BUILD_CHANGED', 'The PoB build changed during the character download.')
		util.check(pobai_read_file(file) == disk, 'SYNC_FILE_CHANGED', 'The saved file changed during the character download.')
		util.check(type(data.passives) == 'table' and type(data.passives.hashes) == 'table' and type(data.equipment) == 'table'
			and type(data.jewels) == 'table' and type(data.skills) == 'table', 'INCOMPLETE_CHARACTER', 'Character data was incomplete.')
		local fingerprint = common.sha1(canonical({name=data.name, class=data.class, level=data.level,
			passives=data.passives, equipment=data.equipment, jewels=data.jewels, skills=data.skills}))
		if fingerprint == args.previousHash and common.sha1(disk) == args.previousFileHash then
			return {unchanged=true, file=file, character=args.character, snapshotHash=fingerprint, fileHash=common.sha1(disk)}
		end
		local controls = {}
		for _, key in ipairs({'charImportTreeClearJewels', 'charImportItemsClearItems', 'charImportItemsClearSkills', 'charImportItemsIgnoreWeaponSwap'}) do
			if tab.controls[key] then controls[key] = tab.controls[key].state; tab.controls[key].state = key ~= 'charImportItemsIgnoreWeaponSwap' end
		end
		local writeAttempted = false
		local ok, result = pcall(function()
			tab:ImportPassiveTreeAndJewels(data)
			tab:ImportItemsAndSkills(data)
			for _, id in ipairs(data.passives.hashes) do util.check(build.spec.allocNodes[tonumber(id)], 'IMPORT_INCOMPLETE', 'A passive could not be imported.') end
			for _, nodes in pairs(data.passives.specialisations or {}) do
				for _, id in ipairs(nodes) do util.check(build.spec.allocNodes[tonumber(id)], 'IMPORT_INCOMPLETE', 'A weapon-set passive could not be imported.') end
			end
			for _, items in ipairs({data.equipment, data.jewels}) do
				for _, item in ipairs(items) do
					local imported = false
					for _, candidate in pairs(build.itemsTab.items) do if item.id and candidate.uniqueID == item.id and candidate.base then imported = true; break end end
					if item.inventoryId == 'Chakra' then
						local slot = build.itemsTab.runeSlotOrder and build.itemsTab.runeSlotOrder[(item.x or -1) + 1]
						imported = slot and build.itemsTab.activeItemSet[slot] and build.itemsTab.activeItemSet[slot].runeName == item.baseType
					end
					util.check(imported, 'IMPORT_INCOMPLETE', 'An item could not be imported.')
				end
			end
			local expected, actual = 0, 0
			for _, skill in ipairs(data.skills) do expected = expected + 1 + #(skill.socketedItems or {}) end
			for _, group in ipairs(build.skillsTab.socketGroupList) do
				for _, gem in ipairs(group.gemList or {}) do if gem.gemData or gem.grantedEffect then actual = actual + 1 end end
			end
			util.check(actual >= expected, 'IMPORT_INCOMPLETE', 'A skill or support could not be imported.')
			for key, value in pairs(input) do if not tostring(key):match('^quest') and key ~= 'resistancePenalty' then build.configTab.input[key] = value end end
			build.configTab:BuildModList()
			build.itemsTab.activeItemSet.useSecondWeaponSet = weapon
			build.itemsTab:PopulateSlots()
			util.recalc(build)
			if selected then
				local candidates = {}
				for groupIndex, group in ipairs(build.skillsTab.socketGroupList) do
					for active, skill in ipairs(group.displaySkillList or {}) do
						if same(selected, identity(skill)) then candidates[#candidates + 1] = {group=groupIndex, active=active, exact=group.slot == selectedSlot and group.source == selectedSource} end
					end
				end
				local exact = {}; for _, candidate in ipairs(candidates) do if candidate.exact then exact[#exact + 1] = candidate end end
				if #exact == 1 then candidates = exact end
				util.check(#candidates == 1, 'SYNC_SKILL_CHANGED', 'The original main skill is missing or ambiguous; select it in PoB and save first.')
				build.mainSocketGroup = candidates[1].group
				build.skillsTab.socketGroupList[candidates[1].group].mainActiveSkill = candidates[1].active
			end
			util.recalc(build)
			util.check(pobai_read_file(file) == disk, 'SYNC_FILE_CHANGED', 'The file changed before saving.')
			writeAttempted = true
			local saved = ops['build.save']({})
			return {refreshed=true, file=saved.file, character=args.character, snapshotHash=fingerprint, fileHash=common.sha1(pobai_read_file(file)), summary=ops.summary(build)}
		end)
		for key, value in pairs(controls) do tab.controls[key].state = value end
		if not ok then
			local diskRestored = true
			if writeAttempted then diskRestored = pcall(function() pobai_write_file(file, disk); assert(pobai_read_file(file) == disk) end) end
			local liveRestored = pcall(function()
				build:Shutdown(); build:Init(file, name, original, false, nil)
				-- Init from XML marks the build modified; the restored state was clean, so later refreshes must not stall on UNSAVED.
				build:ResetModFlags()
				build.viewMode = view
				util.recalc(build)
			end)
			util.check(diskRestored and liveRestored, 'SYNC_ROLLBACK_FAILED', 'Refresh failed; recover the previous file from PoB AI backups.')
			error(result, 0)
		end
		build.viewMode = view
		return result
	end
end
