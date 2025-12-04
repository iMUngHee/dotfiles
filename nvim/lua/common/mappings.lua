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

vim.api.nvim_create_autocmd("LspAttach", {
	group = vim.api.nvim_create_augroup("UserLspConfig", { clear = true }),
	callback = function(ev)
		local opts = { buffer = ev.buf, silent = true }

		keymap.set("n", "gd", vim.lsp.buf.definition, vim.tbl_extend("force", opts, { desc = "Go to Definition" }))
		keymap.set("n", "gD", vim.lsp.buf.declaration, vim.tbl_extend("force", opts, { desc = "Go to Declaration" }))
		keymap.set("n", "gr", vim.lsp.buf.references, vim.tbl_extend("force", opts, { desc = "Go to References" }))
		keymap.set(
			"n",
			"gI",
			vim.lsp.buf.implementation,
			vim.tbl_extend("force", opts, { desc = "Go to Implementation" })
		)
		keymap.set("n", "K", vim.lsp.buf.hover, vim.tbl_extend("force", opts, { desc = "Hover Documentation" }))
		keymap.set("n", "<C-k>", vim.lsp.buf.signature_help, vim.tbl_extend("force", opts, { desc = "Signature Help" }))
		keymap.set("n", "<leader>rn", vim.lsp.buf.rename, vim.tbl_extend("force", opts, { desc = "Rename Symbol" }))
		keymap.set(
			{ "n", "v" },
			"<leader>ca",
			vim.lsp.buf.code_action,
			vim.tbl_extend("force", opts, { desc = "Code Action" })
		)
		keymap.set("n", "]d", function()
			vim.diagnostic.jump({ count = 1, float = true })
		end, vim.tbl_extend("force", opts, { desc = "Next Diagnostic" }))
		keymap.set("n", "[d", function()
			vim.diagnostic.jump({ count = -1, float = true })
		end, vim.tbl_extend("force", opts, { desc = "Prev Diagnostic" }))
		keymap.set(
			"n",
			"gl",
			vim.diagnostic.open_float,
			vim.tbl_extend("force", opts, { desc = "Show Line Diagnostics" })
		)
	end,
})
