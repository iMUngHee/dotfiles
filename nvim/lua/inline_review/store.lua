-- Append-only review logs shared between Neovim and AI agents.
--
-- One log per branch under <root>/.agents/state/review/. Every writer (this
-- module and cli.lua) goes through M.transact, which holds a mkdir lock,
-- terminates an abandoned tail line, re-reads the log and only then appends
-- one complete line with a single write. A log file only ever grows; archiving
-- keeps whole files (rotation: hard link + atomic replace, ended branch:
-- rename) and a published archive is never written again, so line numbers
-- inside one log id stay valid forever. Screen state is always derived from
-- the logs. Rules: design-contract.md and the plans' Log Protocol sections.
local M = {}

local uv = vim.uv

M.REL_DIR = ".agents/state/review"
M.LEGACY = "comments.jsonl"
M.DETACHED = ".detached"
M.ROTATE_BYTES = 512 * 1024
M.ARCHIVE_DAYS = 30

local STATUSES = { addressed = true, declined = true, question = true }
local SIDES = { before = true, after = true, empty = true }

-- Test seams: `on_locked` runs while the lock is held (to interleave writers);
-- `on_rotate(step)` runs after each rotation step ("tmp", "link") and may error.
M.on_locked = nil
M.on_rotate = nil

local function is_int(v)
  return type(v) == "number" and v == math.floor(v)
end

-- ── paths ───────────────────────────────────────────────────────────────────

function M.dir(root)
  return root .. "/" .. M.REL_DIR
end

--- File-name form of a branch: every byte outside [a-z0-9._-] (upper case
--- included, so case-insensitive file systems cannot merge two branches) as
--- %XX; long names keep a prefix plus 40 hex chars of the name's sha256
--- (Neovim ships no sha1).
function M.encode(branch)
  local enc = branch:gsub("[^a-z0-9._-]", function(c)
    return string.format("%%%02X", c:byte())
  end)
  if #enc > 200 then
    enc = enc:sub(1, 150) .. "~" .. vim.fn.sha256(branch):sub(1, 40)
  end
  return enc
end

--- Live log of `branch` (nil for a detached HEAD or no git).
function M.log_path(root, branch)
  local name = branch and M.encode(branch) or M.DETACHED
  return M.dir(root) .. "/" .. name .. ".jsonl"
end

function M.archive_dir(root)
  return M.dir(root) .. "/archive"
end

--- Repository root of a live log path, or nil when `log` is not one.
function M.root_of(log)
  local root, name = log:match("^(/.+)/%.agents/state/review/([^/]+)%.jsonl$")
  if root and name ~= "" then
    return root
  end
end

-- ── tokens ──────────────────────────────────────────────────────────────────

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

-- ── validation ──────────────────────────────────────────────────────────────

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

local function is_side(v)
  return SIDES[v] == true
end

local function is_bool(v)
  return type(v) == "boolean"
end

