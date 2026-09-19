-- Semantic colours read from whatever colorscheme is active.
--
-- The UI plugins used to call
--     require("catppuccin.palettes").get_palette("mocha")
-- inside their opts. That resolves to fixed hex values once, at setup, and
-- never moves again — so switching colorscheme left the bufferline diagnostics,
-- the scrollview signs and the readonly-LSP highlights on Catppuccin while the
-- buffer followed the new theme.
--
-- Highlight groups are the colorscheme-agnostic source for the same five
-- colours: every colorscheme defines Diagnostic*, String and Constant. The
-- fallbacks are the Catppuccin Mocha values these call sites used before, so a
-- colorscheme that leaves a group unset renders exactly as it did.

local M = {}

---@param names string[] highlight groups to try, in order
---@param fallback string
---@return string
local function fg(names, fallback)
  for _, name in ipairs(names) do
    -- link = false resolves the link chain, so a group defined only as a link
    -- still yields a colour instead of a link record with no fg.
    local ok, hl = pcall(vim.api.nvim_get_hl, 0, { name = name, link = false })
    if ok and type(hl) == "table" and hl.fg then
      return string.format("#%06x", hl.fg)
    end
  end
  return fallback
end

---Semantic colours for the colorscheme that is active right now.
function M.get()
  return {
    red = fg({ "DiagnosticError", "ErrorMsg" }, "#f38ba8"),
    yellow = fg({ "DiagnosticWarn", "WarningMsg" }, "#f9e2af"),
    green = fg({ "DiagnosticOk", "String" }, "#a6e3a1"),
    teal = fg({ "DiagnosticHint", "Special" }, "#94e2d5"),
    lavender = fg({ "Constant", "Identifier" }, "#b4befe"),
  }
end

---Run `fn` now, and again after every colorscheme change.
---
---Plugins that take colours as setup options cannot pick up a new theme on
---their own, and :colorscheme clears user highlights outright — so following
---the theme means redoing that work on the event.
---@param name string unique suffix for the augroup
---@param fn fun()
function M.on_colorscheme(name, fn)
  pcall(fn)
  vim.api.nvim_create_autocmd("ColorScheme", {
    group = vim.api.nvim_create_augroup("PaletteFollow_" .. name, { clear = true }),
    -- Never fatal: a colorscheme change must not abort on one plugin's setup.
    callback = function()
      pcall(fn)
    end,
  })
end

return M
