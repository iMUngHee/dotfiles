return {
	{
		"folke/lazydev.nvim",
		lazy = false,
		ft = "lua",
		opts = {
			library = {
				{ path = "${3rd}/luv/library", words = { "vim%.uv" } },
			},
		},
	},
	{
		"williamboman/mason.nvim",
		lazy = false,
		build = ":MasonUpdate",
		opts = {},
	},
	{
		"neovim/nvim-lspconfig",
		lazy = false,
		dependencies = {
			"williamboman/mason.nvim",
			"williamboman/mason-lspconfig.nvim",
			"hrsh7th/cmp-nvim-lsp",
		},
		config = function()
			local lspconfig = require("lspconfig")
			local caps = require("cmp_nvim_lsp").default_capabilities()

			require("mason-lspconfig").setup({
				ensure_installed = {
					"lua_ls",
					"rust_analyzer",
					"clangd",
					"gopls",
					"helm_ls",
					"docker_language_server",
					"bashls",
					"groovyls",
				},
				handlers = {
					function(server)
						lspconfig[server].setup({ capabilities = caps })
					end,
				},
			})
		end,
	},
	{
		"pmizio/typescript-tools.nvim",
		lazy = false,
		dependencies = { "nvim-lua/plenary.nvim", "neovim/nvim-lspconfig" },
		enabled = function()
			return vim.fn.findfile(".flowconfig", ".;") == ""
		end,
		opts = {
			settings = {
				separate_diagnostic_server = true,
				publish_diagnostic_on = "insert_leave",
				expose_as_code_action = {
					"add_missing_imports",
					"remove_unused",
					"organize_imports",
					"fix_all",
				},
				jsx_close_tag = {
					enable = true,
					filetypes = { "javascriptreact", "typescriptreact" },
				},
				complete_function_calls = true,
				tsserver_file_preferences = {
					includeInlayParameterNameHints = "all",
					includeCompletionsForModuleExports = true,
					quotePreference = "auto",
				},
			},
		},
		config = function(_, opts)
			require("typescript-tools").setup(opts)
		end,
	},
	{
		"hrsh7th/nvim-cmp",
		event = "InsertEnter",
		dependencies = {
			"hrsh7th/cmp-nvim-lsp",
			"hrsh7th/cmp-path",
			"hrsh7th/cmp-buffer",
			"folke/lazydev.nvim",
			{
				"windwp/nvim-autopairs",
				event = "InsertEnter",
				config = true,
			},
		},
		opts = function(_, opts)
			local cmp = require("cmp")
			local cmp_autopairs = require("nvim-autopairs.completion.cmp")
			cmp.event:on("confirm_done", cmp_autopairs.on_confirm_done())

			opts = opts or {}

			opts.mapping = cmp.mapping.preset.insert({
				["<Tab>"] = cmp.mapping.complete(),
				["<CR>"] = cmp.mapping.confirm({ select = true }),
			})
			opts.sources = cmp.config.sources({
				{
					name = "lazydev",
					group_index = 0,
				},
				{ name = "nvim_lsp" },
			}, {
				{ name = "buffer" },
				{ name = "path" },
			})

			return opts
		end,
	},
}
