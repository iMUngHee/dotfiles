-- File references shared by the @path copy mappings and inline_review.
local M = {}

-- Resolve links and use one separator for containment checks on every host.
local function canonical(path)
  return vim.fs.normalize(vim.uv.fs_realpath(path) or vim.fn.resolve(path), { expand_env = false })
end

---Repository root of a buffer: the nearest .git ancestor, else the cwd.
---@param buf? integer
function M.root(buf)
  return canonical(vim.fs.root(buf or 0, ".git") or vim.fn.getcwd())
end

---Path of `abs` relative to `root` after resolving symlinks, or nil when the
---file is outside `root`. Unlike M.path this never falls back to the cwd.
---@param root string
---@param abs string
---@return string?
function M.relative(root, abs)
  root = canonical(root):gsub("/$", "")
  local resolved = canonical(abs)
  local prefix = root .. "/"
  local compared = resolved
  if vim.fn.has("win32") == 1 then
    -- Windows drive and path casing may differ between git and buffer names.
    prefix, compared = prefix:lower(), compared:lower()
  end
  if compared:sub(1, #prefix) == prefix then
    return resolved:sub(#prefix + 1)
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
    local ref = vim.fn.fnamemodify(abs, ":~")
    if vim.fn.has("win32") == 1 then
      return (ref:gsub("\\", "/"))
    end
    return ref
  end
  local root = M.root(0)
  local rel = M.relative(root, abs)
  if rel then
    return rel
  end
  local ref = vim.fn.expand("%:.")
  if vim.fn.has("win32") == 1 then
    return (ref:gsub("\\", "/"))
  end
  return ref
end

return M
