local M = {}

function M.dbg(fmt, ...)
	local ok, notify = pcall(require, "notify")
	local s = (tostring(fmt)):format(...)
	if ok then
		notify(s, vim.log.levels.INFO, { title = "BufStack" })
	else
		print(s) -- fallback
	end
end

return M
