-- Presentation for inline_review: lens headers, range marks, the thread
-- modal and the history picker (design-contract.md, ART-006), plus the anchor
-- rules that decide where a thread sits in a buffer.
local store = require("inline_review.store")

local api = vim.api
local M = {}

local ns_track = api.nvim_create_namespace("inline_review_track")
local ns_decor = api.nvim_create_namespace("inline_review_decor")
local ns_modal = api.nvim_create_namespace("inline_review_modal")

M.LINKS = {
  InlineReviewDraft = "DiagnosticHint",
  InlineReviewSent = "Comment",
  InlineReviewAddressed = "DiagnosticOk",
  InlineReviewQuestion = "DiagnosticWarn",
  InlineReviewDeclined = "DiagnosticInfo",
  InlineReviewResolved = "Comment",
  InlineReviewRange = "CursorLine",
  InlineReviewRemoved = "DiagnosticWarn",
}

function M.setup_highlights()
  for name, link in pairs(M.LINKS) do
    api.nvim_set_hl(0, name, { link = link, default = true })
  end
end

-- ── text ────────────────────────────────────────────────────────────────────

local W = api.nvim_strwidth

-- Prose: cut at an eojeol (space) boundary so Korean never breaks mid-word.
function M.truncate(s, width)
  if W(s) <= width then
    return s
  end
  local out = ""
  for word in s:gmatch("%S+") do
    local nxt = out == "" and word or (out .. " " .. word)
    if W(nxt) + 3 > width then
      break
    end
    out = nxt
  end
  -- "...했습니다." + "..." reads as a typo; drop the sentence mark first.
  return out:gsub("[%.,;:]$", "") .. "..."
end

-- Prose: wrap at eojeol boundaries.
function M.wrap(s, width)
  local lines, cur = {}, ""
  for word in s:gmatch("%S+") do
    local nxt = cur == "" and word or (cur .. " " .. word)
    if W(nxt) > width and cur ~= "" then
      table.insert(lines, cur)
      cur = word
    else
      cur = nxt
    end
  end
  table.insert(lines, cur)
  return lines
end

-- Code: cut by cell width, keeping indentation.
local function code_cut(s, width)
  if W(s) <= width then
    return s
  end
  local out = ""
  for i = 0, vim.fn.strchars(s) - 1 do
    local nxt = out .. vim.fn.strcharpart(s, i, 1)
    if W(nxt) + 3 > width then
      break
    end
    out = nxt
  end
  return out .. "..."
end

-- ── state words ─────────────────────────────────────────────────────────────

function M.label(t)
  if t.state == "answered" then
    return t.status
  end
  return t.state
end

local GROUP = {
  draft = "InlineReviewDraft",
  sent = "InlineReviewSent",
  addressed = "InlineReviewAddressed",
  question = "InlineReviewQuestion",
  declined = "InlineReviewDeclined",
  resolved = "InlineReviewResolved",
}

function M.group(t)
  return GROUP[M.label(t)] or "Comment"
end

-- Latest message shown in the lens: the agent's answer while it waits for me,
-- otherwise what I last wrote.
function M.latest(t)
  for i = #t.msgs, 1, -1 do
    local m = t.msgs[i]
    if t.state == "answered" or t.state == "resolved" then
      if m.who == "agent" and not m.stale then
        return "agent", m.summary
      end
    elseif m.who == "you" then
      return "you", m.body
    end
  end
  local m = store.latest_user(t)
  return "you", m and m.body or ""
end

-- ── anchors ─────────────────────────────────────────────────────────────────

-- Start row of `pat` in `lines`, nearest to `near`; nil when absent.
local function find(lines, pat, near)
  if #pat == 0 then
    return nil
  end
  local best
  for i = 1, #lines - #pat + 1 do
    local ok = true
    for k = 1, #pat do
      if lines[i + k - 1] ~= pat[k] then
        ok = false
        break
      end
    end
    if ok and (not best or math.abs(i - near) < math.abs(best - near)) then
      best = i
    end
  end
  return best
end

local function matches_at(lines, pat, row)
  for k = 1, #pat do
    if lines[row + k - 1] ~= pat[k] then
      return false
    end
  end
  return #pat > 0
end

