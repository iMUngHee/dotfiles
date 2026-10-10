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
        -- .cu/.cuh are filetype=cuda out of the box in 0.12, but the c parser
        -- does not cover __global__, <<<>>> or the builtin variables, so a
        -- kernel renders unhighlighted without this.
        "cuda",
        "javascript",
        "typescript",
        "tsx",
        "rust",
        "json",
        "toml",
        "yaml",
        "html",
        "css",
        "scss",
        "go",
        "helm",
        "dockerfile",
        "bash",
        "groovy",
        "jsdoc",
        "java",
        "kotlin",
        -- Neovim 0.12 already maps .fs/.fsx/.fsi to the fsharp filetype.
        "fsharp",
        "c_sharp",
      })

      vim.treesitter.language.register("bash", "sh")
      -- The parser is named c_sharp, the filetype is cs, and nothing in Neovim
      -- 0.12 maps between them: without this get_lang("cs") answers "cs", the
      -- FileType handler below asks for a parser/cs.so that does not exist, and
      -- the pcall drops the buffer to foldmethod=indent with no highlighting.
      -- fsharp needs no equivalent because its parser and filetype share a name.
      vim.treesitter.language.register("c_sharp", "cs")

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
