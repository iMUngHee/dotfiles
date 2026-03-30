---@type vim.lsp.Config
return {
  settings = {
    run = "onType",
    format = false, -- keep prettierd for formatting
    workingDirectory = { mode = "location" },
  },
}
