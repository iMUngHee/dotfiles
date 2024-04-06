--[[
--
--  Neovim Options
--  Ref: https://neovim.io/doc/user/options.html
--
--]]

local opt = vim.opt

opt.laststatus = 3
opt.showmode = false

opt.clipboard = "unnamedplus"
opt.cursorline = true

opt.shiftwidth = 2
opt.smartindent = true
opt.breakindent = true

opt.expandtab = true
opt.tabstop = 2
opt.softtabstop = 2

opt.list = true
opt.listchars = { tab = "» ", trail = "·", nbsp = "␣", eol = "↵" }

opt.fillchars = { eob = " " }
opt.ignorecase = true
opt.smartcase = true
opt.mouse = "a"

opt.number = true
opt.relativenumber = true
opt.numberwidth = 2
opt.ruler = false

opt.undofile = true

opt.updatetime = 250

