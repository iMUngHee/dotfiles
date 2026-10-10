-- inline_review: review comments anchored to code ranges, sent to an AI agent
-- as one prompt, with the agent's responses shown back at each location.
-- Threads live in one log per branch. Experience/interface decisions:
-- design-contract.md in this directory.
local store = require("inline_review.store")
local view = require("inline_review.view")
local file_ref = require("utils.file_ref")

local api = vim.api
local uv = vim.uv
local M = {}

M.show_resolved = false

local CLEANUP_EVERY_S = 600

-- repos[root] = { root, branch, log, log_id, threads, order, mtime, git_dir,
--                 seen_bad, seen_warn, watch, cleaned_at }
local repos = {}

local function notify(msg, level)
  vim.notify(msg, level or vim.log.levels.INFO, { title = "inline-review" })
end

local function repo_root(buf)
  return (vim.fn.resolve(file_ref.root(buf)):gsub("/$", ""))
end

local function mtime(path)
  local st = uv.fs_stat(path)
  return st and (st.mtime.sec * 1e9 + st.mtime.nsec + st.size) or 0
end

local function git(root, args)
  local r = vim.system(vim.list_extend({ "git", "-C", root }, args), { text = true }):wait(5000)
  if r.code ~= 0 then
    return nil
  end
  return r.stdout
end

-- ── branch ──────────────────────────────────────────────────────────────────

local UNKNOWN = {}

--- Current branch of `root`: a name, nil (detached HEAD or no git), or
--- UNKNOWN when HEAD could not be read.
local function current_branch(r)
  if r.git_dir == nil then
    local out = git(r.root, { "rev-parse", "--absolute-git-dir" })
    r.git_dir = out and vim.trim(out) or false
  end
  if not r.git_dir then
    return nil
  end
  local f = io.open(r.git_dir .. "/HEAD", "r")
  if not f then
    return UNKNOWN
  end
  local head = f:read("*l") or ""
  f:close()
  return head:match("^ref: refs/heads/(.+)$")
end

local function branch_label(b)
  return b or "detached"
end

local function repo(root)
  local r = repos[root]
  if not r then
    r = { root = root, threads = {}, order = {}, mtime = -1, seen_bad = {}, seen_warn = {} }
    repos[root] = r
  end
  return r
end

local function buffers_of(root)
  local out = {}
  for _, buf in ipairs(api.nvim_list_bufs()) do
    if api.nvim_buf_is_loaded(buf) and vim.bo[buf].buftype == "" and api.nvim_buf_get_name(buf) ~= "" then
      if repo_root(buf) == root then
        table.insert(out, buf)
      end
    end
  end
  return out
end

local ensure_watch

--- Re-read the current branch's log of `root` and fold it. A branch switch
--- swaps the log, drops tracked positions (they belonged to other threads) and
--- is announced once; warns once per malformed line.
function M.refresh(root)
  local r = repo(root)
  local b = current_branch(r)
  if b == UNKNOWN then
    r.unknown = true
    return r
  end
  r.unknown = false
  local log = store.log_path(root, b)
  if r.log and r.log ~= log then
    for _, buf in ipairs(buffers_of(root)) do
      view.forget(buf)
    end
    if r.watch then
      r.watch.handle:stop()
      r.watch.timer:stop()
      r.watch.handle:close()
      r.watch.timer:close()
      r.watch = nil
    end
    notify("Review threads: " .. branch_label(b))
  end
  if r.log ~= log then
    r.seen_bad, r.seen_warn = {}, {}
    if store.migrate_legacy(root, log) == "both" and not r.legacy_warned then
      r.legacy_warned = true
      notify(
        "inline-review: both " .. store.LEGACY .. " and the branch log exist; the legacy file is left alone",
        vim.log.levels.WARN
      )
    end
  end
  r.branch, r.log = b, log
  local events, bad = store.read(log)
  local head = store.header(events)
  if head and head.branch ~= (b or "") and not r.seen_warn.collision then
    r.seen_warn.collision = true
    notify("Review log name collision for " .. branch_label(b), vim.log.levels.WARN)
  end
  local threads, order, warns = store.fold(events)
  r.threads, r.order, r.mtime, r.log_id = threads, order, mtime(log), head and head.id or nil
  for _, n in ipairs(bad) do
    if not r.seen_bad[n] then
      r.seen_bad[n] = true
      notify("inline-review: skipped malformed line " .. n, vim.log.levels.WARN)
    end
  end
  for _, w in ipairs(warns) do
    if not r.seen_warn[w] then
      r.seen_warn[w] = true
      notify("inline-review: " .. w, vim.log.levels.WARN)
    end
  end
  return r
