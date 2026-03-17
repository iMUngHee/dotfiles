local diagnostic = vim.diagnostic

diagnostic.config({
  float = {
    border = "rounded",
    source = true,
    header = "",
    prefix = "",
  },
  virtual_text = {
    prefix = "●",
    spacing = 2,
  },
  signs = {
    text = {
      [vim.diagnostic.severity.ERROR] = "",
      [vim.diagnostic.severity.WARN] = "",
      [vim.diagnostic.severity.HINT] = "",
      [vim.diagnostic.severity.INFO] = "",
    },
  },
  underline = true,
  severity_sort = true,
  update_in_insert = false,
})
