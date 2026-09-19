return {
  { "nvim-tree/nvim-web-devicons", lazy = true },
  { "MunifTanjim/nui.nvim", lazy = true },
  {
    "nvim-lualine/lualine.nvim",
    event = "VeryLazy",

    dependencies = { "nvim-web-devicons" },
    opts = {
      options = {
        -- "auto" resolves to the bundled theme matching vim.g.colors_name and
        -- derives one from the highlight groups when there is none. lualine
        -- re-runs its own setup on ColorScheme, so this follows the theme with
        -- no help from here; the pinned "catppuccin-mocha" could not.
        theme = "auto",
        component_separators = "│",
        section_separators = "",
      },

      sections = {
        lualine_c = { { "filename", path = 1 }, "diagnostics" },
        lualine_x = { "encoding", "fileformat", "filetype" },
      },
    },
  },
  {
    "akinsho/bufferline.nvim",
    event = "VeryLazy",
    version = "*",
    dependencies = { "nvim-web-devicons" },
    -- Track closed buffers in a stack for <leader>bu (reopen last closed)
    init = function()
      local Stack = require("utils.buffer_stack")
      local grp = vim.api.nvim_create_augroup("ClosedBufferStack", { clear = true })

      vim.api.nvim_create_autocmd({ "BufDelete" }, {
        group = grp,
        callback = function(args)
          local bt = vim.bo[args.buf].buftype

          if bt ~= "" then
            return
          end

          local path = vim.api.nvim_buf_get_name(args.buf)
          if path == nil or path == "" then
            return
          end

          if vim.fn.filereadable(path) ~= 1 then
            return
          end

          if not Stack.has(path) then
            Stack.push(path)
          end
        end,
      })

      vim.api.nvim_create_autocmd({ "BufReadPost", "BufNewFile" }, {
        group = grp,
        callback = function(args)
          local path = vim.api.nvim_buf_get_name(args.buf)
          if path ~= "" then
            Stack.remove(path)
          end
        end,
      })
    end,
    opts = function()
      -- Colours are given as bufferline highlight links rather than hex values.
      -- bufferline re-resolves these through colors.get_color on every
      -- ColorScheme (config.update_highlights -> Config:resolve ->
      -- resolve_user_highlight_links), so they track the active theme on their
      -- own. Hex values from a palette would be re-applied verbatim instead,
      -- which is what pinned these to Catppuccin. A group a colorscheme does
      -- not define resolves to nil and bufferline falls back to its own
      -- computed default.
      local err = { highlight = "DiagnosticError", attribute = "fg" }
      local warn = { highlight = "DiagnosticWarn", attribute = "fg" }
      local mod = { highlight = "String", attribute = "fg" }
      return {
        options = {
          mode = "buffers",
          diagnostics = "nvim_lsp",
          separator_style = "slant",
          always_show_bufferline = true,
          numbers = "ordinal",
          offsets = {
            {
              filetype = "neo-tree",
              text = "File Explorer",
              highlight = "Directory",
              text_align = "center",
              separator = true,
            },
          },
          pick = {
            alphabet = "asdfghjklqwertyuiopzxcvbnm",
          },
        },

        highlights = {
          error = { fg = err },
          error_visible = { fg = err },
          error_selected = { fg = err, bold = true, italic = true },

          error_diagnostic = { fg = err },
          error_diagnostic_visible = { fg = err },
          error_diagnostic_selected = { fg = err, bold = true, italic = true },

          warning = { fg = warn },
          warning_visible = { fg = warn },
          warning_selected = { fg = warn, bold = true, italic = true },

          warning_diagnostic = { fg = warn },
          warning_diagnostic_visible = { fg = warn },
          warning_diagnostic_selected = { fg = warn, bold = true, italic = true },

          modified = { fg = mod },
          modified_visible = { fg = mod },
          modified_selected = { fg = mod, bold = true, italic = true },
        },
      }
    end,
    keys = {
      { "<S-h>", "<cmd>BufferLineCyclePrev<CR>", desc = "Prev buffer-tab" },
      { "<S-l>", "<cmd>BufferLineCycleNext<CR>", desc = "Next buffer-tab" },

      { "<leader>1", "<Cmd>BufferLineGoToBuffer 1<CR>", desc = "Go to buffer 1" },
      { "<leader>2", "<Cmd>BufferLineGoToBuffer 2<CR>", desc = "Go to buffer 2" },
      { "<leader>3", "<Cmd>BufferLineGoToBuffer 3<CR>", desc = "Go to buffer 3" },
      { "<leader>4", "<Cmd>BufferLineGoToBuffer 4<CR>", desc = "Go to buffer 4" },
      { "<leader>5", "<Cmd>BufferLineGoToBuffer 5<CR>", desc = "Go to buffer 5" },
      { "<leader>6", "<Cmd>BufferLineGoToBuffer 6<CR>", desc = "Go to buffer 6" },
      { "<leader>7", "<Cmd>BufferLineGoToBuffer 7<CR>", desc = "Go to buffer 7" },
      { "<leader>8", "<Cmd>BufferLineGoToBuffer 8<CR>", desc = "Go to buffer 8" },
      { "<leader>9", "<Cmd>BufferLineGoToBuffer 9<CR>", desc = "Go to buffer 9" },

      { "gb", "<cmd>BufferLinePick<CR>", desc = "Pick buffer to jump" },

      {
        "<leader>bc",
        function()
          local bufs = vim.fn.getbufinfo({ buflisted = 1 })
          if #bufs > 1 then
            vim.cmd("bp | bd #")
          else
            vim.cmd("bd")
          end
        end,
        desc = "Close current buffer",
      },
      { "<leader>bp", "<cmd>BufferLinePickClose<CR>", desc = "Pick close" },
      { "<leader>bo", "<cmd>BufferLineCloseOthers<CR>", desc = "Close others" },
      { "<leader>br", "<cmd>BufferLineCloseRight<CR>", desc = "Close buffers to the right" },
      { "<leader>bl", "<cmd>BufferLineCloseLeft<CR>", desc = "Close buffers to the left" },
      {
        "<leader>bu",
        function()
          local Stack = require("utils.buffer_stack")

          while Stack.size() > 0 do
            local path = Stack.pop()
            if path and vim.uv.fs_stat(path) then
              vim.cmd("edit " .. vim.fn.fnameescape(path))
              return
            end
          end
          vim.notify("Empty closed buffer stack", vim.log.levels.INFO)
        end,
        desc = "Reopen last closed buffer (stack)",
      },
      { "<leader>tc", "<cmd>tabclose<CR>", desc = "Close tab" },
      { "<leader>to", "<cmd>tabonly<CR>", desc = "Close other tabs" },

      {
        "<leader>bU",
        function()
          require("utils.buffer_stack").clear()
          vim.notify("Reset buffer closed buffer stack", vim.log.levels.INFO)
        end,
        desc = "Clear closed buffer stack",
      },
    },
  },
  {
    "nvimdev/dashboard-nvim",
    event = "VimEnter",
    init = function()
      -- Stub out register_lsp_root to prevent async cache writes that corrupt
      -- on exit (project feature is disabled but hyper theme calls it anyway).
      require("dashboard.events").register_lsp_root = function() end
    end,
    opts = {
      theme = "hyper",
      shortcut_type = "number",
      config = {
        week_header = { enable = true },
        project = { enable = false },
      },
    },
  },
  {
    "folke/noice.nvim",
    event = "VeryLazy",
    dependencies = {
      "MunifTanjim/nui.nvim",
      "rcarriga/nvim-notify",
    },
    opts = {
      cmdline = {
        format = {
          filter = {
            title = "Shell",
          },
        },
      },
      lsp = {
        progress = { enabled = true },
        signature = { enabled = true },
        hover = { enabled = false },
      },
      presets = {
        command_palette = true,
      },
    },
  },
  {
    "stevearc/dressing.nvim",
    event = "VeryLazy",
    opts = {
      input = {
        insert_only = false,
        border = "rounded",
      },
      select = {
        backend = { "telescope", "builtin" },
      },
    },
  },
  {
    "lukas-reineke/indent-blankline.nvim",
    main = "ibl",
    event = { "BufReadPost", "BufNewFile" },
    opts = {
      indent = { char = "▏" },
      scope = { enabled = true },
    },
  },
  {
    "dstein64/nvim-scrollview",
    event = { "BufReadPost", "BufNewFile" },
    opts = function()
      local C = require("utils.palette").get()
      return {
        current_only = true,
        base = "right",
        column = 1,
        winblend = 50,
        hide_on_intersect = true,
        signs_on_startup = {
          "search",
          "conflicts",
          "git",
        },
        marks = false,
        excluded_filetypes = {
          "neo-tree",
          "NvimTree",
          "TelescopePrompt",
          "mason",
          "lazy",
          "notify",
          "noice",
        },

        diagnostics_error_symbol_color = C.red,
        diagnostics_warn_symbol_color = C.yellow,
        diagnostics_hint_symbol_color = C.teal,

        git_add_symbol_color = C.green,
        git_change_symbol_color = C.yellow,
        git_delete_symbol_color = C.red,

        search_symbol_color = C.yellow,
      }
    end,
    -- scrollview has no equivalent of bufferline's highlight links: these are
    -- plain option values it reads once at setup, so following the theme means
    -- recomputing them and calling setup again on ColorScheme.
    config = function(_, opts)
      local palette = require("utils.palette")
      palette.on_colorscheme("scrollview", function()
        local C = palette.get()
        opts.diagnostics_error_symbol_color = C.red
        opts.diagnostics_warn_symbol_color = C.yellow
        opts.diagnostics_hint_symbol_color = C.teal
        opts.git_add_symbol_color = C.green
        opts.git_change_symbol_color = C.yellow
        opts.git_delete_symbol_color = C.red
        opts.search_symbol_color = C.yellow
        require("scrollview").setup(opts)
      end)
    end,
  },
  {
    "chentoast/marks.nvim",
    event = "VeryLazy",
    opts = {
      default_mappings = false,
      signs = true,
      builtin_marks = { ".", "<", ">", "^" },
      cyclic = true,
      force_write_shada = false,
      refresh_interval = 250,
      sign_priority = { lower = 10, upper = 15, builtin = 8, bookmark = 20 },
      excluded_filetypes = {
        "qf",
        "NvimTree",
        "toggleterm",
        "TelescopePrompt",
        "alpha",
        "netrw",
      },
      mappings = {
        set = "m",
        delete_line = "dm",
        delete = "dM",
        next = "m]",
        prev = "m[",
        preview = "m:",
      },
    },
  },
  {
    "folke/which-key.nvim",
    event = "VeryLazy",
    opts = { plugins = { spelling = true } },
  },
  {
    "catgoose/nvim-colorizer.lua",
    event = "VeryLazy",
    config = function()
      require("colorizer").setup()
    end,
  },
}
