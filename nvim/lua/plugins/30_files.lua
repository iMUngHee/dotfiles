return {
  {
    "nvim-neo-tree/neo-tree.nvim",
    branch = "v3.x",
    lazy = false,
    keys = {
      {
        "<leader>e",
        function()
          require("neo-tree.command").execute({
            toggle = true,
            position = "left",
            dir = require("utils.root").get(),
            reveal = true,
          })
        end,
        desc = "File-tree (Project Root)",
      },
      {
        "<leader>E",
        function()
          require("neo-tree.command").execute({
            toggle = true,
            position = "float",
            dir = require("utils.root").get(),
            reveal = true,
          })
        end,
        desc = "File-tree (Float Project Root)",
      },
    },
    dependencies = {
      "nvim-lua/plenary.nvim",
      "nvim-tree/nvim-web-devicons",
      "MunifTanjim/nui.nvim",
    },
    opts = {
      window = {
        position = "left",
        width = 28,
        mappings = { ["<CR>"] = "open", ["o"] = "open" },
      },
      filesystem = {
        bind_to_cwd = false,
        follow_current_file = {
          enabled = true,
          leave_dirs_open = false,
        },
        use_libuv_file_watcher = true,
        group_empty_dirs = true,
        hijack_netrw_behavior = "open_default",
        filtered_items = {
          hide_dotfiles = false,
          hide_gitignored = false,
        },
      },
      default_component_configs = {
        git_status = {
          symbols = {
            added = "",
            modified = "",
            deleted = "",
            renamed = "",
            untracked = "",
            unstaged = "",
            staged = "",
            conflict = "",
            ignored = "",
          },
        },
      },
    },
  },
  {
    "stevearc/oil.nvim",
    keys = {
      { "-", "<cmd>Oil<CR>", desc = "Parent directory (Oil)" },
    },
    opts = {
      default_file_explorer = false,
      delete_to_trash = true,
      skip_confirm_for_simple_edits = true,
      view_options = {
        show_hidden = true,
        natural_order = true,
      },
    },
  },
  {
    "ahmedkhalf/project.nvim",
    event = "VeryLazy",
    opts = {
      manual_mode = false,
      detection_methods = { "pattern" },
      patterns = {
        ".git",
        "Cargo.toml",
        "Makefile",
        ".project_root",
        "pyproject.toml",
        ".stylua.toml",
        "go.mod",
      },
    },
    config = function(_, opts)
      require("project_nvim").setup(opts)
    end,
  },
  {
    "rmagatti/auto-session",
    lazy = false,
    opts = {
      log_level = "error",
      auto_session_enabled = true,
      auto_restore_enabled = false,
      auto_session_suppress_dirs = { "~/", "/", "~/Downloads" },
      session_lens = { load_on_setup = false },
    },
  },
}