local VALID = {
  log = function(e)
    return is_str(e.id) and is_str(e.branch) and is_int(e.floor) and e.floor >= 0
  end,
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
      and opt(e.anchor_side, is_side)
      and opt(e.removed, is_bool)
      and opt(e.file, is_str)
  end,
  reply = function(e)
    return is_str(e.id) and is_str(e.body)
  end,
  resolve = function(e)
    return (is_str(e.id) and e.ids == nil) or (e.id == nil and is_lines(e.ids) and #e.ids > 0)
  end,
  delete = function(e)
    return is_str(e.id)
  end,
  move = function(e)
    return is_str(e.id)
      and is_range(e.l)
      and is_lines(e.snippet)
      and is_int(e.base)
      and opt(e.anchor_side, is_side)
      and opt(e.removed, is_bool)
      and opt(e.file, is_str)
  end,
}

function M.valid(e)
  return type(e) == "table" and VALID[e.ev] ~= nil and VALID[e.ev](e) and opt(e.origin, is_str)
end

-- ── reading ─────────────────────────────────────────────────────────────────

local function read_file(path)
  local f = io.open(path, "rb")
  if not f then
    return nil
  end
  local data = f:read("*a")
  f:close()
  return data
end

--- Parse a log from one read of the file. Only newline-terminated lines count;
--- an unterminated tail is left for the next read. Returns events (each with
--- `n`, its line number), the malformed line numbers and whether the file
--- exists.
function M.read(log)
  local data = read_file(log)
  local events, bad = {}, {}
  local n = 0
  for line in (data or ""):gmatch("([^\n]*)\n") do
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
  return events, bad, data ~= nil
end

--- The log's identity: its first `log` event, or nil for a headerless file.
function M.header(events)
  for _, e in ipairs(events) do
    if e.ev == "log" then
      return e
    end
  end
end

local function comment_number(id)
  return tonumber(id:match("^c(%d+)$")) or 0
end

--- Next comment id: one past max(highest cN, highest header floor).
function M.next_id(events)
  local max = 0
  for _, e in ipairs(events) do
    local n = (e.ev == "comment" and comment_number(e.id)) or (e.ev == "log" and e.floor) or 0
    if n > max then
      max = n
    end
  end
  return "c" .. (max + 1)
end

-- ── folding ─────────────────────────────────────────────────────────────────

local function user_msg(t)
  for i = #t.msgs, 1, -1 do
    if t.msgs[i].who == "you" then
      return t.msgs[i]
    end
  end
end

--- Fold events into threads. Returns threads by id, their creation order and
--- warnings for events that could not apply. Evidence entries carry `origin`,
--- the event's identity across rotations.
function M.fold(events)
  local threads = {} ---@type table<string, table>
  local order, warns = {}, {}
  local head = M.header(events)
  local log_id = head and head.id or "?"
  local function warn(msg)
    table.insert(warns, msg)
  end
  local function origin(e)
    return e.origin or (log_id .. ":" .. e.n)
  end
  local function apply(e, id, seq)
    local t = threads[id]
    if not t then
      warn("event for unknown id " .. tostring(id) .. " (line " .. e.n .. ")")
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
            origin = origin(e),
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
          origin = origin(e),
          l = e.l,
          lines = e.snippet,
          side = e.anchor_side,
          removed = e.removed == true,
          file = e.file,
        })
      end
    end
  end
  for _, e in ipairs(events) do
    if e.ev == "log" then
      -- identity only
    elseif e.ev == "comment" then
      if threads[e.id] then
        warn("duplicate comment id " .. e.id .. " (line " .. e.n .. ")")
      else
        threads[e.id] = {
          id = e.id,
          file = e.file,
          seq = 1,
          state = "draft",
          msgs = { { who = "you", seq = 1, body = e.body, ts = e.ts } },
          evidence = { { kind = "comment", n = e.n, origin = origin(e), l = e.l, lines = e.snippet } },
          snippet = e.snippet,
          l = e.l,
        }
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
    elseif e.ev == "resolve" and e.ids then
      for _, id in ipairs(e.ids) do
        apply(e, id)
      end
    elseif e.ev == "response" then
      local id, seq = M.parse_token(e.id)
      apply(e, id, seq)
    else
      apply(e, e.id)
    end
  end
  return threads, order, warns
end

function M.latest_user(t)
  return user_msg(t)
end

-- ── locking and writing ─────────────────────────────────────────────────────

local function ensure_dir(dir)
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
local function write_once(path, data, flags)
  local fd, err = uv.fs_open(path, flags or "a", 420)
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

local function base_name(log)
  return vim.fs.basename(log):gsub("%.jsonl$", "")
end

-- A free archive name for `log` with identity `id`.
local function archive_target(log, id)
  local dir = vim.fs.dirname(log) .. "/archive"
  ensure_dir(dir)
  local stem = dir .. "/" .. base_name(log) .. "." .. id
  local target, n = stem .. ".jsonl", 1
  while uv.fs_stat(target) do
    target = stem .. "." .. n .. ".jsonl"
    n = n + 1
  end
  return target
end

-- Undo an interrupted rotation without touching the live bytes: drop the tmp
-- file and any archive entry still sharing the live log's inode.
local function recover(log)
  if uv.fs_stat(log .. ".tmp") then
    uv.fs_unlink(log .. ".tmp")
  end
  local st = uv.fs_stat(log)
  if not st or st.nlink < 2 then
    return
  end
  local dir = vim.fs.dirname(log) .. "/archive"
  for name, kind in vim.fs.dir(dir) do
    local path = dir .. "/" .. name
    local ast = kind == "file" and uv.fs_stat(path)
    if ast and ast.ino == st.ino and ast.dev == st.dev then
      uv.fs_unlink(path)
    end
  end
end

local function random_id()
  local bytes = assert(uv.random(6), "no random source")
  return (bytes:gsub(".", function(c)
    return string.format("%02x", c:byte())
  end))
end

