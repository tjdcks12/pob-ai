-- Build notes (NotesTab.lua). The edit control holds the text.
return function(ops, util)
	local function control(build)
		return util.check(build.notesTab and build.notesTab.controls and build.notesTab.controls.edit, 'NOT_AVAILABLE', 'This PoB version has no notes tab.')
	end

	ops['notes.get'] = function()
		local build = util.build()
		return { text = control(build).buf or '' }
	end

	ops['notes.set'] = function(args)
		local build = util.build()
		local edit = control(build)
		local text = args.append and ((edit.buf or '') .. ((edit.buf or '') ~= '' and '\n' or '') .. args.text) or args.text
		edit:SetText(text)
		build.notesTab.modFlag = true
		build.notesTab.lastContent = nil
		build.modFlag = true
		return { text = edit.buf }
	end
end
