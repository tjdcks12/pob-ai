-- Path of Exile account: sign-in and character import, through PoB's own Import tab
-- (ImportTab.lua, PoEAPI.lua). Live window only: sign-in opens the user's browser.
return function(ops, util)
	local function strip(text)
		if type(text) == 'function' then text = text() end
		return (tostring(text or ''):gsub('%^x%x%x%x%x%x%x', ''):gsub('%^%d', ''))
	end

	local function importTab()
		util.check(POBAI_MODE == 'live', 'LIVE_REQUIRED', 'Signing in to Path of Exile needs the PoB window. Open it with `pob open`.')
		local build = util.build()
		return util.check(build.importTab, 'NOT_AVAILABLE', 'This PoB version has no import tab.'), build
	end

	local function status(tab)
		return { signedIn = POBAI_MAIN.api and POBAI_MAIN.api.authToken ~= nil or false, step = tab.charImportMode, message = strip(tab.charImportStatus) }
	end

	--- Waits until check() is true, letting PoB run its downloads between frames.
	local function waitFor(check, seconds)
		local deadline = GetTime() + seconds * 1000
		while GetTime() < deadline do
			if check() then return true end
			util.waitFrame()
		end
		return false
	end

	ops['account.status'] = function()
		local tab = importTab()
		return status(tab)
	end

	ops['account.login'] = function(args)
		local tab, build = importTab()
		if POBAI_MAIN.api and POBAI_MAIN.api.authToken then return status(tab) end
		build.viewMode = 'IMPORT'
		local button = util.check(tab.controls.authenticateButton, 'NOT_AVAILABLE', 'This PoB version has no sign-in button.')
		util.onMain(button.onClick)
		-- The user approves PoB in their browser; PoB receives the token on a local port.
		local ok = waitFor(function() return POBAI_MAIN.api and POBAI_MAIN.api.authToken ~= nil end, args.timeout or 180)
		util.check(ok, 'NOT_SIGNED_IN', 'Sign-in was not completed in the browser.')
		return status(tab)
	end

	local function requireSignedIn(tab)
		util.check(POBAI_MAIN.api and POBAI_MAIN.api.authToken, 'NOT_SIGNED_IN', 'Sign in first with `pob account login` (it opens your browser).')
	end

	local function loadCharacters(tab, args)
		requireSignedIn(tab)
		if args.realm and tab.controls.accountRealm then
			tab.controls.accountRealm:SelByValue(args.realm, 'id')
		end
		util.onMain(tab.DownloadCharacterList, tab)
		local done = waitFor(function() return tab.charImportMode ~= 'DOWNLOADCHARLIST' end, 60)
		if not (done and tab.charImportMode == 'SELECTCHAR') then
			local message = strip(tab.charImportStatus)
			-- A rate-limited request sends the Import tab back to its first step although the account
			-- stays signed in; keep showing the character list that is still loaded.
			if tab.charImportMode == 'GETACCOUNTNAME' and tab.lastCharList and #tab.lastCharList > 0 then tab.charImportMode = 'SELECTCHAR' end
			util.fail(message:find('too fast', 1, true) and 'RATE_LIMITED' or 'DOWNLOAD_FAILED', 'Character list: ' .. message)
		end
		return tab.lastCharList or {}
	end

	ops['account.characters'] = function(args)
		local tab = importTab()
		local list = {}
		for _, char in ipairs(loadCharacters(tab, args)) do
			if not args.league or util.lower(char.league) == util.lower(args.league) then
				list[#list + 1] = { name = char.name, class = char.class, level = char.level, league = char.league }
			end
		end
		table.sort(list, function(a, b) return (a.level or 0) > (b.level or 0) end)
		return { characters = list }
	end

	ops['account.import'] = function(args)
		local tab, build = importTab()
		loadCharacters(tab, args)
		tab:BuildCharacterList(nil)
		local select = tab.controls.charSelect
		local entries = {}
		for i, entry in ipairs(select.list) do entries[#entries + 1] = { index = i, name = entry.char and entry.char.name or entry.label } end
		local hit = util.pick(entries, args.character, function(e) return e.name end, nil, 'character')
		select.selIndex = hit.index
		local controls = tab.controls
		if controls.charImportTreeClearJewels then controls.charImportTreeClearJewels.state = args.clearJewels ~= false end
		if controls.charImportItemsClearSkills then controls.charImportItemsClearSkills.state = args.clearSkills ~= false end
		if controls.charImportItemsClearItems then controls.charImportItemsClearItems.state = args.clearItems ~= false end
		if controls.charImportItemsIgnoreWeaponSwap then controls.charImportItemsIgnoreWeaponSwap.state = args.ignoreWeaponSwap or false end
		local data
		util.onMain(tab.DownloadCharacter, tab, function(charData) data = charData end)
		util.check(waitFor(function() return data ~= nil or tab.charImportMode ~= 'IMPORTING' end, 60) and data, 'DOWNLOAD_FAILED', 'Character: ' .. strip(tab.charImportStatus))
		if args.tree ~= false then tab:ImportPassiveTreeAndJewels(data) end
		if args.items ~= false then tab:ImportItemsAndSkills(data) end
		util.waitFrame()
		util.recalc(build)
		return { imported = hit.name, tree = args.tree ~= false, items = args.items ~= false, summary = ops.summary(build) }
	end
end
