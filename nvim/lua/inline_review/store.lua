-- Append-only review log shared between Neovim and AI agents.
--
-- Every writer (this module and cli.lua) goes through M.transact, which holds
-- a mkdir lock, terminates an abandoned tail line, re-reads the log and only
-- then appends one complete line with a single write. Screen state is always
-- derived from the log, never from what a writer believes it wrote. The rules
-- are spelled out in design-contract.md and the plan's Log Protocol.
local M = {}

local uv = vim.uv

M.REL_LOG = ".agents/state/review/comments.jsonl"

local STATUSES = { addressed = true, declined = true, question = true }
local SIDES = { before = true, after = true, empty = true }

local function is_int(v)
  return type(v) == "number" and v == math.floor(v)
end

-- Test seam: called while the lock is held, so tests can interleave writers.
M.on_locked = nil

function M.log_path(root)
  return root .. "/" .. M.REL_LOG
end

-- "c3" -> "c3", 1 ; "c3.2" -> "c3", 2
function M.parse_token(token)
  if type(token) ~= "string" then
    return nil
  end
  local id, seq = token:match("^(c%d+)%.(%d+)$")
  if id then
    return id, tonumber(seq)
  end
  if token:match("^c%d+$") then
    return token, 1
  end
end

function M.token(id, seq)
  return seq > 1 and (id .. "." .. seq) or id
end

local function is_range(l)
  return type(l) == "table" and #l == 2 and is_int(l[1]) and is_int(l[2]) and l[1] >= 1 and l[1] <= l[2]
end

local function is_str(v)
  return type(v) == "string"
end

local function opt(v, pred)
  return v == nil or pred(v)
end

local function is_lines(v)
  if type(v) ~= "table" then
    return false
  end
  for _, s in ipairs(v) do
    if type(s) ~= "string" then
      return false
    end
  end
  return true
end

local VALID = {
  comment = function(e)
    return is_str(e.id) and is_str(e.file) and is_range(e.l) and is_lines(e.snippet) and is_str(e.body)
  end,
  edit = function(e)
    return is_str(e.id) and is_int(e.seq) and is_str(e.body)
  end,
  sent = function(e)
    return is_lines(e.ids) and #e.ids > 0
  end,
  response = function(e)
    return M.parse_token(e.id) ~= nil
      and STATUSES[e.status] == true
      and is_str(e.summary)
      and opt(e.l, is_range)
      and opt(e.anchor, is_str)
      and opt(e.anchor_side, function(v)
        return SIDES[v] == true
      end)
      and opt(e.removed, function(v)
        return type(v) == "boolean"
      end)
      and opt(e.file, is_str)
  end,
  reply = function(e)
    return is_str(e.id) and is_str(e.body)
  end,
  resolve = function(e)
    return is_str(e.id)
  end,
  delete = function(e)
    return is_str(e.id)
  end,
  move = function(e)
    return is_str(e.id)
      and is_range(e.l)
      and is_lines(e.snippet)
      and is_int(e.base)
      and opt(e.anchor_side, function(v)
        return SIDES[v] == true
      end)
      and opt(e.removed, function(v)
        return type(v) == "boolean"
      end)
      and opt(e.file, is_str)
  end,
}

function M.valid(e)
  return type(e) == "table" and VALID[e.ev] ~= nil and VALID[e.ev](e)
end

local function read_file(path)
  local f = io.open(path, "rb")
  if not f then
    return nil
  end
  local data = f:read("*a")
  f:close()
  return data
end

--- Parse the log. Only newline-terminated lines count; an unterminated tail is
--- left for the next read. Returns events (each with `n`, its line number) and
--- the line numbers that were skipped as malformed.
function M.read(log)
  local data = read_file(log) or ""
  local events, bad = {}, {}
  local n = 0
  for line in data:gmatch("([^\n]*)\n") do
    n = n + 1
    if line:match("%S") then
      local ok, ev = pcall(vim.json.decode, line, { luanil = { object = true, array = true } })
      if ok and M.valid(ev) then
        ev.n = n
        table.insert(events, ev)
      else
        table.insert(bad, n)
      end
    end
  end
  return events, bad
