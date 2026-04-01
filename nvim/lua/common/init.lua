-- Bootstrap lazy.nvim
local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"

if not vim.uv.fs_stat(lazypath) then
  vim.fn.system({
    "git",
    "clone",
    "--filter=blob:none",
    "https://github.com/folke/lazy.nvim.git",
    "--branch=stable",
    lazypath,
  })
end

vim.opt.rtp:prepend(lazypath)

-- Ensure mason-installed binaries are in PATH before plugin load.
-- conform.nvim / nvim-lint use vim.fn.executable() which checks vim.env.PATH.
local mason_bin = vim.fn.stdpath("data") .. "/mason/bin"
vim.env.PATH = mason_bin .. ":" .. (vim.env.PATH or "")

------------------------------

require("common.options")
require("common.mappings")
require("common.diagnostic")