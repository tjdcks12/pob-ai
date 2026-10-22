-- Routes one JSON request to an operation and produces one JSON reply.
-- Shared by the headless engine and the live bridge inside the PoB window. Operations run in
-- a coroutine so they can wait for PoB frames (util.waitFrame) in the live window.
local json = require('dkjson')
local ops = dofile(POBAI_ADAPTER .. '/core/ops.lua')
POBAI_OPS = ops

local function sanitize(value, seen, depth)
	local kind = type(value)
	if kind == 'number' then
		if value ~= value or value == math.huge or value == -math.huge then return nil end
		return value
	end
	if kind == 'string' or kind == 'boolean' then return value end
	if kind ~= 'table' or depth > 14 then return nil end
	if value == json.null then return value end
	if seen[value] then return nil end
	seen[value] = true
	local out = {}
	for k, v in pairs(value) do
		if type(k) == 'string' or type(k) == 'number' then out[k] = sanitize(v, seen, depth + 1) end
	end
	seen[value] = nil
	return setmetatable(out, getmetatable(value))
end

local function encode(reply)
	local text, err = json.encode(reply, { exception = function() return 'null' end })
	return text or json.encode({ id = reply.id, ok = false, error = { code = 'ENCODE_FAILED', message = tostring(err) } })
end

local function errorReply(id, err)
	if type(err) == 'table' and err.pobai then
		return { id = id, ok = false, error = { code = err.code, message = err.message, details = err.details } }
	end
	local text = tostring(err)
	pobai_log(text)
	local message = text:match('^[^\n]*'):gsub('^[^:]*%.lua:%d+: ', '')
	return { id = id, ok = false, error = { code = 'OP_FAILED', message = message } }
end

--- Starts a request. Returns a job; job.step() returns the reply text once the op finished.
function pobai_job(text)
	local request, _, decodeError = json.decode(text, 1, json.null)
	if type(request) ~= 'table' then
		local reply = encode({ id = json.null, ok = false, error = { code = 'BAD_REQUEST', message = tostring(decodeError) } })
		return { step = function() return reply end }
	end
	local op = ops[request.op]
	if not op then
		local reply = encode({ id = request.id, ok = false, error = { code = 'UNKNOWN_OP', message = 'Unknown operation: ' .. tostring(request.op) } })
		return { step = function() return reply end }
	end
	local co = coroutine.create(function() return op(request.args or {}) end)
	return {
		step = function()
			local ok, result = coroutine.resume(co)
			-- util.onMain yields a function: run it on PoB's main thread and hand back its result.
			while ok and coroutine.status(co) == 'suspended' and type(result) == 'function' do
				local packed = { pcall(result) }
				ok, result = coroutine.resume(co, packed)
			end
			if ok and coroutine.status(co) == 'suspended' then return nil end
			if ok then return encode({ id = request.id, ok = true, result = sanitize(result, {}, 0) }) end
			if type(result) ~= 'table' then result = debug.traceback(co, tostring(result)) end
			return encode(errorReply(request.id, result))
		end,
	}
end

--- Headless: runs the request to completion (waitFrame never yields there).
function pobai_dispatch(text)
	local job = pobai_job(text)
	local reply = job.step()
	while not reply do reply = job.step() end
	return reply
end
