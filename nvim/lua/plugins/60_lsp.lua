return {
  {
    "folke/lazydev.nvim",
    ft = "lua",
    opts = {
      library = {
        { path = "${3rd}/luv/library", words = { "vim%.uv" } },
      },
    },
  },
  {
    "williamboman/mason.nvim",
    lazy = false,
    build = ":MasonUpdate",
    opts = {},
  },
  {
    "neovim/nvim-lspconfig",
    lazy = false,
    dependencies = {
      "williamboman/mason.nvim",
      "williamboman/mason-lspconfig.nvim",
      "hrsh7th/cmp-nvim-lsp",
    },
    -- Server-specific settings live in after/lsp/<server>.lua (Neovim 0.11+ native config).
    -- mason-lspconfig.automatic_enable auto-starts servers listed in ensure_installed.
    config = function()
      vim.lsp.config("*", {
        capabilities = require("cmp_nvim_lsp").default_capabilities(),
      })

      -- sourcekit-lsp: not managed by mason (bundled with Xcode / Swift toolchain)
      --   macOS: xcode-select --install
      --   Linux: apt install swift | swift.org toolchain (sourcekit-lsp must be in PATH)
      vim.lsp.enable("sourcekit")

      require("mason-lspconfig").setup({
        automatic_enable = true,
        ensure_installed = {
          "ts_ls",
          "eslint", -- ESLint LSP: real-time diagnostics + code actions (replaces nvim-lint eslint_d)
          "lua_ls",
          "rust_analyzer",
          "clangd",
          "gopls",
          "helm_ls",
          "docker_language_server",
          "bashls",
          "groovyls",
          "jsonls",
          "cspell_ls",
          "nginx_language_server",
          "jdtls",
          "kotlin_lsp",
        },
      })
    end,
  },
  {
    "hrsh7th/nvim-cmp",
    event = "InsertEnter",
    dependencies = {
      "hrsh7th/cmp-nvim-lsp",
      "hrsh7th/cmp-path",
      "hrsh7th/cmp-buffer",
      "folke/lazydev.nvim",
      {
        "windwp/nvim-autopairs",
        event = "InsertEnter",
        config = true,
      },
    },
    opts = function(_, opts)
      local cmp = require("cmp")
      local cmp_autopairs = require("nvim-autopairs.completion.cmp")
      cmp.event:on("confirm_done", cmp_autopairs.on_confirm_done())

      opts = opts or {}

      opts.mapping = cmp.mapping.preset.insert({
        ["<Tab>"] = cmp.mapping.complete(),
        ["<CR>"] = cmp.mapping.confirm({ select = true }),
      })
      opts.sources = cmp.config.sources({
        {
          name = "lazydev",
          group_index = 0,
        },
        { name = "nvim_lsp" },
      }, {
        { name = "buffer" },
        { name = "path" },
      })

      return opts
    end,
  },
}
