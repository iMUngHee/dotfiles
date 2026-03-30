return {
  {
    "nvim-treesitter/nvim-treesitter",
    branch = "main",
    build = ":TSUpdate",
    config = function()
      require("nvim-treesitter").setup({
        install_dir = vim.fn.stdpath("data") .. "/site",
      })
      require("nvim-treesitter").install({
        "lua",
        "vim",
        "vimdoc",
        "markdown",
        "markdown_inline",
        "c",
        "javascript",
        "typescript",
        "tsx",
        "rust",
        "json",
        "toml",
        "yaml",
        "html",
        "css",
        "go",
        "helm",
        "dockerfile",
        "bash",
        "groovy",
        "jsdoc",
        "java",
        "kotlin",
      })

      vim.treesitter.language.register("bash", "sh")

      vim.o.foldlevel = 99
      vim.o.foldlevelstart = 99

      local augroup = vim.api.nvim_create_augroup("TSBuiltin", { clear = true })

      vim.api.nvim_create_autocmd("FileType", {
        group = augroup,
        callback = function(ev)
          if vim.bo[ev.buf].buftype ~= "" then
            return
          end
          local lang = vim.treesitter.language.get_lang(vim.bo[ev.buf].filetype)
          if lang and pcall(vim.treesitter.start, ev.buf, lang) then
            vim.opt_local.foldmethod = "expr"
            vim.opt_local.foldexpr = "v:lua.vim.treesitter.foldexpr()"
          else
            vim.opt_local.foldmethod = "indent"
          end
        end,
      })
    end,
  },
  {
    "nvim-treesitter/nvim-treesitter-context",
    event = "BufReadPost",
    opts = {
      enable = true,
      max_lines = 3,
      multiline_threshold = 5,
    },
  },
  {
    "windwp/nvim-ts-autotag",
    event = "InsertEnter",
    opts = {},
  },
  {
    "HiPhish/rainbow-delimiters.nvim",
    event = "BufReadPost",
    config = function()
      vim.g.rainbow_delimiters = {
        query = {
          [""] = "rainbow-delimiters",
          tsx = "rainbow-parens",
          javascript = "rainbow-parens",
        },
      }
    end,
  },
}
