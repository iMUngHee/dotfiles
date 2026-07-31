-- Toggle runtime search options inside Telescope prompt.
-- State is shared across find_files / live_grep; reopens the picker to apply.
local _ignore_case = false
local _no_ignore = false

-- rg syntax cheat sheet shown as an overlay over the live_grep picker.
local cheat_sections = {
  {
    "PATTERN",
    {
      { '"foo bar"', "공백 포함 리터럴 — <C-k>가 감싸줌" },
      { "foo|bar", "OR" },
      { "^foo   foo$", "행 시작 / 행 끝" },
      { "\\bfoo\\b", "단어 경계 (= -w)" },
      { "(?i)foo", "이 패턴만 대소문자 무시" },
      { "foo.*bar", "같은 행에서 순서대로" },
      { "\\d+  \\s+  [^a-z]", "숫자 / 공백 / 부정 클래스" },
      { "foo\\(x\\)", "( ) [ ] { } . * + ? | ^ $ 는 이스케이프" },
    },
  },
  {
    "FILTER — 패턴 뒤에 그대로 입력",
    {
      { "-t ts", "타입 포함 (rg --type-list)" },
      { "-T test", "타입 제외" },
      { "--iglob **/*.tsx", "glob 포함 (대소문자 무시)" },
      { "--iglob !**/dist/**", "glob 제외" },
      { "-F", "정규식 끄고 고정 문자열" },
      { "-U --multiline", "여러 행 매칭" },
      { "-e -foo", "-로 시작하는 패턴" },
    },
  },
  {
    "KEYS",
    {
      { "<C-k>", '프롬프트를 " " 로 감싸기' },
      { "<C-g>", '" " + --iglob' },
      { "<C-t>", '" " + -t' },
      { "<C-a>", "smart_case <-> ignore_case (재실행)" },
      { "<C-o>", ".gitignore 존중 <-> 무시 (재실행)" },
      { "<C-h>", "telescope 전체 키맵" },
      { "<C-y>", "이 창 닫기" },
    },
  },
}

local _cheat_win = nil
local _cheat_buf = nil
local _cheat_ns = vim.api.nvim_create_namespace("telescope_grep_cheat")