end

local record_move

local function render_buf(buf)
  if not api.nvim_buf_is_loaded(buf) or vim.bo[buf].buftype ~= "" then
    return
  end
  local name = api.nvim_buf_get_name(buf)
  if name == "" then
    return
  end
  local root = repo_root(buf)
  local r = repos[root]
  if not r or not r.log then
    return
  end
  local rel = file_ref.relative(root, name)
  if not rel then
    return
  end
  view.render(buf, r, rel, {
    show_resolved = M.show_resolved,
    gen = r.log_id,
    on_move = function(t, res, latest)
      local capture = { log = r.log, id = r.log_id, branch = r.branch }
      vim.schedule(function()
        record_move(buf, root, capture, t.id, res, latest)
      end)
    end,
  })
end

function M.render_root(root)
  for _, buf in ipairs(buffers_of(root)) do
    render_buf(buf)
  end
end

-- Buffers whose text differs from disk get a checktime; their reload
-- autocommand re-anchors once the text is actually current.
local function sync_root(root)
  for _, buf in ipairs(buffers_of(root)) do
    if view.synced(buf) == false and not vim.bo[buf].modified then
      pcall(function()
        vim.cmd("checktime " .. buf)
      end)
    end
  end
  M.render_root(root)
end

-- ── writes ──────────────────────────────────────────────────────────────────

--- What a deferred action writes to: the log, its identity and the branch at
--- the moment the action started.
local function capture(r)
  return { root = r.root, log = r.log, id = r.log_id, branch = r.branch }
end

--- Append through the store lock to the captured log. `cross` marks an
--- explicit write to another branch's log (picker), which skips the branch
--- check. Reports failures in the contract's words.
local function commit(cap, build, cross)
  local r = repo(cap.root)
  if r.unknown and not cross then
    notify("inline-review: could not read HEAD; not writing", vim.log.levels.ERROR)
    return nil, "changed"
  end
  local opts = { branch = cap.branch or "", expect_id = cap.id }
  if not cross then
    opts.check = function()
      local now = current_branch(r)
      return (now ~= UNKNOWN and now == cap.branch) or "branch switched"
    end
  end
  local ev, err, reason, info = store.transact(cap.log, build, opts)
  if not ev then
    if err == "locked" then
      notify(
        string.format(
          "inline-review: log is locked (%s.lock); run :InlineReviewUnlock if no writer is running",
          cap.log
        ),
        vim.log.levels.WARN
      )
    elseif err == "changed" or err == "missing" then
      notify("Review log changed (branch switch or rotation); try again", vim.log.levels.WARN)
    elseif err == "collision" then
      notify("Review log name collision for " .. branch_label(cap.branch), vim.log.levels.WARN)
    elseif err == "incomplete" then
      notify("inline-review: write may be incomplete " .. cap.log, vim.log.levels.WARN)
    elseif err ~= "aborted" then
      notify("inline-review: could not write " .. cap.log .. ": " .. tostring(err), vim.log.levels.ERROR)
    end
  elseif info and info.rotate_error then
    notify("Review log rotation failed: " .. info.rotate_error, vim.log.levels.WARN)
  end
  M.refresh(cap.root)
  ensure_watch(cap.root)
  M.render_root(cap.root)
  return ev, err, reason, info
end

