-- File references shared by the @path copy mappings and inline_review.
local M = {}

---Repository root of a buffer: the nearest .git ancestor, else the cwd.
---@param buf? integer
function M.root(buf)
  return vim.fs.root(buf or 0, ".git") or vim.fn.getcwd()
end

---Path of `abs` relative to `root` after resolving symlinks, or nil when the
---file is outside `root`. Unlike M.path this never falls back to the cwd.
---@param root string
---@param abs string
---@return string?
function M.relative(root, abs)
  root = vim.fn.resolve(root):gsub("/$", "")
  local resolved = vim.fn.resolve(abs)
  if resolved:sub(1, #root + 1) == root .. "/" then
    return resolved:sub(#root + 2)
  end
end

---Display path of the current buffer for AI tool references: relative to the
---project root ("project"), or with ~ for home ("home").
---@param scope "project"|"home"
---@return string?
function M.path(scope)
  local abs = vim.fn.expand("%:p")
  if abs == "" or vim.bo.buftype ~= "" then
    return nil
  end
  if scope == "home" then
    return vim.fn.fnamemodify(abs, ":~")
  end
  local root = M.root(0)
  local resolved = vim.fn.resolve(abs)
  if resolved:sub(1, #root) == root then
    return resolved:sub(#root + 2)
  end
  return vim.fn.expand("%:.")
end

return M
