-- Agent-side writer for the inline-review log. Agents record responses
-- through this instead of writing the log, so every writer shares the same
-- lock, tail repair, single write and field validation (store.transact).
-- The log path and id come from the prompt head, so a response can only land
-- in the exact log (and log generation) the prompt was copied from.
--
--   nvim -u NONE --headless -l <nvim config>/lua/inline_review/cli.lua respond \
--     --log <absolute log path> --log-id <id> \
--     --id <token> --status addressed|declined|question \
--     --summary <text> [--l <s>[,<e>] --anchor <text>] \
--     [--removed --anchor-side before|after|empty] [--file <repo-relative path>]
--
-- Exit 0 on success; 2 on invalid arguments or a log id mismatch; 1 when the
-- log is missing, locked or could not be written. Nothing is written on refusal.

local lua_dir = debug.getinfo(1, "S").source:sub(2):match("^(.*)/inline_review/[^/]+$")
-- rtp is searched before package.path, so put this checkout first.
vim.opt.rtp:prepend(vim.fs.dirname(lua_dir))
local store = require("inline_review.store")

local function fail(code, msg)
  io.stderr:write("inline-review: " .. msg .. "\n")
  os.exit(code)
end

local FLAGS = {
  log = true,
  ["log-id"] = true,
  id = true,
  status = true,
  summary = true,
  l = true,
  anchor = true,
  ["anchor-side"] = true,
  file = true,
}
local SWITCHES = { removed = true }

local function parse(argv)
  local opts, i = {}, 2
  while i <= #argv do
    local name = argv[i]:match("^%-%-(.+)$")
    if not name then
      fail(2, "unexpected argument " .. argv[i])
    elseif SWITCHES[name] then
      opts[name] = true
      i = i + 1
    elseif FLAGS[name] then
      if argv[i + 1] == nil then
        fail(2, "--" .. name .. " needs a value")
      end
      opts[name] = argv[i + 1]
      i = i + 2
    else
      fail(2, "unknown option --" .. name)
    end
  end
  return opts
end

local argv = _G.arg or {}
if argv[1] ~= "respond" then
  fail(2, "usage: cli.lua respond --log <path> --log-id <id> --id <token> --status <status> --summary <text> ...")
end
local o = parse(argv)

for _, need in ipairs({ "log", "log-id", "id", "status", "summary" }) do
  if not o[need] or o[need] == "" then
    fail(2, "--" .. need .. " is required")
  end
end
local root = store.root_of(o.log)
if not root then
  fail(
    2,
    "--log must be the absolute path of a live review log (…/.agents/state/review/<branch>.jsonl), got " .. o.log
  )
end
local id, seq = store.parse_token(o.id)
if not id then
  fail(2, "--id must be a prompt token like c3 or c3.2, got " .. o.id)
end

local ev = { ev = "response", id = o.id, status = o.status, summary = o.summary }

if o.l then
  local s, e = o.l:match("^(%d+),(%d+)$")
  s = tonumber(s or o.l:match("^(%d+)$"))
  e = tonumber(e) or s
  if not s or s < 1 or e < s then
    fail(2, "--l must be <start>[,<end>] with 1 <= start <= end, got " .. o.l)
  end
  if o.anchor == nil then
    fail(2, "--l needs --anchor (the exact text of line <start> after your edit)")
  end
  ev.l, ev.anchor = { s, e }, o.anchor
elseif o.anchor or o.removed or o.file then
  fail(2, "--anchor, --removed and --file need --l")
end

if o.removed then
  if not o["anchor-side"] then
    fail(2, "--removed needs --anchor-side before|after|empty")
  end
  ev.removed, ev.anchor_side = true, o["anchor-side"]
elseif o["anchor-side"] then
  fail(2, "--anchor-side is only used with --removed")
end

if o.file then
  local abs = vim.fn.resolve(root .. "/" .. o.file)
  if o.file:sub(1, 1) == "/" or abs:sub(1, #root + 1) ~= root .. "/" then
    fail(2, "--file must be a path inside the repository: " .. o.file)
  end
  ev.file = abs:sub(#root + 2)
end

if not store.valid(ev) then
  fail(2, "invalid response (status must be addressed, declined or question)")
end

local note
local written, err, reason = store.transact(o.log, function(_, threads)
  local t = threads[id]
  if not t or t.state == "deleted" then
    return nil, "unknown id " .. o.id
  end
  if seq ~= t.seq or (t.state ~= "sent" and t.state ~= "answered") then
    note = string.format("%s is not waiting for this response (state %s); kept as history", o.id, t.state)
  end
  return ev
end, { expect_id = o["log-id"], create = false })

if not written then
  if err == "aborted" then
    fail(2, reason)
  elseif err == "missing" then
    fail(1, "log not found — branch archived? re-copy the prompt: " .. o.log)
  elseif err == "changed" then
    fail(2, "log id mismatch — the log rotated or this prompt is from another checkout; re-copy it")
  elseif err == "locked" then
    fail(1, "log is locked; retry in a moment, or run :InlineReviewUnlock in Neovim if no writer is running")
  elseif err == "incomplete" then
    fail(1, "write may be incomplete; check " .. o.log)
  end
  fail(1, "could not write " .. o.log .. ": " .. tostring(err))
end
if note then
  io.stderr:write("inline-review: " .. note .. "\n")
end
io.stdout:write("recorded response " .. o.id .. "\n")
os.exit(0)