-- Rebuild the log with only open threads under a new identity; the old file
-- goes to the archive unchanged. Returns the new id, or nil + error.
local function rotate(log, events)
  local head = M.header(events)
  local threads = M.fold(events)
  local open, closed = {}, 0
  for id, t in pairs(threads) do
    if t.state == "resolved" or t.state == "deleted" then
      closed = closed + 1
    else
      open[id] = true
    end
  end
  if closed == 0 then
    return nil
  end
  local floor = 0
  for _, e in ipairs(events) do
    local n = (e.ev == "comment" and comment_number(e.id)) or (e.ev == "log" and e.floor) or 0
    floor = math.max(floor, n)
  end
  local new_id = random_id()
  local lines = { vim.json.encode({ ev = "log", id = new_id, branch = head.branch, floor = floor }) }
  local map = {}
  local function keep(e)
    local copy = vim.deepcopy(e)
    copy.n = nil
    copy.origin = e.origin or (head.id .. ":" .. e.n)
    if copy.ev == "move" then
      copy.base = map[e.base]
      if not copy.base then
        return
      end
    end
    table.insert(lines, vim.json.encode(copy))
    map[e.n] = #lines
  end
  for _, e in ipairs(events) do
    if e.ev == "log" then
      -- replaced by the new header
    elseif e.ev == "sent" or (e.ev == "resolve" and e.ids) then
      local ids = {}
      for _, token in ipairs(e.ids) do
        if open[(M.parse_token(token) or token)] then
          table.insert(ids, token)
        end
      end
      if #ids > 0 then
        local copy = vim.deepcopy(e)
        copy.ids = ids
        keep(copy)
      end
    elseif open[(e.ev == "response" and M.parse_token(e.id)) or e.id] then
      keep(e)
    end
  end
  local data = table.concat(lines, "\n") .. "\n"
  local tmp = log .. ".tmp"
  local n, err = write_once(tmp, data, "w")
  if n ~= #data then
    uv.fs_unlink(tmp)
    return nil, "tmp: " .. tostring(err or "short write")
  end
  if M.on_rotate then
    M.on_rotate("tmp")
  end
  local target = archive_target(log, head.id)
  local ok, lerr = uv.fs_link(log, target)
  if not ok then
    uv.fs_unlink(tmp)
    return nil, "link: " .. tostring(lerr)
  end
  local now = os.time()
  uv.fs_utime(target, now, now)
  if M.on_rotate then
    M.on_rotate("link")
  end
  local rok, rerr = uv.fs_rename(tmp, log)
  if not rok then
    recover(log)
    return nil, "rename: " .. tostring(rerr)
  end
  return new_id
end

--- Run `build(events, threads, order)` under the log lock and append the event
--- it returns; `build` may return nil, reason to abort without writing.
--- opts:
---   branch      branch name recorded in a new header; a header naming another
---               branch aborts with "collision"
---   expect_id   refuse with "changed" unless the header id matches, and with
---               "missing" when the log does not exist — both before any byte
---               of the log is touched
---   create      false: never create the directory or the log
---   check       function() -> true | reason, run under the lock first
---   rotate_bytes  override the rotation threshold
--- Returns event, nil, nil, info  where info = { id = final log id,
--- rotated = bool, rotate_error = string? }; or nil plus one of "locked",
--- "missing", "changed", "collision", "aborted" (with reason), "incomplete",
--- or an error string.
function M.transact(log, build, opts)
  opts = opts or {}
  local dir = vim.fs.dirname(log)
  if opts.create == false then
    if vim.fn.isdirectory(dir) == 0 then
      return nil, "missing"
    end
  else
    ensure_dir(dir)
  end
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
      recover(log)
      if opts.check then
        local fine = opts.check()
        if fine ~= true then
          return nil, "changed", fine
        end
      end
      local events, _, exists = M.read(log)
      if opts.expect_id or opts.create == false then
        if not exists then
          return nil, "missing"
        end
        local head = M.header(events)
        if opts.expect_id and (not head or head.id ~= opts.expect_id) then
          return nil, "changed"
        end
      end
      local head = M.header(events)
      if head and opts.branch and head.branch ~= opts.branch then
        return nil, "collision"
      end
      local repaired, rerr = repair_tail(log)
      if not repaired then
        return nil, rerr
      end
      events = M.read(log)
      local threads, order = M.fold(events)
      local ev, reason = build(events, threads, order)
      if not ev then
        return nil, "aborted", reason
      end
      if not head then
        -- New log, or a headerless one (legacy, interrupted migration): adopt
        -- it, but only when there is something to write.
        head = { ev = "log", id = random_id(), branch = opts.branch or "", floor = 0 }
        local hline = vim.json.encode(head) .. "\n"
        local hn = M.write_once(log, hline)
        if hn ~= #hline then
          return nil, "incomplete"
        end
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
      local info = { id = M.header(M.read(log)).id, rotated = false }
      local st = uv.fs_stat(log)
      if st and st.size > (opts.rotate_bytes or M.ROTATE_BYTES) then
        local rok, new_id, rerr = pcall(rotate, log, M.read(log))
        if rok and new_id then
          info.id, info.rotated = new_id, true
        elseif not rok or rerr then
          info.rotate_error = tostring(rok and rerr or new_id)
        end
      end
      return ev, nil, nil, info
    end, debug.traceback),
  }
  uv.fs_rmdir(lock)
  if not res[1] then
    return nil, res[2]
  end
  return res[2], res[3], res[4], res[5]
