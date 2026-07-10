---@type vim.lsp.Config
return {
  -- Default cssls filetypes are { css, scss, less }, which overlaps somesass_ls
  -- on scss and causes duplicate hover/completion. Drop scss so somesass_ls
  -- owns it exclusively. Keep less (somesass_ls only handles scss/sass).
  filetypes = { "css", "less" },
}
