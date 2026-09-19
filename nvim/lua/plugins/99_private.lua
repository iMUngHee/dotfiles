-- Machine-local plugin specs.
--
-- The hook is tracked; the content is not (.gitignore: nvim/lua/private/*).
-- Same convention as zsh/.zshrc sourcing $ZDOTDIR/private.sh, ghostty/config
-- including private.conf and tmux.conf sourcing private.conf. Numbered 99 so
-- these load after everything in plugins/ and can override it.
--
-- Returns an empty spec list when the module is absent, which is the normal
-- state on a machine that has nothing local to add.
local ok, spec = pcall(require, "private.plugins")
if not ok or type(spec) ~= "table" then
  return {}
end
return spec