--- Where thread `t` sits in `lines`. Walks the evidence chain newest first
--- (move / response anchor / comment snippet); each is accepted at its own line
--- when the text matches there, else at the nearest exact match. Returns
--- { s, e, removed?, estimated?, via } with 1-based rows; a removed range is a
--- point whose `s` may be #lines + 1 (deleted at the end of the file).
function M.resolve(t, lines)
  local count = #lines
  for k = #t.evidence, 1, -1 do
    local ev = t.evidence[k]
    local s0 = ev.l[1]
    if ev.removed then
      if ev.side == "empty" then
        if count == 0 or (count == 1 and lines[1] == "") then
          return { s = 1, e = 1, removed = true, via = ev }
        end
      else
        local ctx = { ev.lines[1] }
        local near = ev.side == "before" and s0 - 1 or s0
        local row = matches_at(lines, ctx, near) and near or find(lines, ctx, near)
        if row then
          local p = ev.side == "before" and row + 1 or row
          return { s = p, e = p, removed = true, via = ev }
        end
      end
    else
      local len = ev.l[2] - ev.l[1] + 1
      local row = matches_at(lines, ev.lines, s0) and s0 or find(lines, ev.lines, s0)
      if row then
        if ev.kind ~= "response" then
          len = #ev.lines
        end
        return { s = row, e = math.min(row + len - 1, count), via = ev }
      end
    end
  end
  local ev = t.evidence[#t.evidence]
  local last = math.max(count, 1)
  local s = math.min(ev.l[1], last)
  return {
    s = s,
    e = ev.removed and s or math.max(s, math.min(ev.l[2], last)),
    estimated = true,
    removed = ev.removed,
    via = ev,
  }
end

--- Is the buffer's text exactly what is on disk? true | false | "unknown".
--- Disk bytes are decoded the way Neovim read them (fileencoding, BOM,
--- fileformat); the buffer side honours 'eol' as read, never 'fixeol'.
function M.synced(buf)
  local path = api.nvim_buf_get_name(buf)
  local f = path ~= "" and io.open(path, "rb")
  if not f then
    return false
  end
  local disk = f:read("*a")
  f:close()
  local fenc = vim.bo[buf].fileencoding
  if fenc ~= "" and fenc ~= "utf-8" and disk ~= "" then
    local conv = vim.fn.iconv(disk, fenc, "utf-8")
    if conv == "" then
      return "unknown"
    end
    disk = conv
  end
  if vim.bo[buf].bomb then
    disk = disk:gsub("^\239\187\191", "")
  end
  if vim.bo[buf].fileformat == "dos" then
    disk = disk:gsub("\r\n", "\n")
  end
  local text
  if api.nvim_buf_call(buf, function()
    return vim.fn.line2byte(1)
  end) == -1 then
    text = ""
  else
    text = table.concat(api.nvim_buf_get_lines(buf, 0, -1, false), "\n") .. (vim.bo[buf].eol and "\n" or "")
  end
  return disk == text
end

-- ── tracking ────────────────────────────────────────────────────────────────

-- tracked[buf][id] = { mark, n (latest evidence seen), origin (its identity),
--                      gen (log id it was read from), removed, estimated, eof }
local tracked = {}

function M.forget(buf)
  tracked[buf] = nil
  if api.nvim_buf_is_valid(buf) then
    api.nvim_buf_clear_namespace(buf, ns_track, 0, -1)
    api.nvim_buf_clear_namespace(buf, ns_decor, 0, -1)
  end
end

local function place(buf, r, count)
  local eof = r.removed and r.s > count
  local row = math.min(r.s, math.max(count, 1)) - 1
  local erow = r.removed and row or (math.min(r.e, count) - 1)
  local eline = api.nvim_buf_get_lines(buf, erow, erow + 1, false)[1] or ""
  local mark = api.nvim_buf_set_extmark(buf, ns_track, row, 0, {
    end_row = erow,
    end_col = r.removed and 0 or #eline,
    right_gravity = false,
    end_right_gravity = true,
  })
  return mark, eof
end

--- Current range of a tracked thread in `buf`: s, e (1-based), entry.
function M.position(buf, id)
  local tr = tracked[buf] and tracked[buf][id]
  if not tr then
    return nil
  end
  local m = api.nvim_buf_get_extmark_by_id(buf, ns_track, tr.mark, { details = true })
  if not m[1] then
    return nil
  end
  local s = m[1] + 1
  local e = (m[3].end_row or m[1]) + 1
  if tr.eof then
    s = api.nvim_buf_line_count(buf) + 1
    e = s
  end
  return s, math.max(s, e), tr
end

-- ── lens ────────────────────────────────────────────────────────────────────

local function text_width(buf)
  local width
  for _, win in ipairs(vim.fn.win_findbuf(buf)) do
    local info = vim.fn.getwininfo(win)[1]
    local w = info.width - info.textoff
    width = width and math.min(width, w) or w
  end
  return (width or vim.o.columns) - 1
end

local function header_chunks(t, tr, width, pending, nth)
  local who, text = M.latest(t)
  local chunks =
    { { "-- ", "NonText" }, { t.id .. (nth or "") .. "  ", "Comment" }, { M.label(t):upper(), M.group(t) } }
  local used = 3 + W(t.id .. (nth or "")) + 2 + W(M.label(t))
  local flags = {}
  if tr and tr.removed then
    table.insert(flags, { " · code removed", "InlineReviewRemoved" })
  end
  if tr and tr.estimated then
    table.insert(flags, { " (location estimated)", "Comment" })
  end
  if pending then
    table.insert(flags, { " (pending reload)", "Comment" })
  end
  for _, f in ipairs(flags) do
    table.insert(chunks, f)
    used = used + W(f[1])
  end
  local tail = "  " .. who .. ": "
  table.insert(chunks, { tail .. M.truncate(text, math.max(width - used - W(tail), 8)), "Comment" })
  return chunks
end

--- Draw every visible thread of `repo` that belongs to `buf`.
--- `opts.show_resolved` shows resolved threads; `opts.on_move(t, r)` is called
--- when a verified position should be persisted as a move event.
function M.render(buf, repo, rel, opts)
  if not api.nvim_buf_is_loaded(buf) then
    return
  end
  api.nvim_buf_clear_namespace(buf, ns_decor, 0, -1)
  tracked[buf] = tracked[buf] or {}
  local lines = api.nvim_buf_get_lines(buf, 0, -1, false)
  local count = #lines
  local sync = M.synced(buf)
  local width = text_width(buf)
  local rows = {}
  for _, id in ipairs(repo.order) do
    local t = repo.threads[id]
    local visible = t.file == rel and t.state ~= "deleted" and (t.state ~= "resolved" or opts.show_resolved)
    local tr = tracked[buf][id]
    if not visible then
      if tr then
        api.nvim_buf_del_extmark(buf, ns_track, tr.mark)
        tracked[buf][id] = nil
      end
    else
      local latest = t.evidence[#t.evidence]
      local pending = false
      -- A rotation renumbers evidence but keeps its origin: same evidence,
      -- so keep the extmark and just adopt the new generation.
      if tr and tr.gen ~= opts.gen and tr.origin == latest.origin then
        tr.gen, tr.n = opts.gen, latest.n
      end
      if not tr or (tr.n ~= latest.n and sync == true) then
        if tr then
          api.nvim_buf_del_extmark(buf, ns_track, tr.mark)
        end
        local r = M.resolve(t, lines)
        local mark, eof = place(buf, r, count)
        tr = {
          mark = mark,
          n = latest.n,
          origin = latest.origin,
          gen = opts.gen,
          removed = r.removed,
          estimated = r.estimated,
          eof = eof,
        }
        tracked[buf][id] = tr
        if sync == true and not r.estimated and opts.on_move then
          local same = r.via == latest and latest.kind ~= "response" and r.s == latest.l[1]
          if not same then
            opts.on_move(t, r, latest)
          end
        end
      elseif tr.n ~= latest.n then
        pending = true
      end
      local s, e = M.position(buf, id)
      if s then
        rows[s] = rows[s] or {}
        table.insert(rows[s], { t = t, tr = tr, s = s, e = e, pending = pending })
      end
    end
  end
  for s, list in pairs(rows) do
    local virt = {}
    for i, it in ipairs(list) do
      local nth = #list > 1 and string.format(" (%d/%d)", i, #list) or nil
      table.insert(virt, header_chunks(it.t, it.tr, width, it.pending, nth))
      if not it.tr.removed then
        for row = it.s, it.e do
          api.nvim_buf_set_extmark(buf, ns_decor, row - 1, 0, {
            sign_text = "|",
            sign_hl_group = M.group(it.t),
            priority = 5,
            line_hl_group = it.t.state == "answered" and "InlineReviewRange" or nil,
          })
        end
      end
    end
    if s > count then
      api.nvim_buf_set_extmark(buf, ns_decor, math.max(count, 1) - 1, 0, { virt_lines = virt })
    else
      api.nvim_buf_set_extmark(buf, ns_decor, s - 1, 0, { virt_lines = virt, virt_lines_above = true })
    end
  end
  -- Lines above line 1 are only drawn as filler (topfill); without it a
  -- thread on the first line would have no visible header.
  if rows[1] then
    for _, win in ipairs(vim.fn.win_findbuf(buf)) do
      api.nvim_win_call(win, function()
        local v = vim.fn.winsaveview()
        if v.topline == 1 and v.topfill < #rows[1] then
          vim.fn.winrestview({ topfill = #rows[1] })
        end
      end)
    end
  end
end

--- Threads of `buf` whose range contains `row`, innermost first.
function M.at(buf, repo, row)
  local hits = {}
  for id, _ in pairs(tracked[buf] or {}) do
    local s, e, tr = M.position(buf, id)
    local t = repo.threads[id]
    if s and t and (row >= s and row <= e or (tr and tr.removed and (row == s or row == s - 1))) then
      table.insert(hits, { t = t, size = e - s })
    end
  end
  table.sort(hits, function(a, b)
    return a.size < b.size
  end)
  return vim.tbl_map(function(h)
    return h.t
  end, hits)
end

--- Start rows of visible threads in `buf`, sorted.
function M.starts(buf)
  local out = {}
  for id, _ in pairs(tracked[buf] or {}) do
    local s = M.position(buf, id)
    if s then
      table.insert(out, { row = math.min(s, api.nvim_buf_line_count(buf)), id = id })
    end
  end
  table.sort(out, function(a, b)
    return a.row < b.row
  end)
  return out
end

function M.tracked_ids(buf)
  return vim.tbl_keys(tracked[buf] or {})
end

-- ── thread modal ────────────────────────────────────────────────────────────

-- Side by side from a 120-column editor's modal width (120 - 8 - 2) up;
-- judged on the space actually given, so narrow previews stay unified.
local SIDE_BY_SIDE_MIN = 110

local function diff_rows(before, now, width, rows)
  if width >= SIDE_BY_SIDE_MIN then
    local half = math.floor((width - 5) / 2)
    table.insert(rows, {
      { string.format("%-" .. half .. "s", "at comment"), "Comment" },
      { " | ", "NonText" },
      { "now", "Comment" },
    })
    local shown_now = #now == 0 and { "(removed)" } or now
    for i = 1, math.max(#before, #shown_now) do
      local l, r = code_cut(before[i] or "", half), code_cut(shown_now[i] or "", half)
      table.insert(rows, {
        { l .. string.rep(" ", half - W(l)), "DiffDelete" },
        { " | ", "NonText" },
        { r, #now == 0 and "Comment" or "DiffAdd" },
      })
    end
  else
    table.insert(rows, { { "change since comment", "Comment" } })
    local a = table.concat(before, "\n") .. "\n"
    local b = #now == 0 and "" or (table.concat(now, "\n") .. "\n")
    -- vim.text.diff is 0.12+; the README still supports 0.11, which only has vim.diff.
    ---@diagnostic disable-next-line: deprecated
    local d = (vim.text and vim.text.diff or vim.diff)(a, b, { ctxlen = 0 })
    local any = false
    for l in tostring(d):gmatch("[^\n]+") do
      if not l:match("^@@") then
        any = true
        table.insert(rows, { { code_cut(l, width - 2), l:sub(1, 1) == "+" and "DiffAdd" or "DiffDelete" } })
      end
    end
    if not any then
      table.insert(rows, { { "(no change)", "Comment" } })
    end
  end
end

--- Rows (chunk lists) for the thread view; shared by the modal and picker preview.
function M.thread_rows(t, width, now, flags)
  local rows = {}
  local head = { { t.id .. "  ", "Title" }, { (t.state == "answered" and "ANSWERED" or t.state:upper()), M.group(t) } }
  if t.status and (t.state == "answered" or t.state == "resolved") then
    table.insert(head, { " · " .. t.status, "Comment" })
  end
  for _, f in ipairs(flags or {}) do
    table.insert(head, { " " .. f, "Comment" })
  end
  table.insert(rows, head)
  table.insert(rows, { { "", "Normal" } })
  local agents = 0
  for _, m in ipairs(t.msgs) do
    if m.who == "agent" then
      agents = agents + 1
    end
  end
  for _, m in ipairs(t.msgs) do
    local body = m.who == "you" and m.body or m.summary
    local prefix = ""
    if m.who == "agent" and m.stale then
      prefix = "(earlier round) "
    elseif m.who == "agent" and agents > 1 then
      prefix = "[" .. m.status .. "] "
    end
    local label = m.who == "you" and "you     " or "agent   "
    local group = m.who == "you" and "Title" or (GROUP[m.status] or "Comment")
    for i, l in ipairs(M.wrap(prefix .. body, width - 8)) do
      table.insert(rows, {
        { i == 1 and label or string.rep(" ", 8), m.stale and "Comment" or group },
        { l, m.stale and "Comment" or "Normal" },
      })
    end
  end
  table.insert(rows, { { "", "Normal" } })
  diff_rows(t.snippet, now, width, rows)
  return rows
end

local function flatten(rows, pad)
  local lines, hls = {}, {}
  for i, r in ipairs(rows) do
    local s = pad or ""
    for _, c in ipairs(r) do
      if #c[1] > 0 then
        table.insert(hls, { i - 1, #s, #s + #c[1], c[2] })
      end
      s = s .. c[1]
    end
    lines[i] = s
  end
  return lines, hls
end

function M.fill(buf, rows, pad)
  local lines, hls = flatten(rows, pad)
  vim.bo[buf].modifiable = true
  api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  vim.bo[buf].modifiable = false
  api.nvim_buf_clear_namespace(buf, ns_modal, 0, -1)
  for _, h in ipairs(hls) do
    vim.hl.range(buf, ns_modal, h[4], { h[1], h[2] }, { h[1], h[3] })
  end
  return #lines
end

--- Open the modal for thread `t`. `keys` maps modal keys to callbacks.
function M.open_modal(t, info, keys)
  local width = vim.o.columns - 8
  local rows = M.thread_rows(t, width - 2, info.now, info.flags)
  local buf = api.nvim_create_buf(false, true)
  vim.bo[buf].bufhidden = "wipe"
  vim.bo[buf].filetype = "inline_review"
  local n = M.fill(buf, rows, " ")
  local code_win = api.nvim_get_current_win()
  local so = vim.wo[code_win].scrolloff
  vim.wo[code_win].scrolloff = 0
  local win = api.nvim_open_win(buf, true, {
    relative = "editor",
    row = 1,
    col = 3,
    width = width,
    height = math.max(1, math.min(n, vim.o.lines - 4)),
    style = "minimal",
    border = "rounded",
    title = " review · " .. info.title .. " ",
    title_pos = "left",
    footer = " r reply  x resolve  e edit  d delete  ]r next  q close ",
    footer_pos = "left",
  })
  vim.wo[win].statuscolumn = ""
  vim.wo[win].list = false
  vim.wo[win].wrap = false
  vim.wo[win].cursorline = false
  local closed = false
  local function close()
    if closed then
      return
    end
    closed = true
    if api.nvim_win_is_valid(win) then
      api.nvim_win_close(win, true)
    end
    if api.nvim_win_is_valid(code_win) then
      vim.wo[code_win].scrolloff = so
      api.nvim_set_current_win(code_win)
    end
  end
  api.nvim_create_autocmd("WinClosed", {
    pattern = tostring(win),
    once = true,
    callback = function()
      vim.schedule(close)
    end,
  })
  local function map(lhs, fn)
    vim.keymap.set("n", lhs, function()
      close()
      if fn then
        fn()
      end
    end, { buffer = buf, nowait = true })
  end
  map("q")
  map("<Esc>")
  for lhs, fn in pairs(keys) do
    map(lhs, fn)
  end
  return win, buf
end

return M
