---@type vim.lsp.Config
return {
  -- Exclude c/cpp (handled by clangd); default lspconfig filetypes include them
  filetypes = { "swift", "objc", "objcpp" },
  -- Share main .build dir to avoid redundant dependency resolution in index-build
  cmd = {
    "sourcekit-lsp",
    "--scratch-path",
    ".build",
  },
}
