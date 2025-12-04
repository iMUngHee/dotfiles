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
		"nvim-telescope/telescope.nvim",
		cmd = "Telescope",
		keys = {
			{
				"<leader>ff",
				function()
					require("telescope.builtin").find_files({ cwd = get_root(), hidden = true })
				end,
				desc = "Find files",
			},
			{
				"<leader>fg",
				function()
					require("telescope.builtin").live_grep({ cwd = get_root(), hidden = true })
				end,
				desc = "Live grep",
			},
			{ "<leader>fb", "<cmd>Telescope buffers<CR>", desc = "Buffers" },
			{ "<leader>fd", "<cmd>Telescope diagnostics<CR>", desc = "Diagnostics" },
			{ "<leader>fp", "<cmd>Telescope projects<CR>", desc = "Projects" },
		},
		dependencies = {
			"nvim-lua/plenary.nvim",
			"nvim-tree/nvim-web-devicons",
		},
		opts = {
			defaults = {
				prompt_prefix = " ",
				selection_caret = " ",
				layout_strategy = "horizontal",
				layout_config = { prompt_position = "top" },
				sorting_strategy = "ascending",
				file_ignore_patterns = { "%.git/", "node_modules" },
				mappings = {
					i = { ["<C-h>"] = "which_key" },
				},
			},
			pickers = {
				find_files = { hidden = true },
			},
		},

		config = function(_, opts)
			local telescope = require("telescope")
			telescope.setup(opts)

			pcall(telescope.load_extension, "fzf")
			pcall(telescope.load_extension, "projects")
		end,
	},
	{
		"nvim-telescope/telescope-fzf-native.nvim",
		build = "make",
		cond = vim.fn.executable("make") == 1,
		dependencies = { "telescope.nvim" },
	},
}
