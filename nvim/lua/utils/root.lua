local M = {}

local markers = {
  ".git",
  "Cargo.toml",
  "Makefile",
  ".project_root",
  "pyproject.toml",
  ".stylua.toml",
  "go.mod",
}

function M.get()
  local ok, proj = pcall(require, "project_nvim.project")
  if ok then
    local root = proj.get_project_root()
    if root and root ~= "" then
      return root
    end
  end

  local buf_path = vim.api.nvim_buf_get_name(0)
  if buf_path ~= "" then
    local root = vim.fs.root(buf_path, markers)
    if root then
      return root
    end
  end

  return vim.uv.cwd()
end

return M
