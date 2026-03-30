return {
  {
    "WhoIsSethDaniel/mason-tool-installer.nvim",
    dependencies = { "williamboman/mason.nvim" },
    opts = {
      ensure_installed = {
        "prettierd",
        "stylua",
        "clang-format",
        "gofumpt",
        "goimports",
        "beautysh",
      },
    },
  },
  {
    "stevearc/conform.nvim",
    event = "BufWritePre",
    opts = {
      formatters = {
        prettierd = {
          env = { NO_COLOR = "1" },
        },
      },
      formatters_by_ft = {
        lua = { "stylua" },
        javascript = { "prettierd" },
        typescript = { "prettierd" },
        javascriptreact = { "prettierd" },
        typescriptreact = { "prettierd" },
        json = { "prettierd" },
        yaml = { "prettierd" },
        markdown = { "prettierd" },
        jsonc = { "prettierd" },
        c = { "clang_format" },
        cpp = { "clang_format" },
        rust = { "rustfmt" },
        toml = {}, -- no formatter; prevents lsp_format fallback
        go = { "gofumpt", "goimports" },
        swift = { "swift_format" }, -- macOS: brew install swift-format | Linux: build from source (github.com/apple/swift-format)
        sh = { "beautysh" },
        bash = { "beautysh" },
        java = { "palantir-java-format" },
      },
      format_on_save = {
        lsp_format = "fallback",
        timeout_ms = 1000,
      },
    },
    keys = {
      {
        "<leader>F",
        function()
          require("conform").format({ async = true })
        end,
        desc = "Format (Conform)",
      },
    },
  },
}
