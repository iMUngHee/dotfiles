-- Headless checks for inline_review.
--   nvim --headless -u NONE --cmd "set rtp^=nvim" -l nvim/tests/inline_review_spec.lua
-- Run from the repository root. Prints ALL PASS and exits 0, or lists failures.

local here = vim.fn.fnamemodify(debug.getinfo(1, "S").source:sub(2), ":p:h")
local LUA_DIR = vim.fn.fnamemodify(here .. "/../lua", ":p")
local NVIM_DIR = vim.fn.fnamemodify(here .. "/..", ":p")
-- Absolute, so tests that :cd elsewhere still resolve the modules.
vim.opt.rtp:prepend(vim.fn.fnamemodify(here .. "/..", ":p"))
local store = require("inline_review.store")

local results = { pass = 0, fail = {}, ran = {} }
local only = arg and arg[1]

local function case(name, fn)
  if only and not name:find(only, 1, true) then
    return
  end
  local ok, err = xpcall(fn, debug.traceback)
  results.ran[name] = true
  if ok then
    results.pass = results.pass + 1
    print("ok " .. name)
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
vim.opt.rtp:prepend(%q) -- rtp wins over package.path in nvim; %q
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
  write(path, string.format(WRITER, NVIM_DIR, LUA_DIR))
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
  assert(store.transact(log, function(events)
    return comment(store.next_id(events))
  end))
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
  eq(nxt.id, "c3", "ids stay unique after a short write")
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
  local text = store.prompt(
    { { thread = threads.c3, l = { 13, 20 } }, { thread = threads.c4, l = { 8, 8 } } },
    "/r/.agents/state/review/main.jsonl",
    "abc123"
  )
  local lines = vim.split(text, "\n")
  eq(
    lines[1],
    "Review comments — handle each with the inline-review skill, then record one response per token with its respond command (log: /r/.agents/state/review/main.jsonl, id: abc123)",
    "head"
  )
  eq(lines[2], "[c3] @nvim/lua/utils/root.lua#L13-20 다른 방법 없어?", "first comment")
  eq(lines[3], '[c4.2] @a.lua#L8 (follow-up; your last: "renamed") not enough', "follow-up")
end)

-- ── branch logs (follow-up plan) ─────────────────────────────────────────────

local function header_of(log)
  return store.header(store.read(log))
end

local function add_comment(log, extra, opts)
  return store.transact(log, function(events)
    return comment(store.next_id(events), extra)
  end, opts)
end

