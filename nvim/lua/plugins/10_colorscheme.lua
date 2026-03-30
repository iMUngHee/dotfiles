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

      local C = require("catppuccin.palettes").get_palette("mocha")
      vim.api.nvim_set_hl(0, "@lsp.typemod.variable.readonly", { fg = C.lavender })
      vim.api.nvim_set_hl(0, "@lsp.typemod.property.readonly", { fg = C.lavender })
    end,
  },
}
