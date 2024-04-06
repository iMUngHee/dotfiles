--[[
--
--  Neovim Mappings
--  Ref: https://neovim.io/doc/user/usr_40.html#40.1
--  
--]]

local g = vim.g
local keymap = vim.keymap

g.mapleader = " "
g.maplocalleader = " "

-- Clear highlights
keymap.set("n", "<ESC>", "<cmd> noh <CR>", { desc = "Clear highlights" })

-- Navigate within insert mode
keymap.set("i", "<C-h>", "<Left>", { desc = "Move Left" })
keymap.set("i", "<C-l>", "<Right>", { desc = "Move Right" })
keymap.set("i", "<C-j>", "<Down>", { desc = "Move Down" })
keymap.set("i", "<C-k>", "<Up>", { desc = "Move Up" })

