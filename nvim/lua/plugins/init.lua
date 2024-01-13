return {
	"folke/neodev.nvim",
	{
		"folke/which-key.nvim",
		event = "VeryLazy"
	},
	{
		'maxmx03/dracula.nvim',
		lazy = false,
		priority = 1000,
		config = function ()
			local dracula = require 'dracula'
			dracula.setup()
			vim.cmd.colorscheme 'dracula'
		end
	},
	{
		"nvim-treesitter/nvim-treesitter",
		-- cmd = { "TSInstall", "TSBufEnable", "TSBufDisable", "TSModuleInfo" },
		build = ":TSUpdate",
		config = function ()
			local configs = require "nvim-treesitter.configs"
			configs.setup({
				ensure_installed = { "lua" },
				highlight = {
					enable = true,
					use_languagetree = true,
				},
				indent = { enable = true }
			})
		end
	},
}
