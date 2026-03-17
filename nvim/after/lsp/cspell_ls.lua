---@type vim.lsp.Config
return {
  root_dir = function(bufnr, on_dir)
    if vim.bo[bufnr].filetype == "oil" then
      return
    end

    local name = vim.api.nvim_buf_get_name(bufnr)
    if name == "" or name:match("^oil://") then
      return
    end

    local root = vim.fs.root(name, {
      ".git",
      "cspell.json",
      ".cspell.json",
      ".cSpell.json",
      "cSpell.json",
      "cspell.config.js",
      "cspell.config.cjs",
      "cspell.config.json",
      "cspell.config.yaml",
      "cspell.config.yml",
      "cspell.yaml",
      "cspell.yml",
    })

    on_dir(root or vim.uv.cwd() or "")
  end,
}
