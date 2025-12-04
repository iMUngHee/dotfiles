local diagnostic = vim.diagnostic

diagnostic.config({
	float = {
		border = "rounded",
		source = true,
		header = "",
		prefix = "",
	},
	virtual_text = {
		prefix = "●",
		spacing = 2,
	},
	signs = true,
	underline = true,
	update_in_insert = false,
})
