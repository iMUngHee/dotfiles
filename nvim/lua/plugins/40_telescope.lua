-- Toggle case-sensitivity at runtime with <C-a> inside Telescope prompt.
-- State is shared across find_files / live_grep; reopens the picker to apply.
local _ignore_case = false

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
      },
    },
  }

  if prompt then
    opts.default_text = prompt
  end

  if _ignore_case then
    opts.additional_args = function()
      return { "--ignore-case" }
    end
  end

  require("telescope").extensions.live_grep_args.live_grep_args(opts)
end

local pickers_by_title = {
  ["Find Files"] = find_files_with_case,
  ["Live Grep (Args)"] = live_grep_with_case,
}

local function toggle_case(prompt_bufnr)
  local action_state = require("telescope.actions.state")
  local picker = action_state.get_current_picker(prompt_bufnr)
  local current_prompt = picker:_get_prompt()
  local reopen = pickers_by_title[picker.prompt_title]

  if not reopen then
    return
  end

  require("telescope.actions").close(prompt_bufnr)
  _ignore_case = not _ignore_case
  reopen(current_prompt)

  local label = _ignore_case and "ignore_case" or "smart_case"
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
