-- Live bridge inside the PoB window: receives operations from the PoB AI service over a
-- local TCP connection, runs them between frames and draws the agent's highlights.
local socket = require('socket')
local json = require('dkjson')
dofile(POBAI_ADAPTER .. '/core/dispatch.lua')
POBAI_RAW = { SetDrawColor = SetDrawColor, DrawString = DrawString, DrawStringWidth = DrawStringWidth }
POBAI_TEXT_DRAW = POBAI_RAW.DrawString
POBAI_OVERLAY = dofile(POBAI_ADAPTER .. '/live/overlay.lua')
POBAI_THEME = dofile(POBAI_ADAPTER .. '/live/theme.lua')
POBAI_TRANSLATE = dofile(POBAI_ADAPTER .. '/live/translate.lua')
local savedTheme = os.getenv('POBAI_THEME')
if savedTheme and savedTheme ~= '' then POBAI_THEME.apply(savedTheme) end

local port = tonumber(os.getenv('POBAI_BRIDGE_PORT') or '')
local token = os.getenv('POBAI_BRIDGE_TOKEN') or ''
local client, buffer, nextAttempt = nil, '', 0

local function send(message)
	if not client then return end
	local _, err = client:send(json.encode(message) .. '\n')
	if err then client:close() client = nil end
end

local function connect()
	if not port or GetTime() < nextAttempt then return end
	nextAttempt = GetTime() + 2000
	local tcp = socket.tcp()
	tcp:settimeout(0.2)
	if not tcp:connect('127.0.0.1', port) then tcp:close() return end
	tcp:settimeout(0)
	client, buffer = tcp, ''
	local manifest = pobai_read_file('manifest.xml') or ''
	send({ type = 'hello', token = token, version = manifest:match('<Version[^>]-number="([^"]+)"') })
end

-- One request at a time, at most one started per frame: PoB recalculates and lays out its
-- controls between frames, so the next request always sees the result of the previous one.
local job

local function finish(reply)
	job = nil
	if client then
		local _, err = client:send(reply .. '\n')
		if err then client:close() client = nil end
	end
end

local function poll()
	if not client then return connect() end
	if job then
		local reply = job.step()
		if reply then finish(reply) end
		return
	end
	while true do
		local line, err, partial = client:receive('*l')
		if not line then
			if partial and #partial > 0 then buffer = buffer .. partial end
			if err == 'closed' then client:close() client = nil job = nil end
			return
		end
		line = buffer .. line
		buffer = ''
		-- Rendered text images for the window translation arrive between requests.
		if line:find('^{"type":"rendered"') then
			local message = json.decode(line)
			if message then POBAI_TRANSLATE.onRendered(message) end
		else
			job = pobai_job(line)
			local reply = job.step()
			if reply then finish(reply) end
			return
		end
	end
end

local main = POBAI_MAIN
local frame = main.OnFrame
POBAI_FRAMES = 0
main.OnFrame = function(self, ...)
	POBAI_FRAMES = POBAI_FRAMES + 1
	local ok, err = pcall(poll)
	if not ok then pobai_log('bridge: ' .. tostring(err)) end
	frame(self, ...)
	ok, err = pcall(POBAI_OVERLAY.draw, self)
	if not ok then pobai_log('overlay: ' .. tostring(err)) end
end

-- Lets operations push events (navigation finished, build changed) to the service.
function pobai_emit(event) send({ type = 'event', event = event }) end
