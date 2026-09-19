return {
  {
    "catppuccin/nvim",
    name = "catppuccin",
    lazy = false,
    priority = 1000,
    opts = {
      flavour = "mocha",
      lsp_styles = {
        underlines = {
          errors = { "undercurl" },
          hints = { "undercurl" },
          warnings = { "undercurl" },
          information = { "undercurl" },
          ok = { "undercurl" },
        },
      },
    },
    config = function(_, opts)
      require("catppuccin").setup(opts)

      vim.cmd.colorscheme("catppuccin")

      -- Re-applied on every colorscheme change, not just here: :colorscheme
      -- clears user highlights, so these two were silently lost the moment
      -- anything switched the theme. The colours come from the active
      -- colorscheme rather than the Catppuccin palette.
      local palette = require("utils.palette")
      palette.on_colorscheme("lsp_readonly", function()
        local C = palette.get()
        vim.api.nvim_set_hl(0, "@lsp.typemod.variable.readonly", { fg = C.lavender })
        vim.api.nvim_set_hl(0, "@lsp.typemod.property.readonly", { fg = C.lavender })
      end)
    end,
  },
}
