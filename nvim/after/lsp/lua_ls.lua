---@type vim.lsp.Config
return {
  settings = {
    Lua = {
      runtime = { version = "LuaJIT" },
      diagnostics = {
        globals = { "vim" },
      },
      workspace = {
        library = {
          vim.env.VIMRUNTIME .. "/lua",
          "${3rd}/luv/library",
        },
        checkThirdParty = false,
      },
    },
  },
}
