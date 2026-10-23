return function(adapter)
  local windows = TEST_WINDOWS
  local calls = { show = {}, focus = {}, closed = {} }
  local function read(buffer, n)
    local text, i = {}, 0
    while (not n or i < n) and buffer[i] and buffer[i] ~= 0 do
      text[#text + 1] = string.char(buffer[i]); i = i + 1
    end
    return table.concat(text)
  end
  local function write(buffer, text)
    for i = 1, #text do buffer[i - 1] = text:byte(i) end
    buffer[#text] = 0
  end
  local user = {
    AllowSetForegroundWindow = function() return 1 end,
    FindWindowExW = function(_, after, class, title)
      for i = (after or 0) + 1, #windows do
        local w = windows[i]
        if (not class or w.class == read(class)) and w.title == read(title) then return i end
      end
    end,
    GetWindowThreadProcessId = function(h, pid) pid[0] = h end,
    IsIconic = function(h) return windows[h].minimized and 1 or 0 end,
    IsWindowVisible = function(h) return windows[h].hidden and 0 or 1 end,
    ShowWindowAsync = function(h, mode) calls.show[#calls.show + 1] = {h, mode}; return 1 end,
    SetForegroundWindow = function(h) calls.focus[#calls.focus + 1] = h; return TEST_DENIED and 0 or 1 end,
  }
  local kernel = {
    OpenProcess = function(_, _, pid) if not windows[pid].unreadable then return pid end end,
    QueryFullProcessImageNameW = function(h, _, buffer, length)
      write(buffer, windows[h].exe); length[0] = #windows[h].exe; return 1
    end,
    CloseHandle = function(h) calls.closed[#calls.closed + 1] = h; return 1 end,
    WideCharToMultiByte = function(_, _, buffer, length, out)
      local text = read(buffer, length)
      if out then write(out, text) end
      return #text
    end,
  }
  package.loaded.ffi = {
    cdef = function() end,
    load = function(name) return name == 'user32' and user or kernel end,
    new = function(kind, value) return {[0] = kind == 'uint32_t[1]' and (value or 0) or 0} end,
    string = read,
  }
  return { result = dofile(adapter).focus(), calls = calls }
end
