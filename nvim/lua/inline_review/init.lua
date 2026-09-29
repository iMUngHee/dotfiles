-- inline_review: review comments anchored to code ranges, sent to an AI agent
-- as one prompt, with the agent's responses shown back at each location.
-- Experience/interface decisions: design-contract.md in this directory.
local store = require("inline_review.store")
local view = require("inline_review.view")
local file_ref = require("utils.file_ref")

local api = vim.api
local uv = vim.uv
local M = {}

M.show_resolved = false

-- repos[root] = { root, log, threads, order, mtime, seen_bad, seen_warn, watch }
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

local function repo(root)
  local r = repos[root]
  if not r then
    r = { root = root, log = store.log_path(root), threads = {}, order = {}, mtime = -1, seen_bad = {}, seen_warn = {} }
    repos[root] = r
  end
  return r
end

--- Re-read the log of `root` and fold it; warns once per malformed line.
function M.refresh(root)
  local r = repo(root)
  local events, bad = store.read(r.log)
  local threads, order, warns = store.fold(events)
  r.threads, r.order, r.mtime = threads, order, mtime(r.log)
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
  if not r then
    return
  end
  local rel = file_ref.relative(root, name)
  if not rel then
    return
  end
  view.render(buf, r, rel, {
    show_resolved = M.show_resolved,
    on_move = function(t, res, latest)
      vim.schedule(function()
        record_move(buf, root, t.id, res, latest)
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

local ensure_watch

--- Append through the store lock; reports failures in the contract's words.
local function commit(root, build)
  local r = repo(root)
  local ev, err, reason = store.transact(r.log, build)
  if not ev then
    if err == "locked" then
      notify(
        string.format("inline-review: log is locked (%s.lock); run :InlineReviewUnlock if no writer is running", r.log),
        vim.log.levels.WARN
      )
    elseif err == "incomplete" then
      notify("inline-review: write may be incomplete " .. r.log, vim.log.levels.WARN)
    elseif err ~= "aborted" then
      notify("inline-review: could not write " .. r.log .. ": " .. tostring(err), vim.log.levels.ERROR)
    end
  end
  M.refresh(root)
  ensure_watch(root)
  M.render_root(root)
  return ev, err, reason
end

-- Persist a verified position, only if its evidence is still the newest and
-- the buffer still matches the disk.
function record_move(buf, root, id, res, latest)
  if not api.nvim_buf_is_loaded(buf) or view.synced(buf) ~= true then
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
  commit(root, function(_, threads)
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
  if not r then
    return
  end
  for _, id in ipairs(view.tracked_ids(buf)) do
    local t = r.threads[id]
    local s, e, tr = view.position(buf, id)
    if t and s and tr then
      local latest = t.evidence[#t.evidence]
      local lines = api.nvim_buf_get_lines(buf, s - 1, e or s, false)
      if tr.n == latest.n and not tr.estimated and not (s == latest.l[1] and vim.deep_equal(lines, latest.lines)) then
        record_move(buf, root, id, { s = s, e = e, removed = tr.removed }, latest)
      end
    end
  end
end

-- ── watching ────────────────────────────────────────────────────────────────

function ensure_watch(root)
  local r = repo(root)
  if r.watch then
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
  r.watch = { handle = handle, timer = timer }
  local function start()
    handle:start(
      dir,
      {},
      vim.schedule_wrap(function(err, fname)
        if err then
          return
        end
        if fname and fname:match("%.lock$") then
          return
        end
        timer:stop()
        timer:start(
          100,
          0,
          vim.schedule_wrap(function()
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

-- Pick up log changes a watcher may have missed.
local function poll(buf)
  if vim.bo[buf].buftype ~= "" or api.nvim_buf_get_name(buf) == "" then
    return
  end
  local root = repo_root(buf)
  local r = repo(root)
  if mtime(r.log) ~= r.mtime then
    M.refresh(root)
  end
  ensure_watch(root)
  sync_root(root)
end

-- ── context ─────────────────────────────────────────────────────────────────

-- Buffer, repo and file of the current window, or nil with a notice.
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
  if not repos[root] then
    M.refresh(root)
  end
  return { buf = buf, root = root, rel = rel, repo = repos[root] }
end

local function thread_here()
  local ctx = here()
  if not ctx then
    return nil
  end
  local t = view.at(ctx.buf, ctx.repo, api.nvim_win_get_cursor(0)[1])[1]
  if not t then
    notify("No review thread here", vim.log.levels.WARN)
    return nil
  end
  ctx.thread = t
  return ctx
end

local function current_range(buf, t)
  local s, e = view.position(buf, t.id)
  if s then
    return { s, e }
  end
  return t.evidence[#t.evidence].l
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
    commit(ctx.root, function(events)
      return { ev = "comment", id = store.next_id(events), file = ctx.rel, l = { s, e }, snippet = snippet, body = body }
    end)
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
    local _, _, reason = commit(ctx.root, function(_, threads)
      local cur = threads[id]
      if not cur or cur.state ~= "draft" or cur.seq ~= seq then
        return nil, "changed"
      end
      return { ev = "edit", id = id, seq = seq, body = body }
    end)
    if reason == "changed" then
      vim.fn.setreg('"', body)
      notify('Draft changed while editing; your text is in the " register', vim.log.levels.WARN)
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
    commit(ctx.root, function(_, threads)
      local cur = threads[id]
      if not cur or cur.state == "deleted" then
        return nil, "gone"
      end
      return { ev = "reply", id = id, body = body }
    end)
  end)
end

function M.resolve(ctx)
  ctx = ctx or thread_here()
  if not ctx then
    return
  end
  local id = ctx.thread.id
  if commit(ctx.root, function()
    return { ev = "resolve", id = id }
  end) then
    notify("Resolved " .. id)
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
  if commit(ctx.root, function()
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
function M.yank()
  local ctx = here()
  if not ctx then
    return
  end
  local prompt, ids
  local ev, _, reason = commit(ctx.root, function(_, threads, order)
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
    prompt = store.prompt(list)
    return { ev = "sent", ids = tokens }
  end)
  if reason == "none" then
    notify("No draft comments to send")
  elseif ev then
    copy(prompt, string.format("%d comments (%s)", #ids, table.concat(ids, ", ")))
  end
end

--- Copy threads still waiting for the agent again (agent session lost).
function M.yank_sent()
  local ctx = here()
  if not ctx then
    return
  end
  local r = M.refresh(ctx.root)
  local items, ids = send_list(r.threads, r.order, "sent")
  if #items == 0 then
    notify("No sent comments to re-copy")
    return
  end
  local list = {}
  for _, t in ipairs(items) do
    table.insert(list, { thread = t, l = live_range(ctx.root, t) })
  end
  copy(store.prompt(list), string.format("%d sent comments (%s)", #ids, table.concat(ids, ", ")))
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

function M.list()
  local ctx = here()
  if not ctx then
    return
  end
  local r = M.refresh(ctx.root)
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
  local entries = {}
  for _, id in ipairs(r.order) do
    local t = r.threads[id]
    if t.state ~= "deleted" then
      local exists = uv.fs_stat(ctx.root .. "/" .. t.file) ~= nil
      local l = live_range(ctx.root, t)
      local _, text = view.latest(t)
      local label = exists and view.label(t):upper() or "FILE MISSING"
      table.insert(entries, {
        t = t,
        l = l,
        exists = exists,
        display = string.format("%-12s %-5s %s:%s  %s", label, t.id, t.file, store.range_ref(l):sub(2), text),
        ordinal = table.concat({ label, view.label(t):upper(), t.id, t.file, text }, " "),
      })
    end
  end
  pickers
    .new({}, {
      prompt_title = "Review threads",
      finder = finders.new_table({
        results = entries,
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
          if it.exists and not it.t.evidence[#it.t.evidence].removed then
            local lines = vim.fn.readfile(ctx.root .. "/" .. it.t.file)
            now = vim.list_slice(lines, it.l[1], it.l[2])
          end
          local width = api.nvim_win_get_width(self.state.winid) - 2
          view.fill(self.state.bufnr, view.thread_rows(it.t, width, now, it.exists and {} or { "FILE MISSING" }), " ")
        end,
      }),
      attach_mappings = function(prompt_bufnr)
        actions.select_default:replace(function()
          local sel = state.get_selected_entry()
          actions.close(prompt_bufnr)
          if not sel or not sel.value.exists then
            return
          end
          vim.cmd.edit(vim.fn.fnameescape(ctx.root .. "/" .. sel.value.t.file))
          local count = api.nvim_buf_line_count(0)
          api.nvim_win_set_cursor(0, { math.min(sel.value.l[1], count), 0 })
        end)
        return true
      end,
    })
    :find()
end

function M.unlock()
  local ctx = here()
  local root = ctx and ctx.root or vim.fn.getcwd()
  local lock = store.log_path(root) .. ".lock"
  if not uv.fs_stat(lock) then
    notify("No review log lock in " .. root)
    return
  end
  if vim.fn.confirm("Remove " .. lock .. "? Only do this if no writer is running.", "&Yes\n&No", 2) == 1 then
    store.unlock(store.log_path(root))
    notify("Removed review log lock")
  end
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
  map("n", "<leader>ad", function()
    M.delete()
  end, { desc = "Review: delete thread" })
  map("n", "<leader>al", M.list, { desc = "Review: list threads" })
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
  api.nvim_create_autocmd({ "BufEnter", "FocusGained" }, {
    group = group,
    callback = function(ev)
      poll(ev.buf)
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

-- Test seam: stop the log watchers between cases.
M._stop = stop_watches

return M
