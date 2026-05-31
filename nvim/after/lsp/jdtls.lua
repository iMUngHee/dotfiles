local lombok_jar = vim.fn.stdpath("data") .. "/mason/packages/jdtls/lombok.jar"

local root_only = { "settings.gradle.kts", "settings.gradle", "gradlew", "mvnw" }
local fallback = { "pom.xml", "build.gradle.kts", "build.gradle", ".git" }

-- Discover every JDK installed under standard macOS/Linux locations so jdtls
-- attaches each `lib/src.zip` and can navigate stdlib types (Consumer, List, ...).
-- The highest-version JDK is marked default.
local function detect_runtimes()
  local homes = {}
  local globs = {
    "/Library/Java/JavaVirtualMachines/*/Contents/Home",
    vim.fn.expand("~/Library/Java/JavaVirtualMachines/*/Contents/Home"),
    "/usr/lib/jvm/*",
  }
  for _, g in ipairs(globs) do
    for _, h in ipairs(vim.fn.glob(g, false, true)) do
      homes[h] = true
    end
  end

  local list = {}
  for home in pairs(homes) do
    local f = io.open(home .. "/release", "r")
    if f then
      local major = (f:read("*a") or ""):match('JAVA_VERSION="(%d+)')
      f:close()
      if major then
        major = tonumber(major)
        local name = major <= 8 and ("JavaSE-1." .. major) or ("JavaSE-" .. major)
        table.insert(list, { name = name, path = home, _major = major })
      end
    end
  end

  table.sort(list, function(a, b)
    return a._major > b._major
  end)
  if list[1] then
    list[1].default = true
  end
  for _, r in ipairs(list) do
    r._major = nil
  end
  return #list > 0 and list or nil
end

local runtimes = detect_runtimes()

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
  -- jdtls only emits `jdt://` URIs for binary/library classes (JDK stdlib, dependency jars)
  -- when the client opts in via this extended capability. Without it, definition responses
  -- for those targets come back as an empty array and the editor reports "No locations found".
  init_options = {
    extendedClientCapabilities = {
      classFileContentsSupport = true,
    },
  },
  -- eclipse.jdt.ls sends malformed `{id, jsonrpc}` (no result/error) for textDocument/typeDefinition.
  -- Swallow only that noise; surface every other error normally.
  on_error = function(code, err)
    if code == vim.lsp.client_errors.INVALID_SERVER_MESSAGE then
      return
    end
    vim.notify(
      ("LSP[jdtls] %s: %s"):format(vim.lsp.client_errors[code] or code, vim.inspect(err)),
      vim.log.levels.ERROR
    )
  end,
  on_attach = function(_, bufnr)
    vim.keymap.set("n", "gy", vim.lsp.buf.definition, {
      buffer = bufnr,
      desc = "jdtls: gy → definition (typeDefinition broken upstream)",
    })
  end,
  settings = {
    java = {
      signatureHelp = { enabled = true },
      eclipse = { downloadSources = true },
      maven = { downloadSources = true },
      configuration = { runtimes = runtimes },
      contentProvider = { preferred = "fernflower" },
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
