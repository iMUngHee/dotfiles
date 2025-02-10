return {
  "nvim-lua/plenary.nvim",
  {
    "folke/neodev.nvim",
    opts = {}
  },
  {
    "folke/trouble.nvim",
    config = function ()
    end
  },
  {
    "folke/which-key.nvim",
    event = "VeryLazy"
  },
  {
    'maxmx03/dracula.nvim',
    lazy = false,
    priority = 1000,
    config = function ()
      local dracula = require 'dracula'
      dracula.setup()
      vim.cmd.colorscheme 'dracula'
    end
  },
  {
    "nvim-treesitter/nvim-treesitter",
    -- cmd = { "TSInstall", "TSBufEnable", "TSBufDisable", "TSModuleInfo" },
    build = ":TSUpdate",
    config = function ()
      local configs = require "nvim-treesitter.configs"
      configs.setup({
        ensure_installed = { "lua", "vim", "vimdoc" },
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
      "hrsh7th/cmp-nvim-lsp",
      "hrsh7th/cmp-buffer",
      "hrsh7th/cmp-path",
      "hrsh7th/cmp-cmdline",
      "hrsh7th/nvim-cmp",
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
      }
    },
    config = function ()
      local mason = require("mason")
      local mason_lspconfig = require("mason-lspconfig")
      local cmp = require("cmp")

      mason.setup()
      mason_lspconfig.setup({
        ensure_installed= {
          "lua_ls",
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
        sources = cmp.config.sources({
          { name = 'nvim_lsp' }
        }, { name = "buffer" }),
      })
    end
  },
}
