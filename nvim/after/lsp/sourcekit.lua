---@type vim.lsp.Config
return {
  -- Exclude c/cpp (handled by clangd); default lspconfig filetypes include them
  filetypes = { "swift", "objc", "objcpp" },
}
