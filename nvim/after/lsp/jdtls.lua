local lombok_jar = vim.fn.stdpath("data") .. "/mason/packages/jdtls/lombok.jar"

local root_only = { "settings.gradle.kts", "settings.gradle", "gradlew", "mvnw" }
local fallback = { "pom.xml", "build.gradle.kts", "build.gradle", ".git" }

vim.api.nvim_create_autocmd("BufReadCmd", {
  group = vim.api.nvim_create_augroup("JdtlsClassFile", { clear = true }),
  pattern = "jdt://*",
  callback = function(ev)
    local uri = vim.api.nvim_buf_get_name(ev.buf)
    local clients = vim.lsp.get_clients({ name = "jdtls" })
    if #clients == 0 then
      return
    end

    local resp = clients[1]:request_sync("java/classFileContents", { uri = uri }, 5000)
    if resp and resp.result then
      vim.bo[ev.buf].modifiable = true
      vim.api.nvim_buf_set_lines(ev.buf, 0, -1, false, vim.split(resp.result, "\n", { trimempty = true }))
      vim.bo[ev.buf].filetype = "java"
      vim.bo[ev.buf].modifiable = false
      vim.bo[ev.buf].buftype = "nofile"
      vim.bo[ev.buf].buflisted = false
    end
  end,
})

---@type vim.lsp.Config
return {
  cmd = {
    "jdtls",
    "--jvm-arg=-javaagent:" .. lombok_jar,
  },
  root_dir = function(bufnr, on_dir)
    local name = vim.api.nvim_buf_get_name(bufnr)
    if name == "" then
      return
    end

    local root = vim.fs.root(name, root_only) or vim.fs.root(name, fallback)
    on_dir(root or vim.uv.cwd() or "")
  end,
  settings = {
    java = {
      signatureHelp = { enabled = true },
      eclipse = { downloadSources = true },
      maven = { downloadSources = true },
      completion = {
        favoriteStaticMembers = {
          "org.junit.Assert.*",
          "org.junit.jupiter.api.Assertions.*",
          "org.mockito.Mockito.*",
          "java.util.Objects.requireNonNull",
          "java.util.Objects.requireNonNullElse",
        },
      },
      sources = {
        organizeImports = {
          starThreshold = 9999,
          staticStarThreshold = 9999,
        },
      },
    },
  },
}
