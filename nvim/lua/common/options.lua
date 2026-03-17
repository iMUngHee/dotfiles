--[[
--
--  Neovim Options
--  Ref: https://neovim.io/doc/user/options.html
--
--]]

local opt = vim.opt
local g = vim.g

g.loaded_netrwPlugin = 1
g.loaded_netrw = 1
g.rustfmt_autosave = 0 -- disabled; conform.nvim handles formatting

opt.shell = vim.env.SHELL or "/bin/zsh"
opt.shellcmdflag = "-c"
opt.shellxquote = ""

opt.termguicolors = true
opt.showtabline = 2

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
opt.listchars = { tab = "» ", trail = "·", nbsp = "_", eol = "↵" }

opt.fillchars = { eob = " " }
opt.ignorecase = true
opt.smartcase = true
opt.mouse = "a"

opt.number = true
opt.relativenumber = true
opt.numberwidth = 2
opt.ruler = false

opt.undofile = true
opt.confirm = true
opt.inccommand = "split"

opt.updatetime = 250
opt.timeoutlen = 300

opt.signcolumn = "yes"
opt.scrolloff = 8
opt.splitright = true
opt.splitbelow = true

local aug = vim.api.nvim_create_augroup("EphemeralBufs", { clear = true })

vim.api.nvim_create_autocmd("FileType", {
  group = aug,
  pattern = { "lspinfo", "checkhealth", "null-ls-info", "notify" },
  callback = function(args)
    vim.bo[args.buf].buflisted = false
    vim.keymap.set("n", "q", function()
      if vim.api.nvim_buf_is_valid(args.buf) then
        vim.api.nvim_buf_delete(args.buf, { force = true })
      end
    end, { buffer = args.buf, silent = true })
  end,
})

vim.api.nvim_create_autocmd("FileType", {
  group = aug,
  pattern = "qf",
  callback = function()
    vim.bo.buflisted = false
    vim.keymap.set("n", "<CR>", "<CR><cmd>cclose<CR>", { buffer = true, silent = true })
  end,
})
