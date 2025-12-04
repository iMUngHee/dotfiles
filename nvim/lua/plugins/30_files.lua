local function get_root()
	-- project.nvim
	local ok, proj = pcall(require, "project_nvim.project")
	if ok then
		local root = proj.get_project_root()
		if root and root ~= "" then
			return root
		end
	end

	-- .git fallback
	if vim.fn.executable("git") == 1 then
		local inside = vim.fn.system("git rev-parse --is-inside-work-tree")
		if vim.v.shell_error == 0 and inside:match("true") then
			local git_root = vim.fn.systemlist("git rev-parse --show-toplevel")[1]
			if git_root and git_root ~= "" then
				return git_root
			end
		end
	end

	-- fallback
	return vim.uv.cwd()
end

return {
	{
		"nvim-neo-tree/neo-tree.nvim",
		branch = "v3.x",
		lazy = false,
		keys = {
			{
				"<leader>e",
				function()
					require("neo-tree.command").execute({
						toggle = true,
						position = "left",
						dir = get_root(),
						reveal = true,
					})
				end,
				desc = "File-tree (Project Root)",
			},
			{
				"<leader>E",
				function()
					require("neo-tree.command").execute({
						toggle = true,
						position = "float",
						dir = get_root(),
						reveal = true,
					})
				end,
				desc = "File-tree (Float Project Root)",
			},
		},
		dependencies = {
			"nvim-lua/plenary.nvim",
			"nvim-tree/nvim-web-devicons",
			"MunifTanjim/nui.nvim",
		},
		opts = {
			window = {
				position = "left",
				width = 28,
				mappings = { ["<CR>"] = "open", ["o"] = "open" },
			},
			filesystem = {
				bind_to_cwd = false,
				follow_current_file = {
					enabled = true,
					leave_dirs_open = false,
				},
				use_libuv_file_watcher = true,
				group_empty_dirs = true,
				hijack_netrw_behavior = "open_default",
				filtered_items = {
					hide_dotfiles = false,
					hide_gitignored = false,
				},
			},
			default_component_configs = {
				git_status = {
					symbols = {
						added = "✚",
						modified = "",
						deleted = "✖",
						renamed = "󰁕",
						untracked = "",
					},
				},
			},
		},
	},
	{
		"stevearc/oil.nvim",
		keys = {
			{ "-", "<cmd>Oil<CR>", desc = "Parent directory (Oil)" },
		},
		opts = {
			default_file_explorer = false,
			delete_to_trash = true,
			skip_confirm_for_simple_edits = true,
			view_options = {
				show_hidden = true,
				natural_order = true,
			},
		},
	},
	{
		"ahmedkhalf/project.nvim",
		event = "VeryLazy",
		opts = {
			manual_mode = false,
			detection_methods = { "lsp", "pattern" },
			patterns = {
				".git",
				"package.json",
				"Cargo.toml",
				"Makefile",
				".project_root",
				"pyproject.toml",
				"init.lua",
			},
		},
		config = function(_, opts)
			require("project_nvim").setup(opts)
			pcall(function()
				require("telescope").load_extension("projects")
			end)
		end,
	},
	{
		"rmagatti/auto-session",
		event = "VimEnter",
		opts = {
			log_level = "error",
			auto_session_enabled = true,
			auto_restore_enabled = false,
			auto_session_suppress_dirs = { "~/", "/", "~/Downloads" },
		},
	},
}
