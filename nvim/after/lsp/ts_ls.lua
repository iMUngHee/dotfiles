---@type vim.lsp.Config
return {
  settings = {
    javascript = {
      implicitProjectConfiguration = {
        checkJs = true,
        noImplicitAny = false,
      },
    },
    typescript = {
      preferences = {
        includeInlayParameterNameHints = "all",
        includeCompletionsForModuleExports = true,
        quotePreference = "auto",
      },
    },
    completions = {
      completeFunctionCalls = true,
    },
  },
}
