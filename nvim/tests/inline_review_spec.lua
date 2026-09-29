-- Headless checks for inline_review.
--   nvim --headless -u NONE --cmd "set rtp^=nvim" -l nvim/tests/inline_review_spec.lua
-- Run from the repository root. Prints ALL PASS and exits 0, or lists failures.

local here = vim.fn.fnamemodify(debug.getinfo(1, "S").source:sub(2), ":p:h")
local LUA_DIR = vim.fn.fnamemodify(here .. "/../lua", ":p")
-- Absolute, so tests that :cd elsewhere still resolve the modules.
vim.opt.rtp:prepend(vim.fn.fnamemodify(here .. "/..", ":p"))
local store = require("inline_review.store")

local results = { pass = 0, fail = {} }
local only = arg and arg[1]

local function case(name, fn)
  if only and not name:find(only, 1, true) then
    return
  end
  local ok, err = xpcall(fn, debug.traceback)
  if ok then
    results.pass = results.pass + 1
  else
    table.insert(results.fail, name .. "\n" .. tostring(err))
  end
end

local function eq(got, want, what)
  if not vim.deep_equal(got, want) then
    error(string.format("%s\n  want: %s\n  got:  %s", what or "mismatch", vim.inspect(want), vim.inspect(got)), 2)
  end
end

local function truthy(v, what)
  if not v then
    error(what or "expected truthy", 2)
  end
end

local function tmpdir()
  local d = vim.fn.tempname()
  vim.fn.mkdir(d, "p")
  return vim.fn.resolve(d)
end

local function write(path, data, mode)
  local f = assert(io.open(path, mode or "wb"))
  f:write(data)
  f:close()
end

local function read(path)
  local f = io.open(path, "rb")
  if not f then
    return ""
  end
  local d = f:read("*a")
  f:close()
  return d
end

local function jl(ev)
  return vim.json.encode(ev) .. "\n"
end

local function fold_file(log)
  local events, bad = store.read(log)
  local threads, order, warns = store.fold(events)
  return threads, order, warns, bad, events
end

local function new_log()
  local root = tmpdir()
  return root, store.log_path(root)
end

local function comment(id, extra)
  return vim.tbl_extend("force", {
    ev = "comment",
    id = id,
    file = "a.lua",
    l = { 2, 3 },
    snippet = { "x", "y" },
    body = "why " .. id,
  }, extra or {})
end

-- A standalone writer process, used to race real OS processes on the log.
local WRITER = [[
package.path = %q .. "?.lua;" .. %q .. "?/init.lua;" .. package.path
local store = require("inline_review.store")
local log, count, tag = arg[1], tonumber(arg[2]), arg[3]
local mine = {}
for i = 1, count do
  local ev = assert(store.transact(log, function(events)
    return { ev = "comment", id = store.next_id(events), file = tag .. ".lua", l = { i, i }, snippet = { tag .. i }, body = tag .. i }
  end))
  table.insert(mine, ev.id)
  assert(store.transact(log, function()
    return { ev = "reply", id = ev.id, body = "reply " .. tag .. i }
  end))
end
io.stdout:write(table.concat(mine, ","))
]]

local function writer_script()
  local path = vim.fn.tempname() .. ".lua"
  write(path, string.format(WRITER, LUA_DIR, LUA_DIR))
  return path
end

local NVIM = vim.v.progpath

-- ── fold ────────────────────────────────────────────────────────────────────

