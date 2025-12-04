return {
	{ "nvim-tree/nvim-web-devicons", lazy = true },
	{ "MunifTanjim/nui.nvim", lazy = true },
	{
		"nvim-lualine/lualine.nvim",
		event = "VeryLazy",

		dependencies = { "nvim-web-devicons" },
		opts = {
			options = {
				theme = "catppuccin",
				component_separators = "│",
				section_separators = "",
			},

			sections = {
				lualine_c = { { "filename", path = 1 } },
				lualine_x = { "encoding", "fileformat", "filetype" },
			},
		},
	},
	{
		"akinsho/bufferline.nvim",
		event = "VeryLazy",
		version = "*",
		dependencies = { "nvim-web-devicons" },
		-- undo stack
		init = function()
			local Stack = require("utils.buffer_stack")
			local grp = vim.api.nvim_create_augroup("ClosedBufferStack", { clear = true })

			vim.api.nvim_create_autocmd({ "BufDelete" }, {
				group = grp,
				callback = function(args)
					local ok_bt, bt = pcall(vim.api.nvim_get_option_value, "buftype", { buf = args.buf })
					bt = ok_bt and bt or vim.bo[args.buf].buftype

					if bt ~= "" then
						return
					end

					local path = vim.api.nvim_buf_get_name(args.buf)
					if path == nil or path == "" then
						return
					end

					if vim.fn.filereadable(path) ~= 1 then
						return
					end

					if not Stack.has(path) then
						Stack.push(path)
					end
				end,
			})

			vim.api.nvim_create_autocmd({ "BufReadPost", "BufNewFile" }, {
				group = grp,
				callback = function(args)
					local path = vim.api.nvim_buf_get_name(args.buf)
					if path ~= "" then
						Stack.remove(path)
					end
				end,
			})
		end,
		opts = {
			options = {
				mode = "buffers",
				diagnostics = "nvim_lsp",
				separator_style = "slant",
				always_show_bufferline = true,
				numbers = "ordinal",
				offsets = {
					{
						filetype = "neo-tree",
						text = "File Explorer",
						highlight = "Directory",
						text_align = "center",
						separator = true,
					},
				},
				pick = {
					alphabet = "asdfghjklqwertyuiopzxcvbnm",
				},
			},

			highlights = {
				error = { fg = "#F38BA8", bg = "NONE" },
				error_visible = { fg = "#F38BA8", bg = "NONE" },
				error_selected = { fg = "#F38BA8", bg = "NONE", bold = true, italic = true },

				error_diagnostic = { fg = "#F38BA8", bg = "NONE" },
				error_diagnostic_visible = { fg = "#F38BA8", bg = "NONE" },
				error_diagnostic_selected = { fg = "#F38BA8", bg = "NONE", bold = true, italic = true },

				warning = { fg = "#F9E2AF", bg = "NONE" },
				warning_visible = { fg = "#F9E2AF", bg = "NONE" },
				warning_selected = { fg = "#F9E2AF", bg = "NONE", bold = true, italic = true },

				warning_diagnostic = { fg = "#F9E2AF", bg = "NONE" },
				warning_diagnostic_visible = { fg = "#F9E2AF", bg = "NONE" },
				warning_diagnostic_selected = { fg = "#F9E2AF", bg = "NONE", bold = true, italic = true },

				modified = { fg = "#A6E3A1", bg = "NONE" },
				modified_visible = { fg = "#A6E3A1", bg = "NONE" },
				modified_selected = { fg = "#A6E3A1", bg = "NONE", bold = true, italic = true },
			},
		},
		keys = {
			{ "<S-h>", "<cmd>BufferLineCyclePrev<CR>", desc = "Prev buffer-tab" },
			{ "<S-l>", "<cmd>BufferLineCycleNext<CR>", desc = "Next buffer-tab" },

			{ "<leader>1", "<Cmd>BufferLineGoToBuffer 1<CR>", desc = "Go to buffer 1" },
			{ "<leader>2", "<Cmd>BufferLineGoToBuffer 2<CR>", desc = "Go to buffer 2" },
			{ "<leader>3", "<Cmd>BufferLineGoToBuffer 3<CR>", desc = "Go to buffer 3" },
			{ "<leader>4", "<Cmd>BufferLineGoToBuffer 4<CR>", desc = "Go to buffer 4" },
			{ "<leader>5", "<Cmd>BufferLineGoToBuffer 5<CR>", desc = "Go to buffer 5" },
			{ "<leader>6", "<Cmd>BufferLineGoToBuffer 6<CR>", desc = "Go to buffer 6" },
			{ "<leader>7", "<Cmd>BufferLineGoToBuffer 7<CR>", desc = "Go to buffer 7" },
			{ "<leader>8", "<Cmd>BufferLineGoToBuffer 8<CR>", desc = "Go to buffer 8" },
			{ "<leader>9", "<Cmd>BufferLineGoToBuffer 9<CR>", desc = "Go to buffer 9" },

			{ "gb", "<cmd>BufferLinePick<CR>", desc = "Pick buffer to jump" },

			{ "<leader>bc", "<cmd>bp | bd #<CR>", desc = "Close current buffer" },
			{ "<leader>bp", "<cmd>BufferLinePickClose<CR>", desc = "Pick close" },
			{ "<leader>bo", "<cmd>BufferLineCloseOthers<CR>", desc = "Close others" },

			{
				"<leader>bu",
				function()
					local Stack = require("utils.buffer_stack")

					while Stack.size() > 0 do
						local path = Stack.pop()
						if path and vim.uv.fs_statfs(path) then
							vim.cmd("edit " .. vim.fn.fnameescape(path))
							return
						end
					end
					vim.notify("Empty closed buffer stack", vim.log.levels.INFO)
				end,
				desc = "Reopen last closed buffer (stack)",
			},
			{
				"<leader>bU",
				function()
					require("utils.buffer_stack").clear()
					vim.notify("Reset buffer closed buffer stack", vim.log.levels.INFO)
				end,
				desc = "Clear closed buffer stack",
			},
		},
	},
	{
		"nvimdev/dashboard-nvim",
		event = "VimEnter",
		opts = {
			theme = "hyper",
			shortcut_type = "number",
			config = {
				week_header = { enable = true },
				project = { enable = false },
			},
		},
	},
	{
		"folke/noice.nvim",
		event = "VeryLazy",
		dependencies = {
			"MunifTanjim/nui.nvim",
			"rcarriga/nvim-notify",
		},
		opts = {
			cmdline = {
				format = {
					filter = {
						title = "Shell",
					},
				},
			},
			lsp = {
				progress = { enabled = false },
				signature = { enabled = true },
				hover = { enabled = false },
			},
			presets = {
				command_palette = true,
				inc_rename = true,
			},
		},
	},
	{ "rcarriga/nvim-notify", lazy = true },
	{
		"stevearc/dressing.nvim",
		event = "VeryLazy",
		opts = {
			input = {
				insert_only = false,
				border = "rounded",
			},
			select = {
				backend = { "telescope", "builtin" },
			},
		},
	},
	{
		"lukas-reineke/indent-blankline.nvim",
		main = "ibl",
		event = { "BufReadPost", "BufNewFile" },
		opts = {
			indent = { char = "▏" },
			scope = { enabled = true },
		},
	},
	{
		"dstein64/nvim-scrollview",
		event = { "BufReadPost", "BufNewFile" },
		opts = {
			current_only = true,
			signs_on_start = true,
			winblend = 75,
			diagnostics_error = { color = "#F38BA8" }, -- catppuccin red
			diagnostics_hint = { color = "#89DCEB" },
		},
	},
	{
		"folke/which-key.nvim",
		event = "VeryLazy",
		opts = { plugins = { spelling = true } },
	},
	{
		"norcalli/nvim-colorizer.lua",
		event = { "BufReadPost", "BufNewFile" },
		config = function()
			require("colorizer").setup()
		end,
	},
}
