return {
	{
		"lewis6991/gitsigns.nvim",
		event = "BufReadPre",
		dependencies = { "nvim-lua/plenary.nvim" },
		opts = {
			signs = {
				add = { text = "┃" },
				change = { text = "┃" },
				delete = { text = "" },
				topdelete = { text = "" },
				changedelete = { text = "┃" },
				untracked = { text = "┆" },
			},
			current_line_blame = true,
			current_line_blame_opts = {
				delay = 100,
				virt_text_pos = "eol",
			},
			on_attach = function(bufnr)
				local gs = package.loaded.gitsigns
				local map = function(mode, lhs, rhs, desc)
					vim.keymap.set(mode, lhs, rhs, { buffer = bufnr, silent = true, desc = desc })
				end

				-- hunk 이동
				map("n", "]g", gs.next_hunk, "Next Hunk")
				map("n", "[g", gs.prev_hunk, "Prev Hunk")

				-- 라인 blame 토글
				map("n", "<leader>gb", gs.toggle_current_line_blame, "Toggle Blame")

				-- stage/undo
				map("n", "<leader>gs", gs.stage_hunk, "Stage Hunk")
				map("n", "<leader>gu", gs.undo_stage_hunk, "Unstage Hunk")
			end,
		},
	},
	{
		"sindrets/diffview.nvim",
		cmd = { "DiffviewOpen", "DiffviewFileHistory" },
		dependencies = { "nvim-lua/plenary.nvim" },

		keys = {
			{ "<leader>gd", "<cmd>DiffviewOpen<CR>", desc = "Diff HEAD ↔ Working Tree" },
			{ "<leader>gf", "<cmd>DiffviewFileHistory %<CR>", desc = "File History" },
			{ "<leader>gF", "<cmd>DiffviewFileHistory<CR>", desc = "Repo History" },
			{ "<leader>gq", "<cmd>DiffviewClose<CR>", desc = "Close Diffview" },
		},

		opts = {
			enhanced_diff_hl = true,
			view = {
				merge_tool = { layout = "diff4_mixed" },
			},
			icons = {
				folder_closed = "",
				folder_open = "",
			},
		},
	},
}
