-- Ctrl+V on the Items tab with a copy from a non-English game client: PoB cannot read it, so the
-- text goes to the service, which converts it like `items add` (src/items/prepare.mjs) and sends
-- the English text back. PoB's own result is kept whenever it already read the copy.
local paste = {}
local itemsTabClass, create, add
local pending, nextId, deferredAddFrame = {}, 0, nil

function paste.install()
	local class = common and common.classes and common.classes.ItemsTab
	if not class or class == itemsTabClass then return end
	itemsTabClass, create, add = class, class.CreateDisplayItemFromRaw, class.AddDisplayItem
	class.CreateDisplayItemFromRaw = function(self, itemRaw, normalise, ...)
		local before = self.displayItem
		create(self, itemRaw, normalise, ...)
		if self.displayItem ~= before or type(itemRaw) ~= 'string' or not itemRaw:find('%S') or not pobai_emit then return end
		nextId = nextId + 1
		if not pobai_emit({ kind = 'item-paste', id = nextId, text = itemRaw }) then return end
		pending[nextId] = { tab = self, normalise = normalise, add = IsKeyDown('SHIFT') }
		deferredAddFrame = POBAI_FRAMES
	end
	-- Ctrl+Shift+V adds the display item right after pasting; that would add the previous item.
	-- The converted item is added when it arrives instead.
	class.AddDisplayItem = function(self, ...)
		if deferredAddFrame == POBAI_FRAMES then return end
		return add(self, ...)
	end
end

--- The service's answer (bridge.lua routes every {"type":"item-converted"} line here).
function paste.onConverted(message)
	local job = pending[message.id]
	pending[message.id] = nil
	if not job or type(message.text) ~= 'string' then return end
	create(job.tab, message.text, job.normalise)
	if job.add and job.tab.displayItem then add(job.tab) end
end

return paste