-- Persist a verified position, only if its evidence is still the newest, the
-- log generation and branch are unchanged and the buffer still matches disk.
function record_move(buf, root, cap, id, res, latest)
  if not api.nvim_buf_is_loaded(buf) or view.synced(buf) ~= true or not cap.id then
    return
  end
  local lines = api.nvim_buf_get_lines(buf, 0, -1, false)
  local ev = { ev = "move", id = id, l = { res.s, res.e }, base = latest.n }
  if res.removed then
    ev.removed = true
    local p = math.min(res.s, #lines + 1)
    ev.l = { math.max(p, 1), math.max(p, 1) }
    if p > 1 then
      ev.anchor_side, ev.snippet = "before", { lines[p - 1] }
    elseif #lines > 0 and not (#lines == 1 and lines[1] == "") then
      ev.anchor_side, ev.snippet = "after", { lines[1] }
    else
      ev.anchor_side, ev.snippet = "empty", { "" }
    end
  else
    ev.snippet = vim.list_slice(lines, res.s, res.e)
  end
  commit(vim.tbl_extend("force", cap, { root = root }), function(_, threads)
    local t = threads[id]
    if not t then
      return nil, "gone"
    end
    local now = t.evidence[#t.evidence]
    if now.n ~= latest.n or view.synced(buf) ~= true then
      return nil, "stale"
    end
    if now.kind == "move" and vim.deep_equal(now.l, ev.l) and vim.deep_equal(now.lines, ev.snippet) then
      return nil, "same"
    end
    return ev
  end)
end

-- After a save, persist ranges that moved while editing.
local function record_edits(buf)
  local root = repo_root(buf)
  local r = repos[root]
  if not r or not r.log then
    return
  end
  for _, id in ipairs(view.tracked_ids(buf)) do
    local t = r.threads[id]
    local s, e, tr = view.position(buf, id)
    if t and s and tr and tr.gen == r.log_id then
      local latest = t.evidence[#t.evidence]
      local lines = api.nvim_buf_get_lines(buf, s - 1, e or s, false)
      if tr.n == latest.n and not tr.estimated and not (s == latest.l[1] and vim.deep_equal(lines, latest.lines)) then
        record_move(buf, root, capture(r), id, { s = s, e = e, removed = tr.removed }, latest)
      end
    end
  end
end

-- ── lifecycle ───────────────────────────────────────────────────────────────

-- Branches that still exist anywhere: local refs plus every worktree's HEAD.
local function alive(root)
  return function()
    local refs = git(root, { "for-each-ref", "--format=%(refname:short)", "refs/heads" })
    local wts = git(root, { "worktree", "list", "--porcelain" })
    if not refs or not wts then
      return nil
    end
    local set = {}
    for name in refs:gmatch("[^\n]+") do
      set[name] = true
    end
    for name in wts:gmatch("branch refs/heads/([^\n]+)") do
      set[name] = true
    end
    return set
  end
end

local function cleanup(root)
  local r = repo(root)
  if r.git_dir == false or (r.cleaned_at and os.time() - r.cleaned_at < CLEANUP_EVERY_S) then
    return
  end
  r.cleaned_at = os.time()
  store.archive_ended(root, alive(root))
  store.prune(root)
end

-- ── watching ────────────────────────────────────────────────────────────────

function ensure_watch(root)
  local r = repo(root)
  if r.watch or not r.log then
    return
  end
  local dir = vim.fs.dirname(r.log)
  if vim.fn.isdirectory(dir) == 0 then
    return
  end
  local handle = uv.new_fs_event()
  local timer = uv.new_timer()
  if not handle or not timer then
    return
  end
  local live = vim.fs.basename(r.log)
  r.watch = { handle = handle, timer = timer }
  local function start()
    handle:start(
      dir,
      {},
      vim.schedule_wrap(function(err, fname)
        if err or (fname and fname ~= live) then
          return
        end
        timer:stop()
        timer:start(
          100,
          0,
          vim.schedule_wrap(function()
            if not r.watch or r.watch.handle ~= handle then
              return
            end
            -- Re-arm: a replaced file can drop the kernel watch.
            handle:stop()
            start()
            if mtime(r.log) ~= r.mtime then
              M.refresh(root)
              sync_root(root)
            end
          end)
        )
      end)
    )
  end
  start()
end

local function stop_watches()
  for _, r in pairs(repos) do
    if r.watch then
      r.watch.handle:stop()
      r.watch.timer:stop()
      r.watch.handle:close()
      r.watch.timer:close()
      r.watch = nil
    end
  end
end

-- Pick up branch switches and log changes a watcher may have missed.
local function poll(buf, focus)
  if vim.bo[buf].buftype ~= "" or api.nvim_buf_get_name(buf) == "" then
    return
  end
  local root = repo_root(buf)
  local r = repo(root)
  local b = current_branch(r)
  if
    not r.log
    or b == UNKNOWN
    or store.log_path(root, b ~= UNKNOWN and b or nil) ~= r.log
    or mtime(r.log) ~= r.mtime
  then
    M.refresh(root)
  end
  if focus or not r.cleaned_at then
    cleanup(root)
  end
  ensure_watch(root)
  sync_root(root)
end

-- ── context ─────────────────────────────────────────────────────────────────

-- Buffer, repo and file of the current window, or nil with a notice. The
-- branch is re-read so an action never starts on a stale log.
local function here()
  local buf = api.nvim_get_current_buf()
  local name = api.nvim_buf_get_name(buf)
  if name == "" or vim.bo[buf].buftype ~= "" then
    notify("No file in this buffer", vim.log.levels.WARN)
    return nil
  end
  local root = repo_root(buf)
  local rel = file_ref.relative(root, name)
  if not rel then
    notify("File is outside the repository", vim.log.levels.WARN)
    return nil
  end
  local r = M.refresh(root)
  if r.unknown then
    notify("inline-review: could not read HEAD; not writing", vim.log.levels.ERROR)
    return nil
  end
  return { buf = buf, root = root, rel = rel, repo = r, cap = capture(r) }
end

local function thread_here()
  local ctx = here()
  if not ctx then
    return nil
  end
  M.render_root(ctx.root)
  local t = view.at(ctx.buf, ctx.repo, api.nvim_win_get_cursor(0)[1])[1]
  if not t then
    notify("No review thread here", vim.log.levels.WARN)
    return nil
  end
  ctx.thread = t
  return ctx
end

-- Range of a thread for prompts: live position when its buffer is loaded.
local function live_range(root, t)
  for _, buf in ipairs(buffers_of(root)) do
    if file_ref.relative(root, api.nvim_buf_get_name(buf)) == t.file then
      local s, e = view.position(buf, t.id)
      if s then
        return { s, e }
      end
    end
  end
  return t.evidence[#t.evidence].l
end

-- Keep typed text when a deferred write is refused.
local function keep_text(err, body)
  if err == "changed" or err == "missing" then
    vim.fn.setreg('"', body)
    notify('Your text is in the " register', vim.log.levels.WARN)
  end
end

-- ── actions ─────────────────────────────────────────────────────────────────

function M.add(visual)
  local ctx = here()
  if not ctx then
    return
  end
  local s, e = vim.fn.line("."), vim.fn.line(".")
  if visual then
    s, e = vim.fn.line("v"), vim.fn.line(".")
    if s > e then
      s, e = e, s
    end
    api.nvim_feedkeys(vim.keycode("<Esc>"), "nx", false)
  end
  local snippet = api.nvim_buf_get_lines(ctx.buf, s - 1, e, false)
  local range = store.range_ref({ s, e })
  vim.ui.input({ prompt = "Comment @" .. ctx.rel .. "#" .. range .. ": " }, function(body)
    if not body or not body:match("%S") then
      return
    end
    local _, err = commit(ctx.cap, function(events)
      return { ev = "comment", id = store.next_id(events), file = ctx.rel, l = { s, e }, snippet = snippet, body = body }
    end)
    keep_text(err, body)
  end)
end

function M.edit()
  local ctx = thread_here()
  if not ctx then
    return
  end
  local t = ctx.thread
  if t.state ~= "draft" then
    notify("Only unsent comments can be edited; reply instead", vim.log.levels.WARN)
    return
  end
  local seq, id = t.seq, t.id
  vim.ui.input({ prompt = "Edit " .. id .. ": ", default = store.latest_user(t).body }, function(body)
    if not body or not body:match("%S") then
      return
    end
    local _, err, reason = commit(ctx.cap, function(_, threads)
      local cur = threads[id]
      if not cur or cur.state ~= "draft" or cur.seq ~= seq then
        return nil, "changed"
      end
      return { ev = "edit", id = id, seq = seq, body = body }
    end)
    if reason == "changed" then
      vim.fn.setreg('"', body)
      notify('Draft changed while editing; your text is in the " register', vim.log.levels.WARN)
    else
      keep_text(err, body)
    end
  end)
end

function M.reply(ctx)
  ctx = ctx or thread_here()
  if not ctx then
    return
  end
  local id = ctx.thread.id
  vim.ui.input({ prompt = "Reply " .. id .. ": " }, function(body)
    if not body or not body:match("%S") then
      return
    end
    local _, err = commit(ctx.cap, function(_, threads)
      local cur = threads[id]
      if not cur or cur.state == "deleted" then
        return nil, "gone"
      end
      return { ev = "reply", id = id, body = body }
    end)
    keep_text(err, body)
  end)
end

function M.resolve(ctx)
  ctx = ctx or thread_here()
  if not ctx then
    return
  end
  local id = ctx.thread.id
  if commit(ctx.cap, function()
    return { ev = "resolve", id = id }
  end) then
    notify("Resolved " .. id)
  end
end

--- Resolve every answered thread of the current branch after one confirmation.
function M.resolve_answered()
  local ctx = here()
  if not ctx then
    return
  end
  local ids = {}
  for _, id in ipairs(ctx.repo.order) do
    if ctx.repo.threads[id].state == "answered" then
      table.insert(ids, id)
    end
  end
  if #ids == 0 then
    notify("No answered threads to resolve")
    return
  end
  local question = string.format("Resolve %d answered threads (%s)?", #ids, table.concat(ids, ", "))
  if vim.fn.confirm(question, "&Yes\n&No", 2) ~= 1 then
    return
  end
  -- Report from commit's return, not from what build picked: build runs before
  -- the write, so a locked log, a branch switch or a short write still leaves a
  -- populated list behind. Reading that list announced "Resolved N threads"
  -- next to commit's own warning, and nothing had been resolved.
  -- M.resolve_entries gates the same way.
  local ev = commit(ctx.cap, function(_, threads)
    local answered = vim.tbl_filter(function(id)
      return threads[id] and threads[id].state == "answered"
    end, ids)
    if #answered == 0 then
      return nil, "none"
    end
    return { ev = "resolve", ids = answered }
  end)
  if ev then
    notify(string.format("Resolved %d threads (%s)", #ev.ids, table.concat(ev.ids, ", ")))
  end
end

function M.delete(ctx)
  ctx = ctx or thread_here()
  if not ctx then
    return
  end
  local t = ctx.thread
  for _, m in ipairs(t.msgs) do
    if m.who == "agent" then
      if vim.fn.confirm("Delete " .. t.id .. " and its agent responses?", "&Yes\n&No", 2) ~= 1 then
        return
      end
      break
    end
  end
  if commit(ctx.cap, function()
    return { ev = "delete", id = t.id }
  end) then
    notify("Deleted " .. t.id)
  end
end

-- has("clipboard") stays 1 without a provider; ask the provider itself.
local function has_clipboard()
  local ok, exe = pcall(vim.fn["provider#clipboard#Executable"])
  return ok and exe ~= ""
end

local function copy(text, what)
  if has_clipboard() and pcall(vim.fn.setreg, "+", text) then
    notify("Copied " .. what)
  else
    vim.fn.setreg('"', text)
    notify("Copied " .. what .. " to the unnamed register (no clipboard)", vim.log.levels.WARN)
  end
end

local function send_list(threads, order, state)
  local items, ids = {}, {}
  for _, id in ipairs(order) do
    local t = threads[id]
    if t.state == state then
      table.insert(items, t)
      table.insert(ids, id)
    end
  end
  return items, ids
end

--- Copy all draft threads as one prompt and mark them sent (one locked step).
--- The head is written after the transaction so it names the final log id,
--- even when this very append rotated the log.
function M.yank()
  local ctx = here()
  if not ctx then
    return
  end
  local body, ids
  local ev, _, reason, info = commit(ctx.cap, function(_, threads, order)
    local items
    items, ids = send_list(threads, order, "draft")
    if #items == 0 then
      return nil, "none"
    end
    local list, tokens = {}, {}
    for _, t in ipairs(items) do
      table.insert(list, { thread = t, l = live_range(ctx.root, t) })
      table.insert(tokens, store.token(t.id, t.seq))
    end
    body = store.prompt_body(list)
    return { ev = "sent", ids = tokens }
  end)
  if reason == "none" then
    notify("No draft comments to send")
  elseif ev and info then
    copy(
      store.prompt_head(ctx.cap.log, info.id) .. "\n" .. body,
      string.format("%d comments (%s)", #ids, table.concat(ids, ", "))
    )
  end
end

--- Copy threads still waiting for the agent again (agent session lost).
function M.yank_sent()
  local ctx = here()
  if not ctx then
    return
  end
  local r = ctx.repo
  local items, ids = send_list(r.threads, r.order, "sent")
  if #items == 0 or not r.log_id then
    notify("No sent comments to re-copy")
    return
  end
  local list = {}
  for _, t in ipairs(items) do
    table.insert(list, { thread = t, l = live_range(ctx.root, t) })
  end
  copy(store.prompt(list, r.log, r.log_id), string.format("%d sent comments (%s)", #ids, table.concat(ids, ", ")))
end

local function now_lines(ctx, t)
  local s, e, tr = view.position(ctx.buf, t.id)
  if not s or (tr and tr.removed) then
    return {}, s
  end
  return api.nvim_buf_get_lines(ctx.buf, s - 1, e or s, false), s, e, tr
end

function M.open(ctx)
  ctx = ctx or thread_here()
  if not ctx then
    return
  end
  local t = ctx.thread
  local now, s, e, tr = now_lines(ctx, t)
  local _, _, tr2 = view.position(ctx.buf, t.id)
  tr = tr or tr2
  local title, flags = ctx.rel .. ":" .. store.range_ref({ s or 1, e or s or 1 }):sub(2), {}
  if tr and tr.removed then
    title = ctx.rel .. ":" .. math.min(s or 1, api.nvim_buf_line_count(ctx.buf)) .. " (code removed)"
  end
  if tr and tr.estimated then
    table.insert(flags, "(location estimated)")
  end
  local function again(fn)
    return function()
      fn(ctx)
    end
  end
  view.open_modal(t, { now = now, title = title, flags = flags }, {
    r = again(M.reply),
    x = again(M.resolve),
    e = function()
      M.edit()
    end,
    d = again(M.delete),
    ["]r"] = function()
      M.jump(1)
      M.open()
    end,
  })
end

function M.jump(dir)
  local buf = api.nvim_get_current_buf()
  local starts = view.starts(buf)
  if #starts == 0 then
    notify("No review threads in this buffer")
    return
  end
  local row = api.nvim_win_get_cursor(0)[1]
  local pick
  if dir > 0 then
    for _, it in ipairs(starts) do
      if it.row > row then
        pick = it
        break
      end
    end
    pick = pick or starts[1]
  else
    for i = #starts, 1, -1 do
      if starts[i].row < row then
        pick = starts[i]
        break
      end
    end
    pick = pick or starts[#starts]
  end
  api.nvim_win_set_cursor(0, { pick.row, 0 })
end

function M.toggle_resolved()
  M.show_resolved = not M.show_resolved
  for root, _ in pairs(repos) do
    M.render_root(root)
  end
  notify(M.show_resolved and "Showing resolved threads" or "Hiding resolved threads")
end

--- Picker entries: the current branch's threads, or every log (other
--- branches and the archive) when `all`.
function M.entries(root, all)
  local r = repo(root)
  local logs = {}
  if all then
    -- Current branch first, then other branches, then the archive.
    logs = store.all_logs(root)
    local function rank(lg)
      return lg.path == r.log and 0 or (lg.archived and 2 or 1)
    end
    table.sort(logs, function(a, b)
      if rank(a) ~= rank(b) then
        return rank(a) < rank(b)
      end
      return a.path < b.path
    end)
  elseif r.log then
    local events = store.read(r.log)
    logs = { { path = r.log, archived = false, events = events, head = store.header(events) } }
  end
  local out = {}
  for _, lg in ipairs(logs) do
    local threads, order = store.fold(lg.events)
    local branch = lg.head and lg.head.branch or ""
    local current = lg.path == r.log
    for _, id in ipairs(order) do
      local t = threads[id]
      if t.state ~= "deleted" then
        local exists = uv.fs_stat(root .. "/" .. t.file) ~= nil
        local l = current and live_range(root, t) or t.evidence[#t.evidence].l
        local _, text = view.latest(t)
        local label = exists and view.label(t):upper() or "FILE MISSING"
        local tag = ""
        if lg.archived then
          tag = "[archived: " .. (branch ~= "" and branch or "detached") .. "] "
        elseif not current then
          tag = "[" .. (branch ~= "" and branch or "detached") .. "] "
        end
        table.insert(out, {
          t = t,
          l = l,
          exists = exists,
          log = lg.path,
          log_id = lg.head and lg.head.id,
          branch = lg.head and lg.head.branch,
          archived = lg.archived,
          current = current,
          display = string.format("%-12s %-5s %s%s:%s  %s", label, t.id, tag, t.file, store.range_ref(l):sub(2), text),
          ordinal = table.concat({ label, view.label(t):upper(), t.id, t.file, tag, text }, " "),
        })
      end
    end
  end
  return out
end

--- Resolve picker entries, grouped per log; archived entries are read-only.
function M.resolve_entries(root, list)
  local by_log, order, refused = {}, {}, false
  for _, it in ipairs(list) do
    if it.archived then
      refused = true
    elseif it.log_id then
      if not by_log[it.log] then
        by_log[it.log] = { it = it, ids = {} }
        table.insert(order, it.log)
      end
      table.insert(by_log[it.log].ids, it.t.id)
    end
  end
  if refused then
    notify("Archived threads are read-only", vim.log.levels.WARN)
  end
  local done = {}
  for _, log in ipairs(order) do
    local g = by_log[log]
    local cap = { root = root, log = log, id = g.it.log_id, branch = g.it.branch ~= "" and g.it.branch or nil }
    local ev = commit(cap, function(_, threads)
      local ids = vim.tbl_filter(function(id)
        return threads[id] and threads[id].state ~= "deleted" and threads[id].state ~= "resolved"
      end, g.ids)
      if #ids == 0 then
        return nil, "none"
      end
      return { ev = "resolve", ids = ids }
    end, not g.it.current)
    if ev then
      vim.list_extend(done, ev.ids)
    end
  end
  if #done > 0 then
    notify(string.format("Resolved %d threads (%s)", #done, table.concat(done, ", ")))
  end
  return done
end

function M.list(all)
  local ctx = here()
  if not ctx then
    return
  end
  local ok = pcall(require, "telescope")
  if not ok then
    notify("telescope.nvim is required for the review list", vim.log.levels.ERROR)
    return
  end
  local pickers = require("telescope.pickers")
  local finders = require("telescope.finders")
  local previewers = require("telescope.previewers")
  local conf = require("telescope.config").values
  local actions = require("telescope.actions")
  local state = require("telescope.actions.state")
  pickers
    .new({}, {
      prompt_title = all and "Review threads (all branches)" or ("Review threads: " .. branch_label(ctx.repo.branch)),
      finder = finders.new_table({
        results = M.entries(ctx.root, all),
        entry_maker = function(it)
          return { value = it, display = it.display, ordinal = it.ordinal }
        end,
      }),
      sorter = conf.generic_sorter({}),
      previewer = previewers.new_buffer_previewer({
        title = "Thread",
        define_preview = function(self, entry)
          local it = entry.value
          local now = {}
          if it.exists and it.current and not it.t.evidence[#it.t.evidence].removed then
            local lines = vim.fn.readfile(ctx.root .. "/" .. it.t.file)
            now = vim.list_slice(lines, it.l[1], it.l[2])
          end
          local width = api.nvim_win_get_width(self.state.winid) - 2
          view.fill(self.state.bufnr, view.thread_rows(it.t, width, now, it.exists and {} or { "FILE MISSING" }), " ")
        end,
      }),
      attach_mappings = function(prompt_bufnr, map)
        actions.select_default:replace(function()
          local sel = state.get_selected_entry()
          actions.close(prompt_bufnr)
          if not sel or not sel.value.exists or not sel.value.current then
            return
          end
          vim.cmd.edit(vim.fn.fnameescape(ctx.root .. "/" .. sel.value.t.file))
          local count = api.nvim_buf_line_count(0)
          api.nvim_win_set_cursor(0, { math.min(sel.value.l[1], count), 0 })
        end)
        local function resolve_selected()
          local picker = state.get_current_picker(prompt_bufnr)
          local picked = vim.tbl_map(function(e)
            return e.value
          end, picker:get_multi_selection())
          if #picked == 0 and state.get_selected_entry() then
            picked = { state.get_selected_entry().value }
          end
          actions.close(prompt_bufnr)
          M.resolve_entries(ctx.root, picked)
        end
        map({ "i", "n" }, "<C-x>", resolve_selected)
        map({ "i", "n" }, "<C-a>", function()
          actions.close(prompt_bufnr)
          M.list(not all)
        end)
        return true
      end,
    })
    :find()
end

--- Remove a lock left behind by a crashed writer.
---
--- Deliberately does not go through here(): the command is advertised by
--- cli.lua when a CLI write finds the log locked, and that message is read in a
--- terminal buffer, where here() refuses with "No file in this buffer" and the
--- old fallback then aimed at `.detached` — so the one situation the command
--- documents was the one it could not act on. It also only ever reached the
--- current branch's log, while a crashed writer's lock can be on any of them.
--- So the repo root is resolved quietly and every held lock is offered.
function M.unlock()
  local root = repo_root(0)
  local locks = store.locks(root)
  if #locks == 0 then
    notify("No review log lock under " .. store.dir(root))
    return
  end
  local function remove(log)
    local question = "Remove " .. log .. ".lock? Only do this if no writer is running."
    if vim.fn.confirm(question, "&Yes\n&No", 2) == 1 then
      store.unlock(log)
      notify("Removed review log lock for " .. vim.fn.fnamemodify(log, ":t"))
    end
  end
  if #locks == 1 then
    remove(locks[1])
    return
  end
  vim.ui.select(locks, {
    prompt = "Review log lock to remove",
    format_item = function(log)
      return vim.fn.fnamemodify(log, ":t")
    end,
  }, function(log)
    if log then
      remove(log)
    end
  end)
end

-- ── setup ───────────────────────────────────────────────────────────────────

function M.setup()
  require("utils.palette").on_colorscheme("inline_review", view.setup_highlights)

  local map = vim.keymap.set
  map("n", "<leader>aa", function()
    M.add(false)
  end, { desc = "Review: comment on line" })
  map("x", "<leader>aa", function()
    M.add(true)
  end, { desc = "Review: comment on selection" })
  map("n", "<leader>ae", M.edit, { desc = "Review: edit draft" })
  map("n", "<leader>ay", M.yank, { desc = "Review: copy drafts as prompt" })
  map("n", "<leader>aY", M.yank_sent, { desc = "Review: re-copy sent comments" })
  map("n", "<leader>ao", function()
    M.open()
  end, { desc = "Review: open thread" })
  map("n", "<leader>ar", function()
    M.reply()
  end, { desc = "Review: reply" })
  map("n", "<leader>ax", function()
    M.resolve()
  end, { desc = "Review: resolve" })
  map("n", "<leader>aX", M.resolve_answered, { desc = "Review: resolve all answered" })
  map("n", "<leader>ad", function()
    M.delete()
  end, { desc = "Review: delete thread" })
  map("n", "<leader>al", function()
    M.list(false)
  end, { desc = "Review: list threads" })
  map("n", "<leader>ah", M.toggle_resolved, { desc = "Review: toggle resolved" })
  map("n", "]r", function()
    M.jump(1)
  end, { desc = "Next review thread" })
  map("n", "[r", function()
    M.jump(-1)
  end, { desc = "Previous review thread" })

  api.nvim_create_user_command("InlineReviewUnlock", M.unlock, { desc = "Remove a stale review log lock" })

  local group = api.nvim_create_augroup("InlineReview", { clear = true })
  api.nvim_create_autocmd({ "BufReadPost", "FileChangedShellPost" }, {
    group = group,
    callback = function(ev)
      view.forget(ev.buf)
      poll(ev.buf)
    end,
  })
  api.nvim_create_autocmd("BufWritePost", {
    group = group,
    callback = function(ev)
      record_edits(ev.buf)
      poll(ev.buf)
    end,
  })
  api.nvim_create_autocmd("BufEnter", {
    group = group,
    callback = function(ev)
      poll(ev.buf)
    end,
  })
  api.nvim_create_autocmd("FocusGained", {
    group = group,
    callback = function(ev)
      poll(ev.buf, true)
    end,
  })
  api.nvim_create_autocmd({ "WinResized", "VimResized" }, {
    group = group,
    callback = function()
      for root, _ in pairs(repos) do
        M.render_root(root)
      end
    end,
  })
  api.nvim_create_autocmd("BufWipeout", {
    group = group,
    callback = function(ev)
      view.forget(ev.buf)
    end,
  })
  api.nvim_create_autocmd("VimLeavePre", { group = group, callback = stop_watches })
end

-- Test seams: stop the log watchers between cases; pick up a branch switch.
M._stop = stop_watches
M._poll = poll

return M