case("name: branch names encode to collision-free file names", function()
  eq(store.encode("agent/x"), "agent%2Fx", "slash")
  eq(store.encode("Feat"), "%46eat", "upper case")
  truthy(store.encode("Feat") ~= store.encode("feat"), "case-insensitive FS safe")
  eq(store.encode("a%2Fb"), "a%252%46b", "percent itself")
  eq(store.encode("feat/로그"), "feat%2F%EB%A1%9C%EA%B7%B8", "hangul bytes")
  local long_a, long_b = string.rep("a", 200) .. "47208", string.rep("a", 200) .. "79382"
  local ea, eb = store.encode(long_a), store.encode(long_b)
  truthy(#ea <= 200 and #eb <= 200, "shortened")
  truthy(ea ~= eb, "same 150-byte prefix still distinct")
  eq(store.encode(long_a), ea, "deterministic")
  eq(vim.fs.basename(store.log_path("/r", nil)), ".detached.jsonl", "detached")
  eq(store.root_of("/r/x/.agents/state/review/main.jsonl"), "/r/x", "root of live log")
  eq(store.root_of("/r/x/.agents/state/review/archive/main.abc.jsonl"), nil, "archive is not a live log")
  eq(store.root_of("rel/.agents/state/review/main.jsonl"), nil, "relative path refused")
end)

case("header: first write adds a log header; floor survives in id allocation", function()
  local root = tmpdir()
  local log = store.log_path(root, "main")
  local ev = assert(add_comment(log, nil, { branch = "main" }))
  local events = store.read(log)
  eq(events[1].ev, "log", "header first")
  truthy(events[1].id:match("^%x+$") and #events[1].id == 12, "12 hex id")
  eq({ events[1].branch, ev.id }, { "main", "c1" }, "branch and first id")
  write(log, jl({ ev = "log", id = "zzz", branch = "main", floor = 40 }), "ab")
  eq(header_of(log).id, events[1].id, "first header wins")
  eq(store.next_id(store.read(log)), "c41", "floor raises the next id")
end)

case("header: a log naming another branch refuses writes", function()
  local root = tmpdir()
  local log = store.log_path(root, "main")
  assert(add_comment(log, nil, { branch = "main" }))
  local before = read(log)
  local ev, err = add_comment(log, nil, { branch = "Main" })
  eq({ ev, err }, { nil, "collision" }, "collision")
  eq(read(log), before, "bytes unchanged")
end)

case("transact: expect_id and create=false refuse before touching any byte", function()
  local root = tmpdir()
  local log = store.log_path(root, "main")
  assert(add_comment(log, nil, { branch = "main" }))
  write(log, '{"ev":', "ab")
  local before = read(log)
  local ev, err = add_comment(log, nil, { expect_id = "nope" })
  eq({ ev, err }, { nil, "changed" }, "wrong id")
  eq(read(log), before, "tail not repaired on refusal")
  local other = store.log_path(root, "gone")
  ev, err = add_comment(other, nil, { expect_id = "x", create = false })
  eq({ ev, err }, { nil, "missing" }, "missing log")
  eq(vim.uv.fs_stat(other), nil, "not created")
  local elsewhere = tmpdir() .. "/.agents/state/review/main.jsonl"
  ev, err = add_comment(elsewhere, nil, { create = false })
  eq({ ev, err }, { nil, "missing" }, "missing directory")
  eq(vim.fn.isdirectory(vim.fs.dirname(elsewhere)), 0, "directory not created")
  ev, err = add_comment(log, nil, {
    check = function()
      return "branch switched"
    end,
  })
  eq({ ev, err }, { nil, "changed" }, "check refuses")
  eq(read(log), before, "unchanged after check refusal")
end)

case("fold: resolve{ids} resolves several threads in one event", function()
  local root = tmpdir()
  local log = store.log_path(root, "main")
  for _ = 1, 3 do
    assert(add_comment(log, nil, { branch = "main" }))
  end
  assert(store.transact(log, function()
    return { ev = "resolve", ids = { "c1", "c3" } }
  end))
  local threads = fold_file(log)
  eq({ threads.c1.state, threads.c2.state, threads.c3.state }, { "resolved", "draft", "resolved" }, "states")
  eq(#vim.tbl_filter(function(e)
    return e.ev == "resolve"
  end, store.read(log)), 1, "one event")
end)

case("legacy: headerless comments.jsonl moves to the branch log and is adopted", function()
  local root = tmpdir()
  local dir = store.dir(root)
  vim.fn.mkdir(dir, "p")
  write(dir .. "/comments.jsonl", jl(comment("c1")) .. '{"ev":"sent"')
  local target = store.log_path(root, "main")
  eq(store.migrate_legacy(root, target), "moved", "moved")
  eq(vim.uv.fs_stat(dir .. "/comments.jsonl"), nil, "legacy gone")
  local ev = assert(add_comment(target, nil, { branch = "main" }))
  eq(ev.id, "c2", "history kept")
  eq(header_of(target).branch, "main", "adopted with a header")
  -- A branch literally named "comments" adopts the file in place.
  local r2 = tmpdir()
  vim.fn.mkdir(store.dir(r2), "p")
  write(store.dir(r2) .. "/comments.jsonl", jl(comment("c1")))
  local same = store.log_path(r2, "comments")
  eq(store.migrate_legacy(r2, same), "none", "source is the target")
  assert(add_comment(same, nil, { branch = "comments" }))
  eq(header_of(same).branch, "comments", "adopted in place")
  -- Target already exists: both kept, reported.
  local r3 = tmpdir()
  local t3 = store.log_path(r3, "main")
  assert(add_comment(t3, nil, { branch = "main" }))
  write(store.dir(r3) .. "/comments.jsonl", jl(comment("c1")))
  eq(store.migrate_legacy(r3, t3), "both", "both reported")
  truthy(vim.uv.fs_stat(store.dir(r3) .. "/comments.jsonl"), "legacy kept")
end)

case("legacy: migration waits for a writer holding the legacy lock", function()
  local root = tmpdir()
  local dir = store.dir(root)
  vim.fn.mkdir(dir, "p")
  local legacy = dir .. "/comments.jsonl"
  write(legacy, jl(comment("c1")))
  vim.fn.mkdir(legacy .. ".lock", "p")
  local target = store.log_path(root, "main")
  eq(store.migrate_legacy(root, target), "locked", "not moved while the legacy lock is held")
  truthy(vim.uv.fs_stat(legacy) and not vim.uv.fs_stat(target), "nothing moved")
  vim.uv.fs_rmdir(legacy .. ".lock")
  eq(store.migrate_legacy(root, target), "moved", "moved after release")
end)

-- ── rotation ────────────────────────────────────────────────────────────────

local function rotation_fixture()
  local root = tmpdir()
  local log = store.log_path(root, "main")
  for i = 1, 4 do
    assert(add_comment(log, { l = { i, i }, snippet = { "line " .. i } }, { branch = "main" }))
  end
  assert(store.transact(log, function()
    return { ev = "sent", ids = { "c1", "c2", "c3", "c4" } }
  end))
  assert(store.transact(log, function()
    return { ev = "response", id = "c2", status = "addressed", summary = "s", l = { 9, 9 }, anchor = "line 2" }
  end))
  local latest = fold_file(log).c2.evidence
  assert(store.transact(log, function()
    return { ev = "move", id = "c2", l = { 10, 10 }, snippet = { "line 2" }, base = latest[#latest].n }
  end))
  assert(store.transact(log, function()
    return { ev = "resolve", ids = { "c1", "c3" } }
  end))
  return root, log
end

local function sha(path)
  return vim.fn.sha256(read(path))
end

case("rotate: open threads continue under a new id; the old file is archived byte for byte", function()
  local root, log = rotation_fixture()
  local old = read(log)
  local old_head = header_of(log)
  local before = fold_file(log)
  local ev, _, _, info = store.transact(log, function()
    return { ev = "reply", id = "c4", body = "more" }
  end, { rotate_bytes = 10 })
  truthy(ev and info.rotated, "rotated")
  local head = header_of(log)
  truthy(head.id ~= old_head.id and info.id == head.id, "new identity reported")
  eq(head.floor, 4, "floor")
  local archived = store.archive_dir(root) .. "/main." .. old_head.id .. ".jsonl"
  truthy(read(archived):sub(1, #old) == old, "old bytes preserved")
  local threads, order = fold_file(log)
  eq(order, { "c2", "c4" }, "only open threads")
  eq(threads.c2.evidence[#threads.c2.evidence].l, { 10, 10 }, "move kept with a remapped base")
  eq(
    threads.c2.evidence[#threads.c2.evidence].origin,
    before.c2.evidence[#before.c2.evidence].origin,
    "origin preserved"
  )
  for _, e in ipairs(store.read(log)) do
    if e.ids then
      for _, id in ipairs(e.ids) do
        truthy(id ~= "c1" and id ~= "c3", "closed ids filtered from " .. e.ev)
      end
    end
  end
  eq(select(1, add_comment(log, nil, { branch = "main" })).id, "c5", "next id above floor")
  local st = vim.uv.fs_stat(archived)
  eq(st.nlink, 1, "archive no longer shares the live inode")
end)

case("rotate: repeated rotation never lowers the floor; all-resolved leaves only a header", function()
  local _, log = rotation_fixture()
  assert(store.transact(log, function()
    return { ev = "resolve", ids = { "c2" } }
  end, { rotate_bytes = 10 }))
  assert(store.transact(log, function()
    return { ev = "resolve", id = "c4" }
  end, { rotate_bytes = 10 }))
  local events = store.read(log)
  eq(#events, 1, "header only")
  eq(events[1].floor, 4, "floor kept")
end)

case("rotate: nothing closed means no rotation", function()
  local root = tmpdir()
  local log = store.log_path(root, "main")
  assert(add_comment(log, nil, { branch = "main" }))
  local _, _, _, info = add_comment(log, nil, { branch = "main", rotate_bytes = 10 })
  eq(info.rotated, false, "not rotated")
end)

case("rotate: failures keep the append, warn, and leave no duplicates", function()
  for _, step in ipairs({ "tmp", "link" }) do
    local root, log = rotation_fixture()
    store.on_rotate = function(s)
      if s == step then
        error("injected " .. s)
      end
    end
    local ev, _, _, info = store.transact(log, function()
      return { ev = "reply", id = "c4", body = "x" }
    end, { rotate_bytes = 10 })
    store.on_rotate = nil
    truthy(ev and info.rotate_error and not info.rotated, step .. ": append kept, error reported")
    local n = 0
    for _, e in ipairs(store.read(log)) do
      if e.ev == "reply" then
        n = n + 1
      end
    end
    eq(n, 1, step .. ": reply written once")
    -- The next transact recovers: no tmp, no archive link sharing the inode.
    assert(add_comment(log, nil, { branch = "main" }))
    eq(vim.uv.fs_stat(log .. ".tmp"), nil, step .. ": tmp removed")
    eq(vim.uv.fs_stat(log).nlink, 1, step .. ": no shared archive link")
    for name in vim.fs.dir(store.archive_dir(root)) do
      if name ~= ".gitignore" then
        error(step .. ": unpublished archive left behind: " .. name)
      end
    end
  end
end)

local CRASH = [[
vim.opt.rtp:prepend(%q) -- rtp wins over package.path in nvim; %q
local store = require("inline_review.store")
store.on_rotate = function(s) if s == arg[2] then os.exit(3) end end
store.transact(arg[1], function() return { ev = "reply", id = "c4", body = "crash" } end, { rotate_bytes = 10 })
]]

case("rotate: a real crash after each step is recovered after an explicit unlock", function()
  local script = vim.fn.tempname() .. ".lua"
  write(script, string.format(CRASH, NVIM_DIR, LUA_DIR))
  for _, step in ipairs({ "tmp", "link" }) do
    local root, log = rotation_fixture()
    local r = vim.system({ NVIM, "-u", "NONE", "--headless", "-l", script, log, step }):wait(20000)
    eq(r.code, 3, step .. ": crashed (" .. (r.stderr or "") .. (r.stdout or "") .. ")")
    truthy(vim.uv.fs_stat(log .. ".lock"), step .. ": lock left behind")
    local live_before = sha(log)
    -- A refused transact must not touch the live bytes.
    store.unlock(log)
    local ev, err = add_comment(log, nil, { expect_id = "wrong" })
    eq({ ev, err }, { nil, "changed" }, step .. ": refused")
    eq(sha(log), live_before, step .. ": live bytes untouched by recovery")
    eq(#store.prune(root, 0, os.time() + 10), 0, step .. ": prune skips nothing it should keep")
    assert(add_comment(log, nil, { branch = "main" }))
    local replies = 0
    for _, e in ipairs(store.read(log)) do
      replies = replies + (e.ev == "reply" and 1 or 0)
    end
    eq(replies, 1, step .. ": crashed append kept once")
    eq(vim.uv.fs_stat(log).nlink, 1, step .. ": shared link removed")
  end
end)

local READER = [[
vim.opt.rtp:prepend(%q) -- rtp wins over package.path in nvim; %q
local store = require("inline_review.store")
local events = store.read(arg[1])
io.stdout:write(store.header(events).id .. " " .. #events)
]]

case("rotate: a reader between link and replace sees the whole old file", function()
  local _, log = rotation_fixture()
  local reader = vim.fn.tempname() .. ".lua"
  write(reader, string.format(READER, NVIM_DIR, LUA_DIR))
  local old_id = header_of(log).id
  local seen
  store.on_rotate = function(s)
    if s == "link" then
      seen = vim.system({ NVIM, "-u", "NONE", "--headless", "-l", reader, log }):wait(20000).stdout
    end
  end
  assert(store.transact(log, function()
    return { ev = "reply", id = "c4", body = "x" }
  end, { rotate_bytes = 10 }))
  store.on_rotate = nil
  truthy(seen and seen:match("^" .. old_id .. " "), "old identity mid-rotation: " .. tostring(seen))
  local n = tonumber(seen:match(" (%d+)$"))
  truthy(n and n > 8, "complete old file (" .. tostring(n) .. " events)")
end)

-- ── ended branches and prune ────────────────────────────────────────────────

case("ended: logs of vanished branches move to the archive; live, detached and failed git stay", function()
  local root = tmpdir()
  local keep, gone = store.log_path(root, "main"), store.log_path(root, "old/x")
  local det = store.log_path(root, nil)
  assert(add_comment(keep, nil, { branch = "main" }))
  assert(add_comment(gone, nil, { branch = "old/x" }))
  assert(add_comment(det, nil, {}))
  local old_time = os.time() - 40 * 86400
  vim.uv.fs_utime(gone, old_time, old_time)
  local gone_id = header_of(gone).id
  eq(
    store.archive_ended(root, function()
      return nil
    end),
    {},
    "git failure archives nothing"
  )
  truthy(vim.uv.fs_stat(gone), "kept on git failure")
  eq(
    store.archive_ended(root, function()
      return { main = true }
    end),
    { "old/x" },
    "archived"
  )
  local archived = store.archive_dir(root) .. "/old%2Fx." .. gone_id .. ".jsonl"
  truthy(vim.uv.fs_stat(archived) and not vim.uv.fs_stat(gone), "renamed into archive")
  truthy(vim.uv.fs_stat(keep) and vim.uv.fs_stat(det), "live and detached kept")
  eq(store.prune(root), {}, "fresh archive entry survives prune even though the log was idle 40 days")
  -- Retention counts from archive entry.
  local t29, t31 = os.time() - 29 * 86400, os.time() - 31 * 86400
  vim.uv.fs_utime(archived, t31, t31)
  local young = store.archive_dir(root) .. "/young.aaa.jsonl"
  write(young, jl({ ev = "log", id = "aaa", branch = "young", floor = 0 }))
  vim.uv.fs_utime(young, t29, t29)
  eq(store.prune(root), { "old%2Fx." .. gone_id .. ".jsonl" }, "31 days removed, 29 kept")
end)

case("ended: identity is re-read under the lock and name clashes get a suffix", function()
  local root = tmpdir()
  local gone = store.log_path(root, "gone")
  assert(add_comment(gone, nil, { branch = "gone" }))
  local id = header_of(gone).id
  vim.fn.mkdir(store.archive_dir(root), "p")
  write(store.archive_dir(root) .. "/gone." .. id .. ".jsonl", "occupied\n")
  local calls = 0
  eq(
    store.archive_ended(root, function()
      calls = calls + 1
      return {}
    end),
    { "gone" },
    "archived"
  )
  eq(calls, 2, "git re-checked under the lock")
  truthy(vim.uv.fs_stat(store.archive_dir(root) .. "/gone." .. id .. ".1.jsonl"), "suffixed")
  eq(read(store.archive_dir(root) .. "/gone." .. id .. ".jsonl"), "occupied\n", "existing archive untouched")
end)

-- ── cli ─────────────────────────────────────────────────────────────────────

local CLI = LUA_DIR .. "inline_review/cli.lua"

local function cli(log, id, ...)
  return vim
    .system({ NVIM, "-u", "NONE", "--headless", "-l", CLI, "respond", "--log", log, "--log-id", id, ... })
    :wait(30000)
end

-- A log on branch "main" whose c1 was sent; returns log, log id.
local function sent_thread(root)
  local log = store.log_path(root, "main")
  assert(store.transact(log, function()
    return comment("c1")
  end, { branch = "main" }))
  assert(store.transact(log, function()
    return { ev = "sent", ids = { "c1" } }
  end))
  return log, store.header(store.read(log)).id
end

case("cli: rejects invalid arguments with exit 2 and leaves the log unchanged", function()
  local root = tmpdir()
  local log, id = sent_thread(root)
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
    local r = cli(log, id, unpack(args))
    eq(r.code, 2, "exit for " .. table.concat(args, " ") .. " (" .. (r.stderr or "") .. ")")
  end
  eq(read(log), before, "log unchanged")
end)

case("cli: refuses a missing log, a wrong id and non-live paths without writing", function()
  local root = tmpdir()
  local log, id = sent_thread(root)
  write(log, '{"ev":', "ab")
  local before = read(log)
  local r = cli(log, "000000000000", "--id", "c1", "--status", "addressed", "--summary", "x")
  eq(r.code, 2, "wrong id (" .. r.stderr .. ")")
  truthy(r.stderr:match("log id mismatch"), "mismatch message")
  eq(read(log), before, "bytes unchanged, tail not repaired")
  local gone = store.log_path(root, "gone")
  r = cli(gone, id, "--id", "c1", "--status", "addressed", "--summary", "x")
  eq(r.code, 1, "missing log")
  truthy(r.stderr:match("log not found"), "missing message")
  eq(vim.uv.fs_stat(gone), nil, "not created")
  local elsewhere = tmpdir() .. "/.agents/state/review/main.jsonl"
  r = cli(elsewhere, id, "--id", "c1", "--status", "addressed", "--summary", "x")
  eq({ r.code, vim.fn.isdirectory(vim.fs.dirname(elsewhere)) }, { 1, 0 }, "missing directory not created")
  for _, bad in ipairs({ store.archive_dir(root) .. "/main." .. id .. ".jsonl", "rel/.agents/state/review/main.jsonl" }) do
    r = cli(bad, id, "--id", "c1", "--status", "addressed", "--summary", "x")
    eq(r.code, 2, "not a live log: " .. bad)
  end
  eq(read(log), before, "still unchanged")
end)

case("cli: a response from another checkout lands in the prompt's log only", function()
  local root = tmpdir()
  vim.system({ "git", "init", "-q", root }):wait()
  write(root .. "/f.lua", "x\n")
  vim.system({ "git", "-C", root, "-c", "user.email=t@t", "-c", "user.name=t", "add", "." }):wait()
  vim.system({ "git", "-C", root, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "i" }):wait()
  local wt = root .. "/.agents/worktrees/wt"
  vim.system({ "git", "-C", root, "worktree", "add", "-q", wt, "-b", "wt" }):wait()
  local main_log, main_id = sent_thread(root)
  local wt_log = sent_thread(wt)
  local wt_before = read(wt_log)
  local r = vim
    .system({
      NVIM,
      "-u",
      "NONE",
      "--headless",
      "-l",
      CLI,
      "respond",
      "--log",
      main_log,
      "--log-id",
      main_id,
      "--id",
      "c1",
      "--status",
      "addressed",
      "--summary",
      "from the worktree",
    }, { cwd = wt })
    :wait(30000)
  eq(r.code, 0, "respond (" .. r.stderr .. ")")
  eq(fold_file(main_log).c1.state, "answered", "main thread answered")
  eq(read(wt_log), wt_before, "worktree log untouched")
end)

case("cli: records response, removed and moved-file anchors", function()
  local root = tmpdir()
  local log, id = sent_thread(root)
  local r = cli(
    log,
    id,
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
    log,
    id,
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
    log,
    id,
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
  local log, id = sent_thread(root)
  write(log, jl({ ev = "reply", id = "c1", body = "more" }), "ab")
  local r = cli(log, id, "--id", "c1", "--status", "addressed", "--summary", "late")
  eq(r.code, 0, "exit")
  truthy(r.stderr:match("not waiting"), "note on stderr")
  eq(fold_file(log).c1.state, "draft", "state unchanged")
end)

case("cli: a deleted thread is refused with its own message and no write", function()
  local root = tmpdir()
  local log, id = sent_thread(root)
  write(log, jl({ ev = "delete", id = "c1" }), "ab")
  local before = read(log)
  local r = cli(log, id, "--id", "c1", "--status", "addressed", "--summary", "x")
  eq(r.code, 2, "exit")
  truthy(r.stderr:match("c1 was deleted"), "deleted message: " .. (r.stderr or ""))
  r = cli(log, id, "--id", "c9", "--status", "addressed", "--summary", "x")
  eq(r.code, 2, "unknown exit")
  truthy(r.stderr:match("unknown id c9"), "unknown message: " .. (r.stderr or ""))
  eq(read(log), before, "log unchanged")
end)

case("cli: 64KB records from CLI and nvim writers interleave under the lock without loss", function()
  local root = tmpdir()
  local log, id = sent_thread(root)
  local hold = vim.fn.tempname() .. ".lua"
  write(
    hold,
    string.format(
      [[
vim.opt.rtp:prepend(%q) -- rtp wins over package.path in nvim; %q
local store = require("inline_review.store")
store.on_locked = function() vim.uv.sleep(40) end
local big = string.rep("가", 22000)
for i = 1, 8 do
  assert(store.transact(arg[1], function(events)
    return { ev = "comment", id = store.next_id(events), file = "h.lua", l = { i, i }, snippet = { big }, body = "hold" .. i }
  end))
end
]],
      NVIM_DIR,
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
        "--log",
        log,
        "--log-id",
        id,
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

case("modal: side-by-side diff renders at widths past format's 99-column limit", function()
  local t = { id = "c1", state = "sent", msgs = { { who = "you", body = "x" } }, snippet = { "old" } }
  for _, width in ipairs({ 110, 208, 420 }) do
    local ok, rows = pcall(view.thread_rows, t, width, { "new" })
    truthy(ok, "width " .. width .. ": " .. tostring(rows))
    local header = rows[#rows - 1][1][1]
    eq(vim.fn.strdisplaywidth(header), math.floor((width - 5) / 2), "header padded at " .. width)
  end
end)

-- ── end to end ──────────────────────────────────────────────────────────────

local ir = require("inline_review")
ir.setup()

-- Branch log of a test repository and its id.
local function blog(root)
  local b =
    vim.trim(vim.system({ "git", "-C", root, "symbolic-ref", "--short", "HEAD" }, { text = true }):wait().stdout)
  return store.log_path(root, b)
end

local function lid(root)
  return store.header(store.read(blog(root))).id
end

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
  local log = blog(root)
  local threads = fold_file(log)
  eq({ threads.c1.l, threads.c1.snippet[1] }, { { 3, 5 }, "function M.get()" }, "comment recorded")
  truthy(decor_text(buf):match("c1  DRAFT  you: 다른 방법 없어%?"), "draft lens: " .. decor_text(buf))

  notes = {}
  ir.yank()
  eq(
    vim.fn.getreg("+"),
    store.prompt_head(log, lid(root)) .. "\n[c1] @sub/a.lua#L3-5 다른 방법 없어?",
    "prompt copied"
  )
  eq(notes[#notes], "Copied 1 comments (c1)", "copy notice")
  eq(fold_file(log).c1.state, "sent", "marked sent")
  ir.yank()
  eq(notes[#notes], "No draft comments to send", "nothing left")

  -- The agent edits the file (3 lines inserted above) and then responds.
  local edited = insert_above(CODE, 3)
  edited[7] = "  local a = 2"
  write(path, table.concat(edited, "\n") .. "\n")
  local r = cli(
    blog(root),
    lid(root),
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

local function sh(root, ...)
  local r = vim.system({ "git", "-C", root, "-c", "user.email=t@t", "-c", "user.name=t", ... }, { text = true }):wait()
  assert(r.code == 0, table.concat({ ... }, " ") .. ": " .. (r.stderr or ""))
  return r.stdout
end

local function committed_repo()
  local root = e2e_repo()
  sh(root, "add", ".")
  sh(root, "commit", "-qm", "init")
  return root, vim.trim(sh(root, "symbolic-ref", "--short", "HEAD"))
end

local function events_in(log, kind)
  return vim.tbl_filter(function(e)
    return e.ev == kind
  end, store.read(log))
end

case("e2e: threads follow the branch; a switch without log changes is picked up and announced once", function()
  local root, main = committed_repo()
  local buf = load(root .. "/sub/a.lua")
  vim.api.nvim_win_set_cursor(0, { 3, 0 })
  input("on main")
  ir.add(false)
  truthy(decor_text(buf):match("on main"), "shown on " .. main)
  sh(root, "switch", "-q", "-c", "other")
  notes = {}
  ir._poll(buf)
  ir._poll(buf)
  eq(
    vim.tbl_filter(function(n)
      return n == "Review threads: other"
    end, notes),
    { "Review threads: other" },
    "announced once"
  )
  eq(decor_text(buf), "", "hidden on other")
  ir.yank()
  eq(notes[#notes], "No draft comments to send", "not sent from other")
  ir.jump(1)
  eq(notes[#notes], "No review threads in this buffer", "]r skips it")
  sh(root, "switch", "-q", main)
  ir._poll(buf)
  truthy(decor_text(buf):match("on main"), "back on " .. main)
  truthy(
    vim.uv.fs_stat(store.log_path(root, main)) and not vim.uv.fs_stat(store.log_path(root, "other")),
    "one log per branch"
  )
  ir._stop()
  vim.cmd("silent! %bwipeout!")
end)

case("e2e: linked worktrees keep their own branch logs; a worktree's branch is never archived", function()
  local root, main = committed_repo()
  local wt = root .. "/.agents/worktrees/wt"
  sh(root, "worktree", "add", "-q", wt, "-b", "wtb")
  -- A stale log for wtb in the main checkout must survive cleanup: wtb is checked out in wt.
  assert(store.transact(store.log_path(root, "wtb"), function()
    return comment("c1")
  end, { branch = "wtb" }))
  local buf = load(wt .. "/sub/a.lua")
  input("in worktree")
  ir.add(false)
  truthy(vim.uv.fs_stat(store.log_path(wt, "wtb")), "worktree log on its branch")
  eq(vim.uv.fs_stat(store.log_path(root, main)), nil, "main log untouched")
  truthy(decor_text(buf):match("in worktree"), "shown in worktree")
  load(root .. "/sub/a.lua")
  ir._poll(vim.api.nvim_get_current_buf(), true)
  truthy(vim.uv.fs_stat(store.log_path(root, "wtb")), "worktree branch log kept")
  ir._stop()
  vim.cmd("silent! %bwipeout!")
end)

case("e2e: detached HEAD uses .detached and comes back; unreadable HEAD refuses writes", function()
  local root, main = committed_repo()
  local buf = load(root .. "/sub/a.lua")
  input("on main")
  ir.add(false)
  local head = root .. "/.git/HEAD"
  local saved = read(head)
  write(head, vim.trim(sh(root, "rev-parse", "HEAD")) .. "\n")
  notes = {}
  ir._poll(buf)
  eq(notes[#notes], "Review threads: detached", "rebase-like detached")
  eq(decor_text(buf), "", "main threads hidden")
  input("while detached")
  ir.add(false)
  truthy(vim.uv.fs_stat(store.log_path(root, nil)), ".detached log")
  write(head, saved)
  ir._poll(buf)
  truthy(decor_text(buf):match("on main") and not decor_text(buf):match("while detached"), "back on " .. main)
  vim.uv.fs_rename(head, head .. ".off")
  local before = read(store.log_path(root, main))
  notes = {}
  input("blind")
  ir.add(false)
  vim.uv.fs_rename(head .. ".off", head)
  eq(read(store.log_path(root, main)), before, "nothing written with HEAD unreadable")
  truthy(notes[#notes]:match("could not read HEAD"), "refusal notice: " .. tostring(notes[#notes]))
  ir._stop()
  vim.cmd("silent! %bwipeout!")
end)

case("e2e: a branch switch while the input is open writes nowhere and keeps the text", function()
  local root, main = committed_repo()
  load(root .. "/sub/a.lua")
  input("seed")
  ir.add(false)
  local main_before = read(store.log_path(root, main))
  vim.ui.input = function(_, cb)
    sh(root, "switch", "-q", "-c", "elsewhere")
    cb("typed while switching")
  end
  ir.add(false)
  eq(read(store.log_path(root, main)), main_before, "main log unchanged")
  eq(vim.uv.fs_stat(store.log_path(root, "elsewhere")), nil, "no log created on the new branch")
  eq(vim.fn.getreg('"'), "typed while switching", "text kept")
  ir._stop()
  vim.cmd("silent! %bwipeout!")
end)

-- Rotation from another writer: add and resolve a throwaway thread, then force rotation.
local function external_rotation(log)
  local ev = assert(store.transact(log, function(events)
    return comment(store.next_id(events), { file = "other.lua" })
  end))
  local _, _, _, info = assert(store.transact(log, function()
    return { ev = "resolve", id = ev.id }
  end, { rotate_bytes = 10 }))
  assert(info.rotated, "rotated")
end

local REPEATED = { "x = 1", "y = 2", "x = 1", "z = 3", "x = 1", "w = 4" }

local function rotation_repo()
  local root, main = committed_repo()
  write(root .. "/sub/a.lua", table.concat(REPEATED, "\n") .. "\n")
  sh(root, "commit", "-qam", "repeated")
  local buf = load(root .. "/sub/a.lua")
  vim.api.nvim_win_set_cursor(0, { 5, 0 })
  input("the third x")
  ir.add(false)
  return root, store.log_path(root, main), buf
end

case(
  "e2e: rotation keeps the tracked line in a dirty buffer and records it under the new generation on save",
  function()
    for _, rotations in ipairs({ 1, 2 }) do
      local root, log, buf = rotation_repo()
      vim.api.nvim_buf_set_lines(buf, 0, 0, false, { "-- a", "-- b" })
      eq(view.position(buf, "c1"), 7, "followed the unsaved insert")
      for _ = 1, rotations do
        external_rotation(log)
      end
      truthy(
        vim.wait(3000, function()
          return ir.refresh(root).log_id == header_of(log).id
        end, 50),
        "refreshed"
      )
      ir.render_root(root)
      eq(view.position(buf, "c1"), 7, rotations .. " rotation(s): extmark kept, not re-resolved to another x")
      eq(#events_in(log, "move"), 0, "no move while dirty")
      vim.cmd("silent write")
      truthy(
        vim.wait(3000, function()
          return #events_in(log, "move") == 1
        end, 50),
        "one move after save"
      )
      local mv = events_in(log, "move")[1]
      eq(mv.l, { 7, 7 }, "recorded at the kept line")
      eq(fold_file(log).c1.evidence[#fold_file(log).c1.evidence].kind, "move", "accepted in the new generation")
      ir._stop()
      vim.cmd("silent! %bwipeout!")
    end
  end
)

case("e2e: after a rotation a new response is still pending until the buffer syncs", function()
  local root, log, buf = rotation_repo()
  ir.yank()
  vim.api.nvim_buf_set_lines(buf, 0, 0, false, { "-- a" })
  external_rotation(log)
  local r = cli(
    log,
    header_of(log).id,
    "--id",
    "c1",
    "--status",
    "addressed",
    "--summary",
    "moved",
    "--l",
    "4",
    "--anchor",
    "z = 3"
  )
  eq(r.code, 0, "respond (" .. r.stderr .. ")")
  truthy(
    vim.wait(3000, function()
      return decor_text(buf):match("%(pending reload%)") ~= nil
    end, 50),
    "pending: " .. decor_text(buf)
  )
  eq(view.position(buf, "c1"), 6, "kept meanwhile")
  vim.cmd("silent write")
  truthy(
    vim.wait(3000, function()
      return view.position(buf, "c1") == 5
    end, 50),
    "re-resolved to the response anchor (z = 3 is line 5 now): " .. tostring(view.position(buf, "c1"))
  )
  ir._stop()
  vim.cmd("silent! %bwipeout!")
end)

local function answered_repo()
  local root, main = committed_repo()
  load(root .. "/sub/a.lua")
  for _, row in ipairs({ 1, 3, 5 }) do
    vim.api.nvim_win_set_cursor(0, { row, 0 })
    input("at " .. row)
    ir.add(false)
  end
  ir.yank()
  local log = store.log_path(root, main)
  for _, id in ipairs({ "c1", "c2" }) do
    local r = cli(log, header_of(log).id, "--id", id, "--status", "addressed", "--summary", "done " .. id)
    assert(r.code == 0, r.stderr)
  end
  ir.refresh(root)
  return root, main, log
end

local real_confirm = vim.fn.confirm

case("bulk: <leader>aX resolves answered threads in one event after confirmation", function()
  local root, _, log = answered_repo()
  notes = {}
  vim.fn.confirm = function(q)
    table.insert(notes, q)
    return 2
  end
  ir.resolve_answered()
  eq(notes[#notes], "Resolve 2 answered threads (c1, c2)?", "question")
  eq(#events_in(log, "resolve"), 0, "No leaves it")
  vim.fn.confirm = function()
    -- another writer replies to c2 while the dialog is open
    assert(store.transact(log, function()
      return { ev = "reply", id = "c2", body = "wait" }
    end))
    return 1
  end
  ir.resolve_answered()
  vim.fn.confirm = real_confirm
  local ev = events_in(log, "resolve")
  eq(#ev, 1, "one event")
  eq(ev[1].ids, { "c1" }, "c2 excluded after its reply")
  eq(notes[#notes], "Resolved 1 threads (c1)", "notice")
  local threads = fold_file(log)
  eq({ threads.c1.state, threads.c2.state, threads.c3.state }, { "resolved", "draft", "sent" }, "states")
  ir.resolve_answered()
  eq(notes[#notes], "No answered threads to resolve", "nothing left")
  ir._stop()
  vim.cmd("silent! %bwipeout!")
end)

case("picker: entries tag other branches and the archive; resolving skips archived ones", function()
  local root, main, log = answered_repo()
  local other = store.log_path(root, "feat/x")
  assert(store.transact(other, function()
    return comment("c1", { body = "on feat" })
  end, { branch = "feat/x" }))
  local old = store.log_path(root, "old")
  assert(store.transact(old, function()
    return comment("c1", { body = "gone branch" })
  end, { branch = "old" }))
  store.archive_ended(root, function()
    return { [main] = true, ["feat/x"] = true }
  end)
  local current = ir.entries(root, false)
  eq(#current, 3, "current branch only by default")
  for _, e in ipairs(current) do
    truthy(not e.display:match("%["), "no tag on current: " .. e.display)
  end
  local all = ir.entries(root, true)
  truthy(all[1].current and not all[#all].current and all[#all].archived, "current first, archive last")
  local tags = {}
  for _, e in ipairs(all) do
    local tag = e.display:match("(%[[^%]]+%])")
    if tag then
      tags[tag] = e
    end
  end
  truthy(tags["[feat/x]"] and tags["[archived: old]"], "tags: " .. vim.inspect(vim.tbl_keys(tags)))
  notes = {}
  local done = ir.resolve_entries(root, { current[1], tags["[feat/x]"], tags["[archived: old]"] })
  eq(done, { "c1", "c1" }, "current and other branch resolved")
  truthy(vim.tbl_contains(notes, "Archived threads are read-only"), "archive refused")
  eq(fold_file(other).c1.state, "resolved", "written to the other branch's log")
  eq(fold_file(log).c1.state, "resolved", "and the current one")
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
  local r = cli(
    blog(root),
    lid(root),
    "--id",
    "c1",
    "--status",
    "addressed",
    "--summary",
    "done",
    "--l",
    "3",
    "--anchor",
    "function M.get()"
  )
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
  local r = cli(
    blog(root),
    lid(root),
    "--id",
    "c1",
    "--status",
    "addressed",
    "--summary",
    "ok",
    "--l",
    "3",
    "--anchor",
    "function M.get()"
  )
  eq(r.code, 0, "respond")
  local log = blog(root)
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
    assert(store.transact(blog(root), function()
      return { ev = "sent", ids = { "c1" } }
    end))
    cb("edited late")
  end
  ir.edit()
  eq(fold_file(blog(root)).c1.msgs[1].body, "first", "edit not applied")
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
  local only_git = tmpdir()
  vim.uv.fs_symlink(vim.fn.exepath("git"), only_git .. "/git")
  local out = vim.system({ NVIM, "-u", "NONE", "--headless", "-l", probe }, { env = { PATH = only_git } }):wait(20000)
  eq(
    out.stdout,
    store.prompt_head(blog(root), lid(root))
      .. "\n[c1] @sub/a.lua#L1 hi\n--\nCopied 1 comments (c1) to the unnamed register (no clipboard)",
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
  eq(fold_file(blog(root)).c1.file, "sub/a.lua", "thread kept for the picker")
  ir._stop()
  vim.cmd("silent! %bwipeout!")
end)

-- Every case below must have run; a skipped or renamed case fails the run.
local REQUIRED = {
  "fold: draft → sent → answered → reply → sent → answered → resolved",
  "fold: edit applies only to the current draft message",
  "fold: delete hides thread and later responses stay history only",
  "fold: earlier-round, after-reply and after-resolve responses do not change state or anchor",
  "fold: duplicate current-round response — last wins, anchor only when it carries one",
  "fold: move applies only when its base is still the latest evidence",
  "fold: unknown id and malformed lines are reported",
  "integrity: unterminated tail is ignored until terminated",
  "integrity: every truncation point of an abandoned write keeps the next record",
  "integrity: short write is reported as incomplete",
  "integrity: two processes racing comments get unique ids and keep their replies",
  "integrity: a held lock is never stolen; a crash lock needs explicit unlock",
  "integrity: .gitignore is created beside the log",
  "prompt: tokens, ranges and follow-ups",
  "name: branch names encode to collision-free file names",
  "header: first write adds a log header; floor survives in id allocation",
  "header: a log naming another branch refuses writes",
  "transact: expect_id and create=false refuse before touching any byte",
  "fold: resolve{ids} resolves several threads in one event",
  "legacy: headerless comments.jsonl moves to the branch log and is adopted",
  "legacy: migration waits for a writer holding the legacy lock",
  "rotate: open threads continue under a new id; the old file is archived byte for byte",
  "rotate: repeated rotation never lowers the floor; all-resolved leaves only a header",
  "rotate: nothing closed means no rotation",
  "rotate: failures keep the append, warn, and leave no duplicates",
  "rotate: a real crash after each step is recovered after an explicit unlock",
  "rotate: a reader between link and replace sees the whole old file",
  "ended: logs of vanished branches move to the archive; live, detached and failed git stay",
  "ended: identity is re-read under the lock and name clashes get a suffix",
  "cli: rejects invalid arguments with exit 2 and leaves the log unchanged",
  "cli: refuses a missing log, a wrong id and non-live paths without writing",
  "cli: a response from another checkout lands in the prompt's log only",
  "cli: records response, removed and moved-file anchors",
  "cli: stale token is kept as history with a note",
  "cli: a deleted thread is refused with its own message and no write",
  "cli: 64KB records from CLI and nvim writers interleave under the lock without loss",
  "file_ref: <leader>l / <leader>L produce the same references as before",
  "file_ref: relative() refuses paths outside the root, including sibling prefixes",
  "anchor: response anchor accepted at its line",
  "anchor: lines inserted above before the response is read are followed by search",
  "anchor: falls back to the comment snippet, then estimates without a match",
  "anchor: duplicate text resolves to the occurrence nearest the recorded line",
  "anchor: removed ranges keep a point in the middle, at the end and at the top",
  "sync: CRLF, noeol, empty, single newline, BOM and latin1 files read as in sync",
  "sync: an external rewrite that was not reloaded is out of sync, even with preserved mtime",
  "lens: truncation keeps whole eojeol and drops a trailing sentence mark",
  "modal: side-by-side diff renders at widths past format's 99-column limit",
  "e2e: comment → copy → agent edits and responds → re-anchored after reload → restart",
  "e2e: a thread on line 1 gets its header drawn as top filler",
  "e2e: ]r / [r cycle through threads and resolved threads hide until toggled",
  "e2e: threads follow the branch; a switch without log changes is picked up and announced once",
  "e2e: linked worktrees keep their own branch logs; a worktree's branch is never archived",
  "e2e: detached HEAD uses .detached and comes back; unreadable HEAD refuses writes",
  "e2e: a branch switch while the input is open writes nowhere and keeps the text",
  "e2e: rotation keeps the tracked line in a dirty buffer and records it under the new generation on save",
  "e2e: after a rotation a new response is still pending until the buffer syncs",
  "bulk: <leader>aX resolves answered threads in one event after confirmation",
  "picker: entries tag other branches and the archive; resolving skips archived ones",
  "e2e: a modified buffer shows (pending reload) and applies the response after saving",
  "e2e: watcher's own move does not loop",
  "e2e: edit is refused when the draft moved on, text kept in a register",
  "e2e: without a clipboard the prompt goes to the unnamed register",
  "e2e: missing file is listed, outside-repo file refused",
}

if not only then
  for _, name in ipairs(REQUIRED) do
    if not results.ran[name] then
      table.insert(results.fail, "not run: " .. name)
    end
  end
end

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