end

function M.unlock(log)
  return uv.fs_rmdir(log .. ".lock")
end

-- ── branch lifecycle ────────────────────────────────────────────────────────

--- Rename the headerless legacy log to `target`, holding both locks in path
--- order. Returns "moved", "none", "both" (target already exists) or "locked".
function M.migrate_legacy(root, target)
  local legacy = M.dir(root) .. "/" .. M.LEGACY
  if legacy == target or not uv.fs_stat(legacy) or M.header(M.read(legacy)) then
    return "none"
  end
  if uv.fs_stat(target) then
    return "both"
  end
  local locks = { legacy .. ".lock", target .. ".lock" }
  table.sort(locks)
  local held = {}
  for _, l in ipairs(locks) do
    if not acquire(l) then
      for _, h in ipairs(held) do
        uv.fs_rmdir(h)
      end
      return "locked"
    end
    table.insert(held, l)
  end
  local status = "none"
  if uv.fs_stat(legacy) and not M.header(M.read(legacy)) and not uv.fs_stat(target) then
    if uv.fs_rename(legacy, target) then
      status = "moved"
    end
  elseif uv.fs_stat(target) then
    status = "both"
  end
  for _, h in ipairs(held) do
    uv.fs_rmdir(h)
  end
  return status
end

--- Archive logs whose branch no longer exists. `alive()` returns a set of live
--- branch names, or nil when git could not tell — then nothing is archived.
--- Returns the archived branch names.
function M.archive_ended(root, alive)
  local dir = M.dir(root)
  local set = alive()
  local done = {}
  if not set or vim.fn.isdirectory(dir) == 0 then
    return done
  end
  for name, kind in vim.fs.dir(dir) do
    local log = dir .. "/" .. name
    local head = kind == "file" and name:match("%.jsonl$") and name ~= M.LEGACY and M.header(M.read(log))
    if head and head.branch ~= "" and not set[head.branch] and acquire(log .. ".lock") then
      recover(log)
      local now_head = M.header(M.read(log))
      local again = alive()
      if now_head and again and not again[now_head.branch] then
        local now = os.time()
        uv.fs_utime(log, now, now)
        if uv.fs_rename(log, archive_target(log, now_head.id)) then
          table.insert(done, now_head.branch)
        end
      end
      uv.fs_rmdir(log .. ".lock")
    end
  end
  return done
end

--- Delete archives that entered the archive more than `days` ago; skips files
--- still shared with a live log (an unfinished rotation).
function M.prune(root, days, now)
  local dir = M.archive_dir(root)
  local cutoff = (now or os.time()) - (days or M.ARCHIVE_DAYS) * 86400
  local removed = {}
  if vim.fn.isdirectory(dir) == 0 then
    return removed
  end
  for name, kind in vim.fs.dir(dir) do
    local path = dir .. "/" .. name
    local st = kind == "file" and name:match("%.jsonl$") and uv.fs_stat(path)
    if st and st.nlink < 2 and st.mtime.sec < cutoff then
      uv.fs_unlink(path)
      table.insert(removed, name)
    end
  end
  return removed
end

--- Every log file of `root`: live ones first, then archives. Each entry is
--- { path, archived, events, head }.
function M.all_logs(root)
  local out = {}
  for _, sub in ipairs({ "", "/archive" }) do
    local dir = M.dir(root) .. sub
    if vim.fn.isdirectory(dir) == 1 then
      for name, kind in vim.fs.dir(dir) do
        if kind == "file" and name:match("%.jsonl$") then
          local path = dir .. "/" .. name
          local events = M.read(path)
          table.insert(out, { path = path, archived = sub ~= "", events = events, head = M.header(events) })
        end
      end
    end
  end
  return out
end

-- ── prompt ──────────────────────────────────────────────────────────────────

local function range_ref(l)
  return l[1] == l[2] and ("L" .. l[1]) or ("L" .. l[1] .. "-" .. l[2])
end
M.range_ref = range_ref

function M.prompt_head(log, id)
  return "Review comments — handle each with the inline-review skill, then record one response per token with its respond command (log: "
    .. log
    .. ", id: "
    .. id
    .. ")"
end

--- Prompt body lines for `items` ({ thread, l = current range } list).
function M.prompt_body(items)
  local out = {}
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

function M.prompt(items, log, id)
  return M.prompt_head(log, id) .. "\n" .. M.prompt_body(items)
end

return M
