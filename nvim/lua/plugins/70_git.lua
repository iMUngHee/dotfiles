-- Runs git in cwd (matches how diffview resolves the repo) and returns stdout lines.
local function git_lines(args)
  local res = vim.system(vim.list_extend({ "git" }, args), { text = true }):wait()
  if res.code ~= 0 then
    return nil
  end
  return vim.split(vim.trim(res.stdout or ""), "\n", { trimempty = true })
end

-- Best guess at the branch the current work forked off.
-- refs/remotes/origin/HEAD is only set at clone time, so fall back to the usual names.
local function detect_base()
  local head = git_lines({ "symbolic-ref", "--short", "refs/remotes/origin/HEAD" })
  if head and head[1] then
    return head[1]
  end
  for _, candidate in ipairs({ "origin/main", "origin/master", "main", "master" }) do
    if git_lines({ "rev-parse", "--verify", "--quiet", candidate }) then
      return candidate
    end
  end
  return nil
end

local function open_diff(rev)
  -- 3-dot: diff from merge-base, so only this branch's commits show up.
  -- --imply-local: right pane is the real file, so uncommitted work is included and editable.
  vim.cmd("DiffviewOpen " .. rev .. "...HEAD --imply-local")
end

local PROMPT_ENTRY = "직접 입력…"

-- <leader>gD: pick a base branch (or type any rev) and diff the current branch against it.
local function diff_against_base()
  local branches = git_lines({
    "for-each-ref",
    "--format=%(refname:short)",
    "--sort=-committerdate",
    "refs/heads",
    "refs/remotes",
  })
  if not branches then
    vim.notify("Not a git repository", vim.log.levels.WARN)
    return
  end

  local base = detect_base()
  local items, seen = {}, {}
  if base then
    table.insert(items, base)
    seen[base] = true
  end
  for _, branch in ipairs(branches) do
    -- origin/HEAD is a symref alias, not a real diff target.
    if not seen[branch] and not branch:match("/HEAD$") then
      table.insert(items, branch)
      seen[branch] = true
    end
  end
  table.insert(items, PROMPT_ENTRY)

  vim.ui.select(items, {
    prompt = "Diff base",
    format_item = function(item)
      return item == base and item .. "  (auto)" or item
    end,
  }, function(choice)
    if not choice then
      return
    end
    if choice ~= PROMPT_ENTRY then
      open_diff(choice)
      return
    end
    vim.ui.input({ prompt = "Diff base (rev): ", default = base }, function(rev)
      if rev and vim.trim(rev) ~= "" then
        open_diff(vim.trim(rev))
      end
    end)
  end)
end

return {
  {
    "lewis6991/gitsigns.nvim",
    event = "BufReadPre",
    dependencies = { "nvim-lua/plenary.nvim" },
    opts = {
      signs = {
        add = { text = "┃" },
        change = { text = "┃" },
        delete = { text = "" },
        topdelete = { text = "" },
        changedelete = { text = "┃" },
        untracked = { text = "┆" },
      },
      current_line_blame = true,
      current_line_blame_opts = {
        delay = 500,
        virt_text_pos = "eol",
      },
      on_attach = function(bufnr)
        local gs = package.loaded.gitsigns
        local map = function(mode, lhs, rhs, desc)
          vim.keymap.set(mode, lhs, rhs, { buf = bufnr, silent = true, desc = desc })
        end

        -- hunk navigation
        map("n", "]g", gs.next_hunk, "Next Hunk")
        map("n", "[g", gs.prev_hunk, "Prev Hunk")

        -- line blame toggle
        map("n", "<leader>gb", gs.toggle_current_line_blame, "Toggle Blame")
        map("n", "<leader>gB", function()
          gs.blame_line({ full = true })
        end, "Blame Line (full)")

        -- stage/undo
        map("n", "<leader>gs", gs.stage_hunk, "Stage Hunk")
        map("n", "<leader>gu", gs.undo_stage_hunk, "Unstage Hunk")

        -- preview
        map("n", "<leader>gi", gs.preview_hunk_inline)
      end,
    },
  },
  {
    "sindrets/diffview.nvim",
    cmd = { "DiffviewOpen", "DiffviewFileHistory" },
    dependencies = { "nvim-lua/plenary.nvim" },

    keys = {
      { "<leader>gd", "<cmd>DiffviewOpen<CR>", desc = "Diff HEAD ↔ Working Tree" },
      { "<leader>gD", diff_against_base, desc = "Diff Base Branch ↔ HEAD" },
      { "<leader>gf", "<cmd>DiffviewFileHistory %<CR>", desc = "File History" },
      { "<leader>gF", "<cmd>DiffviewFileHistory<CR>", desc = "Repo History" },
      { "<leader>gq", "<cmd>DiffviewClose<CR>", desc = "Close Diffview" },
    },

    opts = {
      enhanced_diff_hl = true,
      view = {
        merge_tool = { layout = "diff4_mixed" },
      },
      icons = {
        folder_closed = "",
        folder_open = "",
      },
    },
  },
}
