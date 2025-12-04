local M = {}
local S = {}

local function norm(path)
	if type(path) ~= "string" or path == "" then
		return nil
	end

	return vim.loop.fs_realpath(path) or vim.fn.fnamemodify(path, ":p")
end

function M.push(path)
	local p = norm(path)
	if not p then
		return
	end

	S[#S + 1] = p
end

function M.pop()
	if #S == 0 then
		return nil
	end

	local v = S[#S]
	S[#S] = nil

	return v
end

function M.peek()
	return S[#S]
end

function M.has(path)
	local p = norm(path)
	if not p then
		return false
	end

	for i = #S, 1, -1 do
		if S[i] == p then
			return true
		end
	end

	return false
end

function M.remove(path)
	local p = norm(path)
	if not p then
		return 0
	end

	local removed = 0
	for i = #S, 1, -1 do
		if S[i] == p then
			table.remove(S, i)
			removed = removed + 1
		end
	end

	return removed
end

function M.size()
	return #S
end

function M.clear()
	for i = #S, 1, -1 do
		S[i] = nil
	end
end

-- for debug
function M.dump()
	return vim.deepcopy(S)
end

return M
