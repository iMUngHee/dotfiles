--[[
--
--  Neovim Mappings
--  Ref: https://neovim.io/doc/user/usr_40.html#40.1
--  
--]]

local g = vim.g
local keymap = vim.keymap

g.mapleader = " "
g.maplocalleader = " "

-- Remove Neovim 0.11 default LSP mappings; replaced by LspAttach keymaps below
for _, key in ipairs({ "grn", "gra", "grr", "gri", "grt", "grx" }) do
  pcall(vim.keymap.del, "n", key)
end

-- Clear highlights
keymap.set("n", "<ESC>", "<cmd> noh <CR>", { desc = "Clear highlights" })

-- Navigate within insert mode
keymap.set("i", "<C-h>", "<Left>", { desc = "Move Left" })
keymap.set("i", "<C-l>", "<Right>", { desc = "Move Right" })
keymap.set("i", "<C-j>", "<Down>", { desc = "Move Down" })
keymap.set("i", "<C-k>", "<Up>", { desc = "Move Up" })

-- Keep selection after indent
keymap.set("v", "<", "<gv", { desc = "Indent left" })
keymap.set("v", ">", ">gv", { desc = "Indent right" })

-- Override gx: open local files in buffer, URLs in browser
keymap.set("n", "gx", function()
  local urls = require("vim.ui")._get_urls()
  for _, url in ipairs(urls) do
    if url:match("^https?://") then
      local cmd, err = vim.ui.open(url)
      if cmd then
        cmd:wait(1000)
      end
      if err then
        vim.notify(err, vim.log.levels.ERROR)
      end
    else
      local buf_dir = vim.fn.expand("%:p:h")
      local abs = url:match("^/") and url or vim.fs.normalize(buf_dir .. "/" .. url)
      if vim.uv.fs_stat(abs) then
        vim.cmd.edit(vim.fn.fnameescape(abs))
      else
        vim.notify("File not found: " .. abs, vim.log.levels.WARN)
      end
    end
  end
end, { desc = "Open file in buffer or URL in browser" })

vim.api.nvim_create_autocmd("LspAttach", {
  group = vim.api.nvim_create_augroup("UserLspConfig", { clear = true }),
  callback = function(ev)
    local opts = { buffer = ev.buf, silent = true }

    keymap.set("n", "gd", vim.lsp.buf.definition, vim.tbl_extend("force", opts, { desc = "Go to Definition" }))
    keymap.set("n", "gD", vim.lsp.buf.declaration, vim.tbl_extend("force", opts, { desc = "Go to Declaration" }))
    keymap.set("n", "gr", function()
      require("telescope.builtin").lsp_references()
    end, vim.tbl_extend("force", opts, { desc = "Go to References" }))
    keymap.set("n", "gI", vim.lsp.buf.implementation, vim.tbl_extend("force", opts, { desc = "Go to Implementation" }))
    keymap.set("n", "K", vim.lsp.buf.hover, vim.tbl_extend("force", opts, { desc = "Hover Documentation" }))
    keymap.set("n", "<C-k>", vim.lsp.buf.signature_help, vim.tbl_extend("force", opts, { desc = "Signature Help" }))
    keymap.set("n", "<leader>rn", vim.lsp.buf.rename, vim.tbl_extend("force", opts, { desc = "Rename Symbol" }))
    keymap.set(
      { "n", "v" },
      "<leader>ca",
      vim.lsp.buf.code_action,
      vim.tbl_extend("force", opts, { desc = "Code Action" })
    )
    keymap.set("n", "]d", function()
      vim.diagnostic.jump({ count = 1, float = true })
    end, vim.tbl_extend("force", opts, { desc = "Next Diagnostic" }))
    keymap.set("n", "[d", function()
      vim.diagnostic.jump({ count = -1, float = true })
    end, vim.tbl_extend("force", opts, { desc = "Prev Diagnostic" }))
    keymap.set("n", "gl", vim.diagnostic.open_float, vim.tbl_extend("force", opts, { desc = "Show Line Diagnostics" }))
    keymap.set("n", "gy", vim.lsp.buf.type_definition, vim.tbl_extend("force", opts, { desc = "Go to Type Definition" }))
    keymap.set("n", "<leader>cx", vim.lsp.codelens.run, vim.tbl_extend("force", opts, { desc = "Run CodeLens" }))
  end,
})

-- Copy file reference for AI tools (<leader>l = project root, <leader>L = home)
local function file_ref_path(scope)
  local abs = vim.fn.expand("%:p")
  if abs == "" or vim.bo.buftype ~= "" then
    return nil
  end
  if scope == "home" then
    return vim.fn.fnamemodify(abs, ":~")
  end
  local root = vim.fs.root(0, ".git") or vim.fn.getcwd()
  local resolved = vim.fn.resolve(abs)
  if resolved:sub(1, #root) == root then
    return resolved:sub(#root + 2)
  end
  return vim.fn.expand("%:.")
end

local function copy_file_ref(scope)
  local path = file_ref_path(scope)
  if not path then
    vim.notify("No file path", vim.log.levels.WARN)
    return
  end
  vim.fn.setreg("+", "@" .. path)
  vim.notify("Copied: @" .. path)
end

local function copy_file_ref_lines(scope)
  local path = file_ref_path(scope)
  if not path then
    vim.notify("No file path", vim.log.levels.WARN)
    return
  end
  local s = vim.fn.line("v")
  local e = vim.fn.line(".")
  if s > e then
    s, e = e, s
  end
  local ref = (s == e) and ("@" .. path .. "#L" .. s) or ("@" .. path .. "#L" .. s .. "-" .. e)
  vim.fn.setreg("+", ref)
  vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes("<Esc>", true, false, true), "nx", false)
  vim.notify("Copied: " .. ref)
end

keymap.set("n", "<leader>l", function() copy_file_ref("project") end, { desc = "Copy file ref (project root) to clipboard" })
keymap.set("x", "<leader>l", function() copy_file_ref_lines("project") end, { desc = "Copy file ref (project root) with lines to clipboard" })
keymap.set("n", "<leader>L", function() copy_file_ref("home") end, { desc = "Copy file ref (home) to clipboard" })
keymap.set("x", "<leader>L", function() copy_file_ref_lines("home") end, { desc = "Copy file ref (home) with lines to clipboard" })
