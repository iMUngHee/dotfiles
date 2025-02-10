return {
  "nvim-lua/plenary.nvim",
  {
    "catppuccin/nvim",
    name = "catppuccin",
    lazy = false,
    priority = 1000,
    config = function ()
      local catppuccin = require "catppuccin"
      catppuccin.setup()
      vim.cmd.colorscheme "catppuccin"
    end
  },

  -- NOTE: folke's stuffs
  {
    "folke/neodev.nvim",
    opts = {}
  },
  {
    "folke/trouble.nvim",
    config = function ()
      local trouble = require "trouble"
      trouble.setup()
    end
  },
  {
    "folke/which-key.nvim",
    event = "VeryLazy"
  },
  {
    "folke/todo-comments.nvim",
    config = function ()
      local todo = require "todo-comments"
      todo.setup()
    end
  },

  {
    "nvim-treesitter/nvim-treesitter",
    -- cmd = { "TSInstall", "TSBufEnable", "TSBufDisable", "TSModuleInfo" },
    build = ":TSUpdate",
    config = function ()
      local configs = require "nvim-treesitter.configs"
      configs.setup({
        ensure_installed = { "c", "lua", "vim", "vimdoc" },
        auto_install = true,
        highlight = {
          enable = true,
          use_languagetree = true,
        },
        indent = { enable = true }
      })
    end
  },
  {
    "neovim/nvim-lspconfig",
    dependencies = {
      "williamboman/mason.nvim",
      "williamboman/mason-lspconfig.nvim",

      -- TODO: Refactoring

      {
        "L3MON4D3/LuaSnip",
        dependencies = {
          "rafamadriz/friendly-snippets",
        }
      },
      {
        "windwp/nvim-autopairs",
        opts = {
          fast_wrap = {},
          disable_filetype = { "vim" },
        },
        config = function (_, opts)
          require("nvim-autopairs").setup(opts)

          local cmp_autopairs = require "nvim-autopairs.completion.cmp"
          require("cmp").event:on("confirm_done", cmp_autopairs.on_confirm_done())
        end
      },

      -- TODO: Refactoring

      "hrsh7th/nvim-cmp",
      "hrsh7th/cmp-nvim-lsp",
      "hrsh7th/cmp-buffer",
      "hrsh7th/cmp-path",
    },
    config = function ()
      local mason = require("mason")
      local mason_lspconfig = require("mason-lspconfig")
      local cmp = require("cmp")
      local luasnip = require "luasnip"

      mason.setup()
      mason_lspconfig.setup({
        ensure_installed = {
          "lua_ls",
          "clangd",
          "ts_ls",
        },
        handlers = {
          function (server_name)
            local capabilities = require('cmp_nvim_lsp').default_capabilities()
            require("lspconfig")[server_name].setup {
              capabilities = capabilities
            }
          end,
        }
      })

      cmp.setup({
        completion = { completeopt = "menu,menuone" },
        snippet = {
          expand = function(args)
            luasnip.lsp_expand(args.body)
          end,
        },
        window = {
          -- completion = cmp.config.window.bordered(),
          -- documentation = cmp.config.window.bordered(),
        },
        mapping = cmp.mapping.preset.insert({
          ["<C-b>"] = cmp.mapping.scroll_docs(-4),
          ["<C-f>"] = cmp.mapping.scroll_docs(4),
          ["<C-i>"] = cmp.mapping.complete(),
          ["<C-e>"] = cmp.mapping.close(),
          ["<CR>"] = cmp.mapping(function(fallback)
            if cmp.visible() then
              cmp.confirm({ 
                behavior = cmp.ConfirmBehavior.Replace,
                select = true
              })
            else
              fallback()
            end
          end, { "i", "s" }),
        }),
        sources = {
          { name = "nvim_lsp" },
          { name = "buffer" },
          { name = "nvim_lua" },
          { name = "path" },
        },
        experimental = {
          ghost_text = true,
        },
      })
    end
  },
}
