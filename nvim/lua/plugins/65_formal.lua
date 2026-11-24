-- Formal verification languages. TLA+ needs no plugin: its treesitter parser is
-- installed in 50_treesitter.lua and :TLC lives in after/ftplugin/tla.lua.
return {
  {
    -- Lean 4: language server (lake serve), infoview with goals, unicode
    -- abbreviations such as \to. Needs elan on PATH; the server version comes
    -- from the project's lean-toolchain file.
    "Julian/lean.nvim",
    event = { "BufReadPre *.lean", "BufNewFile *.lean" },
    init = function()
      vim.g.lean_config = { mappings = true }
    end,
  },
}