-- Returns rendered lines plus the 0-indexed rows holding a section header.
local function render_cheat()
  local key_width = 0
  for _, section in ipairs(cheat_sections) do
    for _, row in ipairs(section[2]) do
      key_width = math.max(key_width, vim.fn.strdisplaywidth(row[1]))
    end
  end

  local lines = {}
  local headers = {}
  for i, section in ipairs(cheat_sections) do
    if i > 1 then
      table.insert(lines, "")
    end
    table.insert(headers, #lines)
    table.insert(lines, section[1])
    for _, row in ipairs(section[2]) do
      local pad = string.rep(" ", key_width - vim.fn.strdisplaywidth(row[1]))
      table.insert(lines, "  " .. row[1] .. pad .. "   " .. row[2])
    end
  end

  return lines, headers
end

local function close_cheat()
  if _cheat_win and vim.api.nvim_win_is_valid(_cheat_win) then
    vim.api.nvim_win_close(_cheat_win, true)
  end
  _cheat_win = nil
end

-- Opened with enter=false and focusable=false: the prompt buffer must never
-- fire BufLeave, since Telescope closes the picker on that event.
local function toggle_cheat(prompt_bufnr)
  if _cheat_win and vim.api.nvim_win_is_valid(_cheat_win) then
    close_cheat()
    return
  end

  local lines, headers = render_cheat()

  if not (_cheat_buf and vim.api.nvim_buf_is_valid(_cheat_buf)) then
    _cheat_buf = vim.api.nvim_create_buf(false, true)
    vim.bo[_cheat_buf].bufhidden = "hide"
    vim.api.nvim_buf_set_lines(_cheat_buf, 0, -1, false, lines)
    vim.bo[_cheat_buf].modifiable = false
    for _, row in ipairs(headers) do
      vim.api.nvim_buf_set_extmark(_cheat_buf, _cheat_ns, row, 0, {
        end_col = #lines[row + 1],
        hl_group = "Title",
      })
    end
  end

  local width = 0
  for _, line in ipairs(lines) do
    width = math.max(width, vim.fn.strdisplaywidth(line))
  end
  width = math.min(width + 2, vim.o.columns - 4)
  local height = math.min(#lines, vim.o.lines - 6)

  _cheat_win = vim.api.nvim_open_win(_cheat_buf, false, {
    relative = "editor",
    width = width,
    height = height,
    row = math.max(0, math.floor((vim.o.lines - height) / 2) - 1),
    col = math.max(0, math.floor((vim.o.columns - width) / 2)),
    style = "minimal",
    border = "rounded",
    title = " rg cheat sheet ",
    title_pos = "center",
    focusable = false,
    noautocmd = true,
    zindex = 200,
  })
  vim.wo[_cheat_win].wrap = false

  vim.api.nvim_create_autocmd({ "BufLeave", "BufWipeout" }, {
    buffer = prompt_bufnr,
    once = true,
    callback = close_cheat,
  })
end

local function find_files_with_case(prompt)
  local opts = { cwd = require("utils.root").get(), hidden = true }

  if prompt then
    opts.default_text = prompt
  end

  if _ignore_case then
    local ok, fzf = pcall(require, "telescope._extensions.fzf")
    if ok then
      opts.sorter = fzf.exports.native_fzf_sorter({ case_mode = "ignore_case", fuzzy = true })
    end
  end

  if _no_ignore then
    opts.no_ignore = true
  end

  require("telescope.builtin").find_files(opts)
end

local function live_grep_with_case(prompt)
  local lga_actions = require("telescope-live-grep-args.actions")
  local opts = {
    cwd = require("utils.root").get(),
    mappings = {
      i = {
        ["<C-k>"] = lga_actions.quote_prompt(),
        ["<C-g>"] = lga_actions.quote_prompt({ postfix = " --iglob " }),
        ["<C-t>"] = lga_actions.quote_prompt({ postfix = " -t " }),
        ["<C-y>"] = toggle_cheat,
      },
    },
  }

  if prompt then
    opts.default_text = prompt
  end

  local additional_args = {}

  if _ignore_case then
    table.insert(additional_args, "--ignore-case")
  end

  if _no_ignore then
    table.insert(additional_args, "--no-ignore")
  end

  if #additional_args > 0 then
    opts.additional_args = function()
      return additional_args
    end
  end

  require("telescope").extensions.live_grep_args.live_grep_args(opts)
end

local pickers_by_title = {
  ["Find Files"] = find_files_with_case,
  ["Live Grep (Args)"] = live_grep_with_case,
}

local function reopen_current_picker(prompt_bufnr)
  local action_state = require("telescope.actions.state")
  local picker = action_state.get_current_picker(prompt_bufnr)
  local current_prompt = picker:_get_prompt()
  local reopen = pickers_by_title[picker.prompt_title]

  if not reopen then
    return
  end

  require("telescope.actions").close(prompt_bufnr)
  return picker, current_prompt, reopen
end

local function toggle_case(prompt_bufnr)
  local picker, current_prompt, reopen = reopen_current_picker(prompt_bufnr)

  if not reopen then
    return
  end

  _ignore_case = not _ignore_case
  reopen(current_prompt)

  local label = _ignore_case and "ignore_case" or "smart_case"
  vim.notify(picker.prompt_title .. ": " .. label, vim.log.levels.INFO)
end

local function toggle_ignore(prompt_bufnr)
  local picker, current_prompt, reopen = reopen_current_picker(prompt_bufnr)

  if not reopen then
    return
  end

  _no_ignore = not _no_ignore
  reopen(current_prompt)

  local label = _no_ignore and "include_ignored" or "respect_ignore"
  vim.notify(picker.prompt_title .. ": " .. label, vim.log.levels.INFO)
end

return {
  {
    "nvim-telescope/telescope.nvim",
    cmd = "Telescope",
    keys = {
      {
        "<leader>ff",
        function()
          find_files_with_case()
        end,
        desc = "Find files",
      },
      {
        "<leader>fg",
        function()
          live_grep_with_case()
        end,
        desc = "Live grep",
      },
      { "<leader>fb", "<cmd>Telescope buffers<CR>", desc = "Buffers" },
      { "<leader>fd", "<cmd>Telescope diagnostics<CR>", desc = "Diagnostics" },
      { "<leader>fp", "<cmd>Telescope projects<CR>", desc = "Projects" },
    },
    dependencies = {
      "nvim-lua/plenary.nvim",
      "nvim-tree/nvim-web-devicons",
      {
        "nvim-telescope/telescope-fzf-native.nvim",
        build = "make",
        cond = vim.fn.executable("make") == 1,
      },
      { "nvim-telescope/telescope-live-grep-args.nvim", version = "^1.0.0" },
    },
    opts = {
      defaults = {
        prompt_prefix = " ",
        selection_caret = " ",
        layout_strategy = "horizontal",
        layout_config = { prompt_position = "top" },
        sorting_strategy = "ascending",
        file_ignore_patterns = { "%.git/", "node_modules" },
        mappings = {
          i = {
            ["<C-h>"] = "which_key",
            ["<C-a>"] = toggle_case,
            ["<C-o>"] = toggle_ignore,
          },
        },
      },
      pickers = {
        find_files = { hidden = true },
      },
    },

    config = function(_, opts)
      local telescope = require("telescope")
      telescope.setup(opts)

      pcall(telescope.load_extension, "fzf")
      pcall(telescope.load_extension, "live_grep_args")
      pcall(telescope.load_extension, "projects")
    end,
  },
}
