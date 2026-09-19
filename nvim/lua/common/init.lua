-- Bootstrap lazy.nvim
local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"

if not vim.uv.fs_stat(lazypath) then
  vim.fn.system({
    "git",
    "clone",
    "--filter=blob:none",
    "https://github.com/folke/lazy.nvim.git",
    "--branch=stable",
    lazypath,
  })
end

vim.opt.rtp:prepend(lazypath)

-- Ensure mason-installed binaries are in PATH before plugin load.
-- conform.nvim / nvim-lint use vim.fn.executable() which checks vim.env.PATH.
local mason_bin = vim.fn.stdpath("data") .. "/mason/bin"
vim.env.PATH = mason_bin .. ":" .. (vim.env.PATH or "")

-- Point mason's source builds at a Gradle-compatible JDK.
-- groovy-language-server is built by mason with the project's own ./gradlew
-- (Gradle 9.1.0), and Gradle refuses a JDK it does not recognise. On a system
-- defaulting to Java 26 that build fails before compiling anything:
--     BUG! exception in phase 'semantic analysis' ...
--     Unsupported class file major version 70
-- The prebuilt servers are unaffected either way -- jdtls and kotlin-lsp are
-- downloads rather than builds -- and both want Java 21 or newer, so 21 serves
-- them too.
--
-- Scoped to this process deliberately: the system default is left to
-- archlinux-java, so no JVM work outside nvim changes. Applied only when
-- JAVA_HOME is unset and the directory exists, so a machine without these JDKs
-- keeps its default toolchain and this is a no-op.
if not vim.env.JAVA_HOME or vim.env.JAVA_HOME == "" then
  for _, home in ipairs({
    "/usr/lib/jvm/java-21-openjdk",
    "/usr/lib/jvm/java-25-openjdk",
  }) do
    if vim.uv.fs_stat(home) then
      vim.env.JAVA_HOME = home
      break
    end
  end
end

------------------------------

require("common.options")
require("common.mappings")
require("common.diagnostic")