end

local function user_msg(t)
  for i = #t.msgs, 1, -1 do
    if t.msgs[i].who == "you" then
      return t.msgs[i]
    end
  end
end

--- Fold events into threads. Returns threads by id, their creation order and
--- warnings for events that could not apply.
function M.fold(events)
  local threads = {} ---@type table<string, table>
  local order, warns = {}, {}
  local function warn(msg)
    table.insert(warns, msg)
  end
  for _, e in ipairs(events) do
    if e.ev == "comment" then
      if threads[e.id] then
        warn("duplicate comment id " .. e.id .. " (line " .. e.n .. ")")
      else
        local t = {
          id = e.id,
          file = e.file,
          seq = 1,
          state = "draft",
          msgs = { { who = "you", seq = 1, body = e.body, ts = e.ts } },
          evidence = { { kind = "comment", n = e.n, l = e.l, lines = e.snippet } },
          snippet = e.snippet,
          l = e.l,
        }
        threads[e.id] = t
        table.insert(order, e.id)
      end
    elseif e.ev == "sent" then
      for _, token in ipairs(e.ids) do
        local tid, tseq = M.parse_token(token)
        local st = tid and threads[tid]
        if st and st.state == "draft" and st.seq == tseq then
          st.state = "sent"
        end
      end
    else
      local id, seq = e.id, nil
      if e.ev == "response" then
        id, seq = M.parse_token(e.id)
      end
      local t = threads[id]
      if not t then
        warn("event for unknown id " .. tostring(e.id) .. " (line " .. e.n .. ")")
      elseif t.state == "deleted" then
        if e.ev == "response" then
          table.insert(t.msgs, { who = "agent", seq = seq, status = e.status, summary = e.summary, stale = true })
        end
      elseif e.ev == "edit" then
        local m = user_msg(t)
        if t.state == "draft" and e.seq == t.seq and m then
          m.body = e.body
        else
          warn("edit for " .. t.id .. " ignored: message already sent (line " .. e.n .. ")")
        end
      elseif e.ev == "reply" then
        t.seq = t.seq + 1
        t.state = "draft"
        table.insert(t.msgs, { who = "you", seq = t.seq, body = e.body, ts = e.ts })
      elseif e.ev == "resolve" then
        t.state = "resolved"
      elseif e.ev == "delete" then
        t.state = "deleted"
      elseif e.ev == "response" then
        local current = seq == t.seq and (t.state == "sent" or t.state == "answered")
        table.insert(t.msgs, {
          who = "agent",
          seq = seq,
          status = e.status,
          summary = e.summary,
          ts = e.ts,
          stale = not current,
        })
        if current then
          t.state = "answered"
          t.status = e.status
          if e.l and e.anchor then
            if e.file then
              t.file = e.file
            end
            table.insert(t.evidence, {
              kind = "response",
              n = e.n,
              l = e.l,
              lines = { e.anchor },
              side = e.anchor_side,
              removed = e.removed == true,
              file = e.file,
            })
          end
        end
      elseif e.ev == "move" then
        local latest = t.evidence[#t.evidence]
        if latest.n == e.base then
          if e.file then
            t.file = e.file
          end
          table.insert(t.evidence, {
            kind = "move",
            n = e.n,
            l = e.l,
            lines = e.snippet,
            side = e.anchor_side,
            removed = e.removed == true,
            file = e.file,
          })
        end
      end
    end
  end
  return threads, order, warns
end

function M.latest_user(t)
  return user_msg(t)
end

local function ensure_dir(log)
  local dir = vim.fs.dirname(log)
  if vim.fn.isdirectory(dir) == 0 then
    vim.fn.mkdir(dir, "p")
  end
  local ignore = dir .. "/.gitignore"
  if not uv.fs_stat(ignore) then
    local f = io.open(ignore, "w")
    if f then
      f:write("*\n")
      f:close()
    end
  end
end

local LOCK_WAIT_MS = 2000

local function acquire(lock)
  local deadline = uv.hrtime() + LOCK_WAIT_MS * 1e6
  while true do
    local ok, err = uv.fs_mkdir(lock, 448)
    if ok then
      return true
    end
    if not tostring(err):match("EEXIST") then
      return nil, tostring(err)
    end
    if uv.hrtime() > deadline then
      return nil, "locked"
    end
    uv.sleep(50)
  end
end

-- Write `data` with one write call; returns bytes written or nil, err.
local function write_once(path, data)
  local fd, err = uv.fs_open(path, "a", 420)
  if not fd then
    return nil, err
  end
  local n, werr = uv.fs_write(fd, data)
  uv.fs_close(fd)
  if not n then
    return nil, werr
  end
  return n
end

-- Seam for tests that simulate short writes.
M.write_once = write_once

-- Terminate an unterminated tail so it cannot swallow the next record.
local function repair_tail(log)
  local st = uv.fs_stat(log)
  if not st or st.size == 0 then
    return true
  end
  local fd = uv.fs_open(log, "r", 420)
  if not fd then
    return nil, "cannot read " .. log
  end
  local last = uv.fs_read(fd, 1, st.size - 1)
  uv.fs_close(fd)
  if last == "\n" then
    return true
  end
  local n, err = M.write_once(log, "\n")
  if n ~= 1 then
    return nil, err or "short write"
  end
  return true
end

--- Run `build(events, threads, order)` under the log lock and append the event
--- it returns. `build` may return nil, reason to abort without writing.
--- Returns the written event, or nil plus one of:
---   "locked" | "aborted" (with reason) | "incomplete" | an error string.
function M.transact(log, build)
  ensure_dir(log)
  local lock = log .. ".lock"
  local ok, err = acquire(lock)
  if not ok then
    return nil, err
  end
  local res = {
    xpcall(function()
      if M.on_locked then
        M.on_locked()
      end
      local repaired, rerr = repair_tail(log)
      if not repaired then
        return nil, rerr
      end
      local events = M.read(log)
      local threads, order = M.fold(events)
      local ev, reason = build(events, threads, order)
      if not ev then
        return nil, "aborted", reason
      end
      ev.ts = ev.ts or os.time()
      local line = vim.json.encode(ev) .. "\n"
      local n, werr = M.write_once(log, line)
      if not n then
        return nil, tostring(werr)
      end
      if n < #line then
        return nil, "incomplete"
      end
      return ev
    end, debug.traceback),
  }
  uv.fs_rmdir(lock)
  if not res[1] then
    return nil, res[2]
  end
  return res[2], res[3], res[4]
end

--- Next comment id: one past the highest cN in the log.
function M.next_id(events)
  local max = 0
  for _, e in ipairs(events) do
    if e.ev == "comment" then
      local n = tonumber(e.id:match("^c(%d+)$"))
      if n and n > max then
        max = n
      end
    end
  end
  return "c" .. (max + 1)
end

M.PROMPT_HEAD = "Review comments — handle each with the inline-review skill,"
  .. " then record one response per token with its respond command (log: "
  .. M.REL_LOG
  .. ")"

local function range_ref(l)
  return l[1] == l[2] and ("L" .. l[1]) or ("L" .. l[1] .. "-" .. l[2])
end
M.range_ref = range_ref

--- Build the prompt for `items` ({ thread, l = current range } list).
function M.prompt(items)
  local out = { M.PROMPT_HEAD }
  for _, it in ipairs(items) do
    local t = it.thread
    local m = user_msg(t)
    local follow = ""
    if t.seq > 1 then
      for i = #t.msgs, 1, -1 do
        local a = t.msgs[i]
        if a.who == "agent" and a.seq == t.seq - 1 then
          follow = string.format('(follow-up; your last: "%s") ', a.summary)
          break
        end
      end
    end
    table.insert(
      out,
      string.format("[%s] @%s#%s %s%s", M.token(t.id, t.seq), t.file, range_ref(it.l or t.l), follow, m.body)
    )
  end
  return table.concat(out, "\n")
end

function M.unlock(log)
  return uv.fs_rmdir(log .. ".lock")
end

return M
