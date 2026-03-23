return {
  {
    "Mofiqul/dracula.nvim",
    lazy = false,
    priority = 1000,
    opts = {
      italic_comment = true,
      transparent_bg = false,
      overrides = function(c)
        return {
          -- Vim-level fallback: operator → pink (dracula.nvim default: purple)
          Operator = { fg = c.pink },

          -- VSCode: keyword → pink (dracula.nvim default: purple)
          ["@keyword.exception"] = { fg = c.pink },

          -- VSCode: storage.type → cyan italic (function/class keyword)
          ["@keyword.function"] = { fg = c.cyan, italic = true },

          -- VSCode: constant.numeric.float → purple (dracula.nvim default: green)
          ["@number.float"] = { fg = c.purple },

          -- VSCode: entity.name.type → cyan italic
          ["@type"] = { fg = c.cyan, italic = true },

          -- VSCode: interpolation/special punctuation → pink (unset → fell back to green)
          ["@punctuation.special"] = { fg = c.pink },

          -- VSCode: variable.parameter → orange italic
          ["@variable.parameter"] = { fg = c.orange, italic = true },
          ["@lsp.type.parameter"] = { fg = c.orange, italic = true },

          -- VSCode: object member / property → fg (dracula.nvim default: orange/purple)
          ["@variable.member"] = { fg = c.fg },
          ["@property"] = { fg = c.fg },
          ["@lsp.type.property"] = { fg = c.fg },

          -- VSCode: variable.language → purple italic (dracula.nvim default: no italic)
          ["@variable.builtin"] = { fg = c.purple, italic = true },

          -- VSCode: entity.name.type → cyan (dracula.nvim default: bright_cyan)
          ["@lsp.type.type"] = { fg = c.cyan },

          -- VSCode: constant.character.escape → pink (dracula.nvim default: cyan)
          ["@string.escape"] = { fg = c.pink },

          -- VSCode: string.regexp → yellow (dracula.nvim default: red)
          ["@string.regexp"] = { fg = c.yellow },

          -- VSCode: entity.name.tag → pink (dracula.nvim default: cyan)
          ["@tag"] = { fg = c.pink },

          -- VSCode: entity.other.attribute-name → green italic (dracula.nvim default: no italic)
          ["@tag.attribute"] = { fg = c.green, italic = true },

          -- VSCode: tag brackets → fg (dracula.nvim default: cyan)
          ["@tag.delimiter"] = { fg = c.fg },

          -- VSCode: variable.readonly (const) → purple via LSP semantic token
          ["@lsp.typemod.variable.readonly"] = { fg = c.purple },
          ["@lsp.typemod.variable.defaultLibrary"] = { fg = c.purple, italic = true },

          -- Rainbow delimiters: 이름 = 실제 색상 일치
          RainbowDelimiterRed    = { fg = c.red },
          RainbowDelimiterYellow = { fg = c.yellow },
          RainbowDelimiterBlue   = { fg = c.cyan },
          RainbowDelimiterOrange = { fg = c.orange },
          RainbowDelimiterGreen  = { fg = c.green },
          RainbowDelimiterViolet = { fg = c.purple },
          RainbowDelimiterCyan   = { fg = c.pink },
        }
      end,
    },
    config = function(_, opts)
      require("dracula").setup(opts)
      vim.cmd.colorscheme("dracula")
    end,
  },
}