case("fold: draft → sent → answered → reply → sent → answered → resolved", function()
  local _, log = new_log()
  vim.fn.mkdir(vim.fs.dirname(log), "p")
  write(
    log,
    jl(comment("c1"))
      .. jl({ ev = "sent", ids = { "c1" } })
      .. jl({ ev = "response", id = "c1", status = "addressed", summary = "done" })
      .. jl({ ev = "reply", id = "c1", body = "still odd" })
      .. jl({ ev = "sent", ids = { "c1.2" } })
      .. jl({ ev = "response", id = "c1.2", status = "declined", summary = "keeping it" })
      .. jl({ ev = "resolve", id = "c1" })
  )
  local t = fold_file(log).c1
  eq(t.state, "resolved", "state")
  eq(t.status, "declined", "status")
  eq(t.seq, 2, "seq")
  eq(#t.msgs, 4, "history")
end)

case("fold: edit applies only to the current draft message", function()
  local _, log = new_log()
  vim.fn.mkdir(vim.fs.dirname(log), "p")
  write(
    log,
    jl(comment("c1"))
      .. jl({ ev = "edit", id = "c1", seq = 1, body = "edited" })
      .. jl({ ev = "sent", ids = { "c1" } })
      .. jl({ ev = "edit", id = "c1", seq = 1, body = "too late" })
      .. jl({ ev = "reply", id = "c1", body = "two" })
      .. jl({ ev = "edit", id = "c1", seq = 1, body = "wrong round" })
  )
  local threads, _, warns = fold_file(log)
  eq(threads.c1.msgs[1].body, "edited", "seq 1 body")
  eq(threads.c1.msgs[2].body, "two", "seq 2 body")
  eq(#warns, 2, "warnings for rejected edits")
end)

case("fold: delete hides thread and later responses stay history only", function()
  local _, log = new_log()
  vim.fn.mkdir(vim.fs.dirname(log), "p")
  write(
    log,
    jl(comment("c1"))
      .. jl({ ev = "sent", ids = { "c1" } })
      .. jl({ ev = "delete", id = "c1" })
      .. jl({ ev = "response", id = "c1", status = "addressed", summary = "late" })
  )
  local t = fold_file(log).c1
  eq(t.state, "deleted", "state")
  eq(t.msgs[#t.msgs].stale, true, "late response is stale")
end)

case("fold: earlier-round, after-reply and after-resolve responses do not change state or anchor", function()
  local _, log = new_log()
  vim.fn.mkdir(vim.fs.dirname(log), "p")
  write(
    log,
    jl(comment("c1"))
      .. jl({ ev = "sent", ids = { "c1" } })
      .. jl({ ev = "reply", id = "c1", body = "follow" })
      .. jl({ ev = "response", id = "c1", status = "addressed", summary = "old", l = { 9, 9 }, anchor = "z" })
  )
  local t = fold_file(log).c1
  eq(t.state, "draft", "reply keeps draft")
  eq(#t.evidence, 1, "no anchor from earlier round")
  eq(t.msgs[#t.msgs].stale, true, "marked earlier round")

  write(
    log,
    jl({ ev = "sent", ids = { "c1.2" } })
      .. jl({ ev = "response", id = "c1.2", status = "addressed", summary = "ok" })
      .. jl({ ev = "resolve", id = "c1" })
      .. jl({ ev = "response", id = "c1.2", status = "declined", summary = "after resolve", l = { 5, 5 }, anchor = "q" }),
    "ab"
  )
  t = fold_file(log).c1
  eq(t.state, "resolved", "resolve holds")
  eq(t.status, "addressed", "status from before resolve")
  eq(#t.evidence, 1, "no anchor after resolve")
end)

case("fold: duplicate current-round response — last wins, anchor only when it carries one", function()
  local _, log = new_log()
  vim.fn.mkdir(vim.fs.dirname(log), "p")
  write(
    log,
    jl(comment("c1"))
      .. jl({ ev = "sent", ids = { "c1" } })
      .. jl({ ev = "response", id = "c1", status = "addressed", summary = "a", l = { 4, 5 }, anchor = "k" })
      .. jl({ ev = "response", id = "c1", status = "question", summary = "b" })
  )
  local t = fold_file(log).c1
  eq(t.state, "answered", "state")
  eq(t.status, "question", "last status wins")
  eq(t.evidence[#t.evidence].l, { 4, 5 }, "coordinate-less response keeps anchor")
end)

case("fold: move applies only when its base is still the latest evidence", function()
  local _, log = new_log()
  vim.fn.mkdir(vim.fs.dirname(log), "p")
  write(
    log,
    jl(comment("c1"))
      .. jl({ ev = "move", id = "c1", l = { 3, 4 }, snippet = { "x", "y" }, base = 1 })
      .. jl({ ev = "sent", ids = { "c1" } })
      .. jl({ ev = "response", id = "c1", status = "addressed", summary = "s", l = { 7, 7 }, anchor = "n" })
      .. jl({ ev = "move", id = "c1", l = { 3, 4 }, snippet = { "x", "y" }, base = 2 })
  )
  local t = fold_file(log).c1
  eq(t.evidence[#t.evidence].kind, "response", "stale move ignored")
  eq(#t.evidence, 3, "comment, move, response")
end)

case("fold: unknown id and malformed lines are reported", function()
  local _, log = new_log()
  vim.fn.mkdir(vim.fs.dirname(log), "p")
  write(
    log,
    jl(comment("c1"))
      .. "not json\n"
      .. jl({ ev = "comment", id = "c2", file = "a", l = { 3, 1 }, snippet = {}, body = "bad range" })
      .. jl({ ev = "response", id = "c9", status = "addressed", summary = "?" })
      .. jl({ ev = "response", id = "c1", status = "maybe", summary = "bad status" })
  )
  local _, _, warns, bad = fold_file(log)
  eq(bad, { 2, 3, 5 }, "malformed line numbers")
  eq(#warns, 1, "unknown id warning")
end)

-- ── log integrity ───────────────────────────────────────────────────────────

case("integrity: unterminated tail is ignored until terminated", function()
  local _, log = new_log()
  vim.fn.mkdir(vim.fs.dirname(log), "p")
  write(log, jl(comment("c1")) .. '{"ev":')
  local events, bad = store.read(log)
  eq(#events, 1, "tail not parsed")
  eq(#bad, 0, "tail not warned")
end)

case("integrity: every truncation point of an abandoned write keeps the next record", function()
  local full = jl(comment("c1"))
  for cut = 1, #full - 1 do
    local _, log = new_log()
    vim.fn.mkdir(vim.fs.dirname(log), "p")
    write(log, full:sub(1, cut))
    local ev = assert(store.transact(log, function(events)
      return comment(store.next_id(events), { body = "next" })
    end))
    local threads, order, _, bad = fold_file(log)
    local complete = cut == #full - 1
    eq(threads[ev.id].msgs[1].body, "next", "next record kept at cut " .. cut)
    if complete then
      eq(order, { "c1", "c2" }, "complete JSON confirmed before allocation")
      eq(#bad, 0, "no warning when only the newline was missing")
    else
      eq(ev.id, "c1", "id allocated after fragment at cut " .. cut)
      eq(#bad, 1, "fragment warned once at cut " .. cut)
    end
  end
end)

case("integrity: short write is reported as incomplete", function()
  local _, log = new_log()
  local real = store.write_once
  store.write_once = function(path, data)
    if #data > 1 then
      return real(path, data:sub(1, #data - 1))
    end
    return real(path, data)
  end
  local ev, err = store.transact(log, function(events)
    return comment(store.next_id(events))
  end)
  store.write_once = real
  eq(ev, nil, "no event returned")
  eq(err, "incomplete", "reason")
  -- The next writer's tail repair confirms the complete JSON before allocating.
  local nxt = assert(store.transact(log, function(events)
    return comment(store.next_id(events))
  end))
  eq(nxt.id, "c2", "ids stay unique after a short write")
end)

case("integrity: two processes racing comments get unique ids and keep their replies", function()
  local _, log = new_log()
  vim.fn.mkdir(vim.fs.dirname(log), "p")
  local script = writer_script()
  local a = vim.system({ NVIM, "-u", "NONE", "--headless", "-l", script, log, "60", "a" })
  local b = vim.system({ NVIM, "-u", "NONE", "--headless", "-l", script, log, "60", "b" })
  local ra, rb = a:wait(60000), b:wait(60000)
  eq(ra.code, 0, "writer a: " .. (ra.stderr or ""))
  eq(rb.code, 0, "writer b: " .. (rb.stderr or ""))
  local threads, order, warns, bad = fold_file(log)
  eq(#order, 120, "all comments present")
  eq(#bad, 0, "no malformed lines")
  eq(#warns, 0, "no duplicate ids")
  for _, id in ipairs(vim.split(ra.stdout, ",")) do
    local t = threads[id]
    truthy(t.file == "a.lua" and t.msgs[2] and t.msgs[2].body:match("^reply a"), "reply attached to " .. id)
  end
end)

case("integrity: a held lock is never stolen; a crash lock needs explicit unlock", function()
  local _, log = new_log()
  vim.fn.mkdir(log .. ".lock", "p")
  local t0 = vim.uv.hrtime()
  local ev, err = store.transact(log, function(events)
    return comment(store.next_id(events))
  end)
  eq(ev, nil, "no write while locked")
  eq(err, "locked", "reason")
  truthy((vim.uv.hrtime() - t0) / 1e6 >= 1900, "waited for the lock")
  truthy(vim.uv.fs_stat(log .. ".lock"), "lock left in place")
  store.unlock(log)
  truthy(
    store.transact(log, function(events)
      return comment(store.next_id(events))
    end),
    "writes after unlock"
  )
end)

case("integrity: .gitignore is created beside the log", function()
  local _, log = new_log()
  assert(store.transact(log, function(events)
    return comment(store.next_id(events))
  end))
  eq(read(vim.fs.dirname(log) .. "/.gitignore"), "*\n", ".gitignore")
end)

-- ── prompt ──────────────────────────────────────────────────────────────────

case("prompt: tokens, ranges and follow-ups", function()
  local _, log = new_log()
  vim.fn.mkdir(vim.fs.dirname(log), "p")
  write(
    log,
    jl(comment("c3", { file = "nvim/lua/utils/root.lua", l = { 13, 20 }, body = "다른 방법 없어?" }))
      .. jl(comment("c4", { l = { 7, 7 }, body = "one line" }))
      .. jl({ ev = "sent", ids = { "c4" } })
      .. jl({ ev = "response", id = "c4", status = "addressed", summary = "renamed" })
      .. jl({ ev = "reply", id = "c4", body = "not enough" })
  )
  local threads = fold_file(log)
  local text = store.prompt({ { thread = threads.c3, l = { 13, 20 } }, { thread = threads.c4, l = { 8, 8 } } })
  local lines = vim.split(text, "\n")
  eq(lines[1], store.PROMPT_HEAD, "head")
  eq(lines[2], "[c3] @nvim/lua/utils/root.lua#L13-20 다른 방법 없어?", "first comment")
  eq(lines[3], '[c4.2] @a.lua#L8 (follow-up; your last: "renamed") not enough', "follow-up")
end)

-- ── cli ─────────────────────────────────────────────────────────────────────

local CLI = LUA_DIR .. "inline_review/cli.lua"

local function cli(root, ...)
  return vim.system({ NVIM, "-u", "NONE", "--headless", "-l", CLI, "respond", "--root", root, ... }):wait(30000)
end

local function sent_thread(root)
  local log = store.log_path(root)
  vim.fn.mkdir(vim.fs.dirname(log), "p")
  write(log, jl(comment("c1")) .. jl({ ev = "sent", ids = { "c1" } }))
  return log
end

case("cli: rejects invalid arguments with exit 2 and leaves the log unchanged", function()
  local root = tmpdir()
  local log = sent_thread(root)
  local before = read(log)
  local bad = {
    { "--id", "c1", "--status", "done", "--summary", "x" },
    { "--id", "x1", "--status", "addressed", "--summary", "x" },
    { "--id", "c1", "--status", "addressed" },
    { "--id", "c1", "--status", "addressed", "--summary", "x", "--l", "5,3", "--anchor", "a" },
    { "--id", "c1", "--status", "addressed", "--summary", "x", "--l", "5" },
    { "--id", "c1", "--status", "addressed", "--summary", "x", "--removed", "--l", "5", "--anchor", "a" },
    { "--id", "c1", "--status", "addressed", "--summary", "x", "--l", "1", "--anchor", "a", "--file", "../out.lua" },
    { "--id", "c9", "--status", "addressed", "--summary", "x" },
  }
  for _, args in ipairs(bad) do
    local r = cli(root, unpack(args))
    eq(r.code, 2, "exit for " .. table.concat(args, " ") .. " (" .. (r.stderr or "") .. ")")
  end
  eq(read(log), before, "log unchanged")
end)

case("cli: records response, removed and moved-file anchors", function()
  local root = tmpdir()
  local log = sent_thread(root)
  local r = cli(
    root,
    "--id",
    "c1",
    "--status",
    "addressed",
    "--summary",
    "정리했습니다",
    "--l",
    "4,6",
    "--anchor",
    "  local x = 1"
  )
  eq(r.code, 0, "respond: " .. (r.stderr or ""))
  eq(r.stdout, "recorded response c1\n", "stdout")
  local t = fold_file(log).c1
  eq(
    { t.state, t.status, t.evidence[2].l, t.evidence[2].lines },
    { "answered", "addressed", { 4, 6 }, { "  local x = 1" } },
    "anchor"
  )

  r = cli(
    root,
    "--id",
    "c1",
    "--status",
    "addressed",
    "--summary",
    "removed",
    "--removed",
    "--l",
    "9",
    "--anchor",
    "end",
    "--anchor-side",
    "before"
  )
  eq(r.code, 0, "removed: " .. (r.stderr or ""))
  t = fold_file(log).c1
  eq({ t.evidence[3].removed, t.evidence[3].side, t.evidence[3].l }, { true, "before", { 9, 9 } }, "removed anchor")

  vim.fn.mkdir(root .. "/sub", "p")
  r = cli(
    root,
    "--id",
    "c1",
    "--status",
    "addressed",
    "--summary",
    "moved",
    "--l",
    "2",
    "--anchor",
    "x",
    "--file",
    "sub/b.lua"
  )
  eq(r.code, 0, "file: " .. (r.stderr or ""))
  eq(fold_file(log).c1.file, "sub/b.lua", "re-targeted file")
end)

case("cli: stale token is kept as history with a note", function()
  local root = tmpdir()
  local log = sent_thread(root)
  write(log, jl({ ev = "reply", id = "c1", body = "more" }), "ab")
  local r = cli(root, "--id", "c1", "--status", "addressed", "--summary", "late")
  eq(r.code, 0, "exit")
  truthy(r.stderr:match("not waiting"), "note on stderr")
  eq(fold_file(log).c1.state, "draft", "state unchanged")
end)

case("cli: 64KB records from CLI and nvim writers interleave under the lock without loss", function()
  local root = tmpdir()
  local log = sent_thread(root)
  local hold = vim.fn.tempname() .. ".lua"
  write(
    hold,
    string.format(
      [[
package.path = %q .. "?.lua;" .. %q .. "?/init.lua;" .. package.path
local store = require("inline_review.store")
store.on_locked = function() vim.uv.sleep(40) end
local big = string.rep("가", 22000)
for i = 1, 8 do
  assert(store.transact(arg[1], function(events)
    return { ev = "comment", id = store.next_id(events), file = "h.lua", l = { i, i }, snippet = { big }, body = "hold" .. i }
  end))
end
]],
      LUA_DIR,
      LUA_DIR
    )
  )
  local jobs = { vim.system({ NVIM, "-u", "NONE", "--headless", "-l", hold, log }) }
  local big = string.rep("나", 22000)
  for i = 1, 6 do
    table.insert(
      jobs,
      vim.system({
        NVIM,
        "-u",
        "NONE",
        "--headless",
        "-l",
        CLI,
        "respond",
        "--root",
        root,
        "--id",
        "c1",
        "--status",
        "addressed",
        "--summary",
        big .. i,
      })
    )
  end
  for i, j in ipairs(jobs) do
    local r = j:wait(60000)
    eq(r.code, 0, "job " .. i .. ": " .. (r.stderr or ""))
  end
  local threads, order, warns, bad = fold_file(log)
  eq(#bad, 0, "no malformed lines")
  eq(#warns, 0, "no warnings")
  eq(#order, 9, "c1 + 8 held comments")
  eq(#threads.c1.msgs, 7, "six 64KB responses kept")
end)

-- ── file references (<leader>l / <leader>L) ──────────────────────────────────

-- In-memory clipboard so tests never touch the real one.
local clip = {}
vim.g.clipboard = {
  name = "spec",
  copy = {
    ["+"] = function(lines)
      clip["+"] = lines
    end,
    ["*"] = function(lines)
      clip["*"] = lines
    end,
  },
  paste = {
    ["+"] = function()
      return clip["+"] or {}
    end,
    ["*"] = function()
      return clip["*"] or {}
    end,
  },
}

local function git_repo()
  local root = tmpdir()
  vim.system({ "git", "init", "-q", root }):wait()
  vim.fn.mkdir(root .. "/sub", "p")
  write(root .. "/sub/a.lua", "one\ntwo\nthree\nfour\n")
  return root
end

case("file_ref: <leader>l / <leader>L produce the same references as before", function()
  require("common.mappings")
  local root = git_repo()
  local outside = tmpdir() .. "/o.lua"
  write(outside, "x\ny\n")
  vim.uv.fs_symlink(root .. "/sub/a.lua", root .. "/link.lua")
  vim.cmd.cd(root)
  local function run(file, keys)
    vim.cmd.edit(vim.fn.fnameescape(file))
    vim.api.nvim_win_set_cursor(0, { 2, 0 })
    vim.api.nvim_feedkeys(vim.keycode(keys), "mx", false)
    return vim.fn.getreg("+")
  end
  local home = vim.fn.fnamemodify(root, ":~")
  eq(run(root .. "/sub/a.lua", "<Space>l"), "@sub/a.lua", "project, normal")
  eq(run(root .. "/sub/a.lua", "Vj<Space>l"), "@sub/a.lua#L2-3", "project, visual range")
  eq(run(root .. "/sub/a.lua", "V<Space>l"), "@sub/a.lua#L2", "project, visual line")
  eq(run(root .. "/sub/a.lua", "<Space>L"), "@" .. home .. "/sub/a.lua", "home, normal")
  eq(run(root .. "/sub/a.lua", "Vj<Space>L"), "@" .. home .. "/sub/a.lua#L2-3", "home, visual")
  eq(run(root .. "/link.lua", "<Space>l"), "@sub/a.lua", "symlink resolves into repo")
  eq(run(outside, "<Space>l"), "@" .. vim.fn.fnamemodify(outside, ":."), "outside repo falls back to cwd-relative")
  vim.cmd("silent! %bwipeout!")
end)

case("file_ref: relative() refuses paths outside the root, including sibling prefixes", function()
  local fr = require("utils.file_ref")
  local root = git_repo()
  vim.fn.mkdir(root .. "x", "p")
  write(root .. "x/f.lua", "")
  vim.uv.fs_symlink(root .. "/sub/a.lua", root .. "/link.lua")
  eq(fr.relative(root, root .. "/sub/a.lua"), "sub/a.lua", "inside")
  eq(fr.relative(root .. "/", root .. "/sub/a.lua"), "sub/a.lua", "trailing slash root")
  eq(fr.relative(root, root .. "/link.lua"), "sub/a.lua", "symlink resolved")
  eq(fr.relative(root, root .. "x/f.lua"), nil, "sibling with shared prefix")
  eq(fr.relative(root, "/etc/hosts"), nil, "outside")
end)

-- ── anchors ─────────────────────────────────────────────────────────────────

local view = require("inline_review.view")

local CODE = { "local M = {}", "", "function M.get()", "  local a = 1", "  return a", "end", "", "return M" }

local function thread_from(events)
  local numbered = {}
  for n, e in ipairs(events) do
    e.n = n
    numbered[n] = e
  end
  local threads = store.fold(numbered)
  return threads.c1
end

local base_events = function()
  return {
    comment("c1", { l = { 3, 6 }, snippet = { "function M.get()", "  local a = 1", "  return a", "end" } }),
    { ev = "sent", ids = { "c1" } },
  }
end

local function with(extra)
  local evs = base_events()
  for _, e in ipairs(extra) do
    table.insert(evs, e)
  end
  return evs
end

local function insert_above(lines, n)
  local out = {}
  for i = 1, n do
    out[i] = "-- added " .. i
  end
  vim.list_extend(out, lines)
  return out
end

case("anchor: response anchor accepted at its line", function()
  local t = thread_from(with({
    { ev = "response", id = "c1", status = "addressed", summary = "s", l = { 3, 5 }, anchor = "function M.get()" },
  }))
  local r = view.resolve(t, CODE)
  eq({ r.s, r.e, r.via.kind, r.estimated }, { 3, 5, "response", nil }, "resolved")
end)

case("anchor: lines inserted above before the response is read are followed by search", function()
  local t = thread_from(with({
    { ev = "response", id = "c1", status = "addressed", summary = "s", l = { 3, 5 }, anchor = "function M.get()" },
  }))
  local r = view.resolve(t, insert_above(CODE, 3))
  eq({ r.s, r.e }, { 6, 8 }, "shifted by 3")
end)

case("anchor: falls back to the comment snippet, then estimates without a match", function()
  local t = thread_from(
    with({ { ev = "response", id = "c1", status = "addressed", summary = "s", l = { 3, 5 }, anchor = "gone()" } })
  )
  local r = view.resolve(t, CODE)
  eq({ r.s, r.via.kind }, { 3, "comment" }, "comment snippet fallback")
  local r2 = view.resolve(t, { "totally", "different" })
  eq({ r2.s, r2.e, r2.estimated }, { 2, 2, true }, "clamped estimate")
end)

case("anchor: duplicate text resolves to the occurrence nearest the recorded line", function()
  local lines = { "end", "x", "end", "y", "y", "end", "z" }
  local t = thread_from({ comment("c1", { l = { 5, 6 }, snippet = { "end" } }) })
  eq(view.resolve(t, lines).s, 6, "nearest to 5")
end)

case("anchor: removed ranges keep a point in the middle, at the end and at the top", function()
  local mid = thread_from(with({
    {
      ev = "response",
      id = "c1",
      status = "addressed",
      summary = "s",
      l = { 3, 3 },
      anchor = "",
      removed = true,
      anchor_side = "before",
    },
  }))
  mid.evidence[#mid.evidence].lines = { "" }
  local lines = { "local M = {}", "", "return M" }
  local r = view.resolve(mid, lines)
  eq({ r.s, r.removed }, { 3, true }, "after line 2")
  r = view.resolve(mid, insert_above(lines, 2))
  eq(r.s, 5, "followed after offline insertion above")

  local eof = thread_from(with({
    {
      ev = "response",
      id = "c1",
      status = "addressed",
      summary = "s",
      l = { 4, 4 },
      anchor = "return M",
      removed = true,
      anchor_side = "before",
    },
  }))
  r = view.resolve(eof, { "local M = {}", "", "return M" })
  eq({ r.s, r.removed }, { 4, true }, "past the last line")

  local top = thread_from(with({
    {
      ev = "response",
      id = "c1",
      status = "addressed",
      summary = "s",
      l = { 1, 1 },
      anchor = "return M",
      removed = true,
      anchor_side = "after",
    },
  }))
  r = view.resolve(top, insert_above({ "return M" }, 0))
  eq({ r.s, r.removed }, { 1, true }, "top of file")
end)

-- ── buffer / disk sync ──────────────────────────────────────────────────────

local function load(path)
  vim.cmd("silent! %bwipeout!")
  vim.cmd.edit(vim.fn.fnameescape(path))
  return vim.api.nvim_get_current_buf()
end

case("sync: CRLF, noeol, empty, single newline, BOM and latin1 files read as in sync", function()
  local d = tmpdir()
  local files = {
    crlf = "a\r\nb\r\n",
    noeol = "abc",
    empty = "",
    newline = "\n",
    bom = "\239\187\191hello\n",
    latin1 = "caf\233\n",
  }
  for name, bytes in pairs(files) do
    write(d .. "/" .. name, bytes)
    local cmd = name == "latin1" and ("edit ++enc=latin1 " .. d .. "/" .. name) or nil
    local buf
    if cmd then
      vim.cmd("silent! %bwipeout!")
      vim.cmd(cmd)
      buf = vim.api.nvim_get_current_buf()
    else
      buf = load(d .. "/" .. name)
    end
    eq(view.synced(buf), true, name)
  end
  -- empty and single newline really differ
  local buf = load(d .. "/empty")
  write(d .. "/empty", "\n")
  eq(view.synced(buf), false, "empty buffer vs newline file")
  vim.cmd("silent! %bwipeout!")
end)

case("sync: an external rewrite that was not reloaded is out of sync, even with preserved mtime", function()
  local d = tmpdir()
  local path = d .. "/f.lua"
  write(path, "one\ntwo\n")
  local buf = load(path)
  local st = vim.uv.fs_stat(path)
  write(path, "one\nTWO\n")
  vim.uv.fs_utime(path, st.atime.sec, st.mtime.sec)
  eq(view.synced(buf), false, "stale buffer detected by content")
  vim.cmd("silent! %bwipeout!")
end)

case("lens: truncation keeps whole eojeol and drops a trailing sentence mark", function()
  eq(
    view.truncate("cwd fallback을 제거했습니다. root를 못 찾으면", 26),
    "cwd fallback을...",
    "eojeol boundary"
  )
  eq(view.truncate("제거했습니다. 다음 문장", 18), "제거했습니다...", "sentence mark dropped")
  eq(view.truncate("짧음", 20), "짧음", "short text untouched")
end)

-- ── end to end ──────────────────────────────────────────────────────────────

local ir = require("inline_review")
ir.setup()

local notes = {}
local real_notify = vim.notify
vim.notify = function(msg, level)
  table.insert(notes, msg)
  if level and level >= vim.log.levels.ERROR then
    real_notify(msg, level)
  end
end

local function input(text)
  vim.ui.input = function(_, cb)
    cb(text)
  end
end

local function decor_text(buf)
  local out = {}
  local ns = vim.api.nvim_get_namespaces().inline_review_decor
  for _, m in ipairs(vim.api.nvim_buf_get_extmarks(buf, ns, 0, -1, { details = true })) do
    for _, vl in ipairs(m[4].virt_lines or {}) do
      local s = ""
      for _, c in ipairs(vl) do
        s = s .. c[1]
      end
      table.insert(out, s)
    end
  end
  return table.concat(out, "\n")
end

local function e2e_repo()
  local root = git_repo()
  write(root .. "/sub/a.lua", table.concat(CODE, "\n") .. "\n")
  vim.cmd.cd(root)
  return root
end

case("e2e: comment → copy → agent edits and responds → re-anchored after reload → restart", function()
  local root = e2e_repo()
  local path = root .. "/sub/a.lua"
  local buf = load(path)
  vim.api.nvim_win_set_cursor(0, { 3, 0 })
  vim.cmd("normal! Vjj")
  input("다른 방법 없어?")
  ir.add(true)
  local log = store.log_path(root)
  local threads = fold_file(log)
  eq({ threads.c1.l, threads.c1.snippet[1] }, { { 3, 5 }, "function M.get()" }, "comment recorded")
  truthy(decor_text(buf):match("c1  DRAFT  you: 다른 방법 없어%?"), "draft lens: " .. decor_text(buf))

  notes = {}
  ir.yank()
  eq(vim.fn.getreg("+"), store.PROMPT_HEAD .. "\n[c1] @sub/a.lua#L3-5 다른 방법 없어?", "prompt copied")
  eq(notes[#notes], "Copied 1 comments (c1)", "copy notice")
  eq(fold_file(log).c1.state, "sent", "marked sent")
  ir.yank()
  eq(notes[#notes], "No draft comments to send", "nothing left")

  -- The agent edits the file (3 lines inserted above) and then responds.
  local edited = insert_above(CODE, 3)
  edited[7] = "  local a = 2"
  write(path, table.concat(edited, "\n") .. "\n")
  local r = cli(
    root,
    "--id",
    "c1",
    "--status",
    "addressed",
    "--summary",
    "상수로 정리",
    "--l",
    "6,8",
    "--anchor",
    "function M.get()"
  )
  eq(r.code, 0, "respond: " .. (r.stderr or ""))
  truthy(
    vim.wait(5000, function()
      local s = view.position(buf, "c1")
      return s == 6 and fold_file(log).c1.evidence[3] ~= nil
    end, 50),
    "re-anchored after the watcher reload"
  )
  eq(vim.api.nvim_buf_get_lines(buf, 6, 7, false)[1], "  local a = 2", "buffer reloaded")
  local t = fold_file(log).c1
  eq(
    { t.state, t.evidence[#t.evidence].kind, t.evidence[#t.evidence].l },
    { "answered", "move", { 6, 8 } },
    "move persisted"
  )
  truthy(decor_text(buf):match("ADDRESSED  agent: 상수로 정리"), "answered lens")

  -- Restart: a fresh process sees the same place from the log alone.
  local probe = vim.fn.tempname() .. ".lua"
  write(
    probe,
    string.format(
      [[
vim.opt.rtp:prepend(%q)
local ir = require("inline_review")
ir.setup()
vim.cmd.cd(%q)
vim.cmd.edit(%q)
vim.wait(200)
local s, e = require("inline_review.view").position(vim.api.nvim_get_current_buf(), "c1")
io.stdout:write(tostring(s) .. "," .. tostring(e))
]],
      vim.fn.fnamemodify(here .. "/..", ":p"),
      root,
      path
    )
  )
  local out = vim.system({ NVIM, "-u", "NONE", "--headless", "-l", probe }):wait(20000)
  eq(out.stdout, "6,8", "position after restart (" .. (out.stderr or "") .. ")")
  ir._stop()
  vim.cmd("silent! %bwipeout!")
end)

case("e2e: a thread on line 1 gets its header drawn as top filler", function()
  local root = e2e_repo()
  load(root .. "/sub/a.lua")
  vim.api.nvim_win_set_cursor(0, { 1, 0 })
  input("first line")
  ir.add(false)
  eq(vim.fn.winsaveview().topfill, 1, "topfill shows the header above line 1")
  ir._stop()
  vim.cmd("silent! %bwipeout!")
end)

case("e2e: ]r / [r cycle through threads and resolved threads hide until toggled", function()
  local root = e2e_repo()
  local buf = load(root .. "/sub/a.lua")
  for _, row in ipairs({ 3, 6, 8 }) do
    vim.api.nvim_win_set_cursor(0, { row, 0 })
    input("at " .. row)
    ir.add(false)
  end
  vim.api.nvim_win_set_cursor(0, { 1, 0 })
  local seen = {}
  for _ = 1, 4 do
    ir.jump(1)
    table.insert(seen, vim.api.nvim_win_get_cursor(0)[1])
  end
  eq(seen, { 3, 6, 8, 3 }, "]r wraps forward")
  ir.jump(-1)
  eq(vim.api.nvim_win_get_cursor(0)[1], 8, "[r wraps backward")

  vim.api.nvim_win_set_cursor(0, { 6, 0 })
  ir.resolve()
  truthy(not decor_text(buf):match("at 6"), "resolved thread hidden")
  ir.toggle_resolved()
  truthy(decor_text(buf):match("c2  RESOLVED  you: at 6"), "shown after toggle: " .. decor_text(buf))
  ir.toggle_resolved()
  truthy(not decor_text(buf):match("at 6"), "hidden again")
  ir._stop()
  vim.cmd("silent! %bwipeout!")
end)

case("e2e: a modified buffer shows (pending reload) and applies the response after saving", function()
  local root = e2e_repo()
  local path = root .. "/sub/a.lua"
  local buf = load(path)
  vim.api.nvim_win_set_cursor(0, { 3, 0 })
  input("rename?")
  ir.add(false)
  ir.yank()
  vim.api.nvim_buf_set_lines(buf, 0, 0, false, { "-- local edit" })
  local r =
    cli(root, "--id", "c1", "--status", "addressed", "--summary", "done", "--l", "3", "--anchor", "function M.get()")
  eq(r.code, 0, "respond")
  truthy(
    vim.wait(3000, function()
      return decor_text(buf):match("%(pending reload%)") ~= nil
    end, 50),
    "pending label: " .. decor_text(buf)
  )
  vim.cmd("silent write")
  truthy(
    vim.wait(3000, function()
      return view.position(buf, "c1") == 4 and not decor_text(buf):match("pending")
    end, 50),
    "applied after save at the shifted line: " .. tostring(view.position(buf, "c1"))
  )
  ir._stop()
  vim.cmd("silent! %bwipeout!")
end)

case("e2e: watcher's own move does not loop", function()
  local root = e2e_repo()
  local path = root .. "/sub/a.lua"
  load(path)
  vim.api.nvim_win_set_cursor(0, { 3, 0 })
  input("x")
  ir.add(false)
  ir.yank()
  local r =
    cli(root, "--id", "c1", "--status", "addressed", "--summary", "ok", "--l", "3", "--anchor", "function M.get()")
  eq(r.code, 0, "respond")
  local log = store.log_path(root)
  vim.wait(1500, function()
    return false
  end, 50)
  local size = #read(log)
  vim.wait(1500, function()
    return false
  end, 50)
  eq(#read(log), size, "log size converged")
  local moves = 0
  for _, e in ipairs(store.read(log)) do
    if e.ev == "move" then
      moves = moves + 1
    end
  end
  eq(moves, 1, "exactly one move for the response")
  ir._stop()
  vim.cmd("silent! %bwipeout!")
end)

case("e2e: edit is refused when the draft moved on, text kept in a register", function()
  local root = e2e_repo()
  load(root .. "/sub/a.lua")
  vim.api.nvim_win_set_cursor(0, { 3, 0 })
  input("first")
  ir.add(false)
  -- Another writer sends it while our edit prompt is open.
  vim.ui.input = function(_, cb)
    assert(store.transact(store.log_path(root), function()
      return { ev = "sent", ids = { "c1" } }
    end))
    cb("edited late")
  end
  ir.edit()
  eq(fold_file(store.log_path(root)).c1.msgs[1].body, "first", "edit not applied")
  eq(vim.fn.getreg('"'), "edited late", "text preserved")
  ir._stop()
  vim.cmd("silent! %bwipeout!")
end)

case("e2e: without a clipboard the prompt goes to the unnamed register", function()
  local root = e2e_repo()
  local probe = vim.fn.tempname() .. ".lua"
  write(
    probe,
    string.format(
      [[
vim.opt.rtp:prepend(%q)
local ir = require("inline_review")
ir.setup()
local seen
vim.notify = function(m) seen = m end
vim.ui.input = function(_, cb) cb("hi") end
vim.cmd.cd(%q)
vim.cmd.edit("sub/a.lua")
ir.add(false)
ir.yank()
io.stdout:write(vim.fn.getreg('"') .. "\n--\n" .. tostring(seen))
]],
      vim.fn.fnamemodify(here .. "/..", ":p"),
      root
    )
  )
  -- No clipboard tool on PATH: the provider has no executable.
  local out = vim
    .system({ NVIM, "-u", "NONE", "--headless", "-l", probe }, { env = { PATH = "/nonexistent" } })
    :wait(20000)
  eq(
    out.stdout,
    store.PROMPT_HEAD .. "\n[c1] @sub/a.lua#L1 hi\n--\nCopied 1 comments (c1) to the unnamed register (no clipboard)",
    "fallback (" .. (out.stderr or "") .. ")"
  )
end)

case("e2e: missing file is listed, outside-repo file refused", function()
  local root = e2e_repo()
  local outside = tmpdir() .. "/o.lua"
  write(outside, "x\n")
  load(outside)
  notes = {}
  input("nope")
  ir.add(false)
  eq(notes[#notes], "File is outside the repository", "outside refused")
  load(root .. "/sub/a.lua")
  input("keep")
  ir.add(false)
  vim.fn.delete(root .. "/sub/a.lua")
  write(root .. "/sub/b.lua", "x\n")
  load(root .. "/sub/b.lua")
  eq(vim.uv.fs_stat(root .. "/sub/a.lua"), nil, "file gone")
  eq(fold_file(store.log_path(root)).c1.file, "sub/a.lua", "thread kept for the picker")
  ir._stop()
  vim.cmd("silent! %bwipeout!")
end)

-- ── report ──────────────────────────────────────────────────────────────────

if #results.fail == 0 then
  print(string.format("ALL PASS (%d)", results.pass))
  os.exit(0)
end
for _, f in ipairs(results.fail) do
  print("FAIL " .. f)
end
print(string.format("%d passed, %d failed", results.pass, #results.fail))
os.exit(1)
