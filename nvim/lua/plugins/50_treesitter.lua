return {
	{
		"nvim-treesitter/nvim-treesitter",
		build = ":TSUpdate",
		event = { "BufReadPost", "BufNewFile" },
		dependencies = {
			"nvim-treesitter/nvim-treesitter-textobjects",
		},
		opts = {
			ensure_installed = {
				"lua",
				"vim",
				"vimdoc",
				"javascript",
				"typescript",
				"c",
				"rust",
				"json",
				"toml",
				"yaml",
				"html",
				"css",
				"go",
			},
			highlight = { enable = true },
			indent = { enable = true },
			incremental_selection = {
				enable = true,
				keymaps = {
					init_selection = "gnn",
					node_incremental = "grn",
					scope_incremental = "grc",
					node_decremental = "grm",
				},
			},
			textobjects = {
				select = {
					enable = true,
					lookahead = true,
					keymaps = {
						["af"] = "@function.outer",
						["if"] = "@function.inner",
						["ac"] = "@class.outer",
						["ic"] = "@class.inner",
						["ai"] = "@conditional.outer",
						["ii"] = "@conditional.inner",
					},
				},
				move = {
					enable = true,
					set_jumps = true,
					goto_next_start = { ["]f"] = "@function.outer", ["]c"] = "@class.outer" },
					goto_previous_start = { ["[f"] = "@function.outer", ["[c"] = "@class.outer" },
				},
			},
		},
		config = function(_, opts)
			require("nvim-treesitter.configs").setup(opts)

			vim.o.foldlevel = 99
			vim.o.foldlevelstart = 99

			vim.api.nvim_create_autocmd({ "BufReadPost", "BufNewFile" }, {
				group = vim.api.nvim_create_augroup("TSFolding", { clear = true }),
				callback = function()
					local buf = vim.api.nvim_get_current_buf()
					local status, parser = pcall(vim.treesitter.get_parser, buf)

					if status and parser then
						vim.opt_local.foldmethod = "expr"
						vim.opt_local.foldexpr = "v:lua.vim.treesitter.foldexpr()"
					else
						vim.opt_local.foldmethod = "indent"
					end
				end,
			})
		end,
	},
	{
		"nvim-treesitter/nvim-treesitter-context",
		event = "BufReadPost",
		opts = {
			enable = true,
			max_lines = 3,
			multiline_threshold = 5,
		},
	},
	{
		"HiPhish/rainbow-delimiters.nvim",
		event = "BufReadPost",
	},
}
