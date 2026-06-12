return {
  {
    "MeanderingProgrammer/render-markdown.nvim",
    dependencies = { "nvim-tree/nvim-web-devicons" },
    ft = { "markdown" },
    opts = {},
    config = function(_, opts)
      require("render-markdown").setup(opts)
      -- Bind the render toggle only to real markdown file buffers (buftype="").
      -- Overlay floats (LSP hover, diagnostics, etc.) are also markdown buffers
      -- but carry a non-empty buftype, so they get no keymap. Combined with the
      -- buffer-local buf_toggle (not the global toggle, which would sweep every
      -- attached buffer including the overlay), the overlay never reacts to
      -- <leader>tm and stays rendered at all times.
      local function bind(buf)
        if vim.bo[buf].filetype ~= "markdown" or vim.bo[buf].buftype ~= "" then
          return
        end
        vim.keymap.set("n", "<leader>tm", "<cmd>RenderMarkdown buf_toggle<cr>", {
          buffer = buf,
          desc = "Toggle Markdown render",
        })
      end
      vim.api.nvim_create_autocmd("FileType", {
        pattern = "markdown",
        callback = function(args)
          bind(args.buf)
        end,
      })
      -- Cover the buffer that triggered the ft-based lazy load.
      bind(vim.api.nvim_get_current_buf())
    end,
  },
}
