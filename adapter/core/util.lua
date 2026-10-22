-- Shared helpers for operations: errors, lookups, object creation and recalculation.
local json = require('dkjson')
local util = {}

--- Raises an error the agent can act on (code + message + optional details).
function util.fail(code, message, details)
	error({ pobai = true, code = code, message = message, details = details }, 0)
end

function util.check(condition, code, message, details)
	if not condition then util.fail(code, message, details) end
	return condition
end

--- Waits one PoB frame. Live: the request pauses and resumes on the next frame (mode switches,
--- tab layout). Headless: runs a frame immediately.
function util.waitFrame(count)
	for _ = 1, count or 1 do
		if POBAI_MODE == 'headless' then pobai_frame() else coroutine.yield() end
	end
end

function util.build()
	local main = POBAI_MAIN
	local build = main.modes and main.modes.BUILD
	if main.mode ~= 'BUILD' or not build or not build.spec or not build.calcsTab then
		util.fail('NO_BUILD', 'No build is open in PoB. Open or import one first (`pob build list`, `pob build open`, `pob build import`).')
	end
	return build
end

--- Creates a PoB object on both class styles: new("X"):X(...) (0.23+) and new("X", ...) (0.22).
function util.new(className, ...)
	local ok, object = pcall(new, className)
	if ok and type(object) == 'table' and type(object[className]) == 'function' then
		return object[className](object, ...)
	end
	return new(className, ...)
end

function util.lower(text) return tostring(text or ''):lower() end
function util.contains(haystack, needle)
	if needle == nil or needle == '' then return true end
	return util.lower(haystack):find(util.lower(needle), 1, true) ~= nil
end
function util.isNull(value) return value == nil or value == json.null end

--- Recalculates now, exactly like Build:OnFrame does when buildFlag is set.
function util.recalc(build)
	build = build or util.build()
	if wipeGlobalCache then wipeGlobalCache() end
	build.outputRevision = (build.outputRevision or 0) + 1
	build.buildFlag = false
	build.calcsTab:BuildOutput()
	if build.RefreshStatList then build:RefreshStatList() end
	if build.configTab and build.calcsTab.GetMiscCalculator then
		build.configTab.calcFunc, build.configTab.calcBase = build.calcsTab:GetMiscCalculator()
	end
end

--- After an edit: record undo on the edited object (also marks the build unsaved) and recalc.
function util.changed(build, ...)
	for _, owner in ipairs({ ... }) do
		if owner and owner.AddUndoState then owner:AddUndoState() end
	end
	build.modFlag = true
	util.recalc(build)
end

--- Numeric and boolean outputs only.
function util.outputs(output, keys)
	local result = {}
	local function take(key, value)
		if type(value) == 'number' then
			if value == value and value ~= math.huge and value ~= -math.huge then result[key] = value end
		elseif type(value) == 'boolean' then
			result[key] = value
		end
	end
	if keys and #keys > 0 then
		for _, key in ipairs(keys) do take(key, util.stat(output, key)) end
	else
		for key, value in pairs(output or {}) do take(key, value) end
	end
	return result
end

--- Reads a stat by key; "Minion.TotalDPS" reads the minion's output.
function util.stat(output, key)
	if not output then return nil end
	local scope, rest = tostring(key):match('^(%w+)%.(.+)$')
	if scope and type(output[scope]) == 'table' then return output[scope][rest] end
	return output[key]
end

--- Finds one entry by exact id, exact name, then a unique partial name.
function util.pick(list, query, nameOf, idOf, what)
	local wanted = util.lower(query)
	if idOf then
		for _, entry in ipairs(list) do
			if tostring(idOf(entry)) == tostring(query) then return entry end
		end
	end
	for _, entry in ipairs(list) do
		if util.lower(nameOf(entry)) == wanted then return entry end
	end
	local matches = {}
	for _, entry in ipairs(list) do
		if util.contains(nameOf(entry), query) then matches[#matches + 1] = entry end
	end
	if #matches == 1 then return matches[1] end
	if #matches == 0 then util.fail('NOT_FOUND', ('No %s matches "%s".'):format(what, tostring(query))) end
	local names = {}
	for i = 1, math.min(#matches, 15) do names[i] = nameOf(matches[i]) end
	util.fail('AMBIGUOUS', ('"%s" matches %d %ss. Use a fuller name.'):format(tostring(query), #matches, what), { candidates = names })
end

function util.sortedKeys(tbl)
	local keys = {}
	for k in pairs(tbl or {}) do keys[#keys + 1] = k end
	table.sort(keys, function(a, b) return tostring(a) < tostring(b) end)
	return keys
end

function util.take(list, limit)
	local out = {}
	for i = 1, math.min(#list, limit or #list) do out[i] = list[i] end
	return out, #list
end

--- Lua patterns are not wanted in user text; escape for gsub/find when needed.
function util.plain(text) return (tostring(text):gsub('([%^%$%(%)%%%.%[%]%*%+%-%?])', '%%%1')) end

return util
