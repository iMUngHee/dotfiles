return {
  {
    "WhoIsSethDaniel/mason-tool-installer.nvim",
    dependencies = { "williamboman/mason.nvim" },
    opts = function()
      local ensure = {
        "prettierd",
        "stylua",
        "clang-format",
        "gofumpt",
        "goimports",
        "beautysh",
      }

      -- fantomas installs through `dotnet tool install`, which is an SDK
      -- command. A machine with only the .NET runtime has /usr/bin/dotnet and
      -- fails anyway -- `dotnet tool` reports "The application 'tool' does not
      -- exist" and exits 155 -- so mason retried it on every startup and
      -- printed "fantomas: failed to install" each time. That is the state a
      -- machine lands in when something else pulls dotnet-runtime in as a
      -- dependency, which is not rare.
      --
      -- Hence --list-sdks rather than executable("dotnet"): the binary being
      -- present says nothing about whether the command can run. Empty output
      -- means runtime only. The fsharp entry in formatters_by_ft stays either
      -- way; conform simply finds no formatter, exactly as it does today.
      local has_sdk = false
      if vim.fn.executable("dotnet") == 1 then
        local sdks = vim.fn.system({ "dotnet", "--list-sdks" })
        has_sdk = vim.v.shell_error == 0 and sdks:match("%S") ~= nil
      end
      if has_sdk then
        table.insert(ensure, "fantomas")
      end

      return { ensure_installed = ensure }
    end,
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
        css = { "prettierd" },
        scss = { "prettierd" },
        less = { "prettierd" },
        c = { "clang_format" },
        cpp = { "clang_format" },
        rust = { "rustfmt" },
        toml = {}, -- no formatter; prevents lsp_format fallback
        go = { "gofumpt", "goimports" },
        swift = { "swift_format" }, -- macOS: brew install swift-format | Linux: build from source (github.com/apple/swift-format)
        sh = { "beautysh" },
        bash = { "beautysh" },
        java = { "palantir-java-format" },
        fsharp = { "fantomas" },
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
