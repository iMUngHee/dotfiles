# Neovim Config

Requires **Neovim 0.11+** (uses `vim.lsp.config()`, `after/lsp/` native config pattern).

## Bootstrap

This config lives inside a dotfiles repo rooted at `~/.config`.

```bash
# Fresh machine (no ~/.config yet)
git clone <repo> ~/.config

# Existing ~/.config — clone to temp and merge
git clone <repo> /tmp/dotfiles
cp -r /tmp/dotfiles/nvim ~/.config/nvim

# Launch nvim — lazy.nvim auto-bootstraps on first run
nvim
# Then run :Lazy sync to install plugins at pinned versions (lazy-lock.json)
```

Plugins, LSP servers (`mason-lspconfig`), and formatters/linters (`mason-tool-installer`) install automatically on first launch.

## System Dependencies

Must be installed **before** first launch. Mason and plugins cannot provide these.

| Dependency | Required by | Install |
|---|---|---|
| git | lazy.nvim bootstrap, gitsigns, diffview | (system) |
| C compiler (gcc/clang) | treesitter parser compilation, telescope-fzf-native | `xcode-select --install` (macOS) / `apt install build-essential` (Linux) |
| make | telescope-fzf-native (`build = "make"`) | (bundled with above) |
| Node.js + npm | prettierd, eslint_d, cspell_ls, typescript-tools.nvim | `brew install node` / [nvm](https://github.com/nvm-sh/nvm) |
| Python 3 + pip | beautysh, nginx_language_server (mason installs via pip) | `brew install python` / `apt install python3 python3-pip` |
| [ripgrep](https://github.com/BurntSushi/ripgrep) (rg) | telescope live_grep, todo-comments search | `brew install ripgrep` / `apt install ripgrep` |
| [fd](https://github.com/sharkdp/fd) (optional) | telescope find_files (faster alternative to `find`) | `brew install fd` / `apt install fd-find` |
| [Nerd Font](https://www.nerdfonts.com/) | icons (devicons, bufferline, neo-tree, lualine, etc.) | e.g. `brew install --cask font-fira-code-nerd-font` |

### Linux-only

| Dependency | Required by | Install |
|---|---|---|
| `xclip` or `xsel` (X11) / `wl-clipboard` (Wayland) | `clipboard = "unnamedplus"` (system clipboard yank/paste) | `apt install xclip` / `apt install wl-clipboard` |
| `trash-cli` | oil.nvim `delete_to_trash = true` | `apt install trash-cli` (provides `trash-put`) |

On macOS, clipboard works via `pbcopy`/`pbpaste` (built-in) and oil.nvim uses the system trash API.

## Language-Specific Dependencies

Only needed if you work with that language. Without them the corresponding LSP/formatter silently skips.

### Java / Kotlin / Groovy

**JDK 17 or later** required. Mason installs the LSP binaries (jdtls, groovyls, kotlin_lsp) but they need a JVM to run.

```bash
# macOS
brew install openjdk@21          # or any version >= 17

# Linux
sudo apt install openjdk-21-jdk  # or any version >= 17
```

`palantir-java-format` (conform.nvim formatter for Java) is **not** managed by mason.
It ships as a fat JAR; a native binary can be built with GraalVM for faster startup.

```bash
# Option 1: JAR (requires JDK at runtime)
#   Download from https://github.com/palantir/palantir-java-format/releases
#   Place the jar somewhere persistent and create a wrapper script:
mkdir -p ~/.local/share/palantir-java-format
curl -Lo ~/.local/share/palantir-java-format/palantir-java-format.jar \
  "https://github.com/palantir/palantir-java-format/releases/latest/download/palantir-java-format.jar"

cat > ~/.local/bin/palantir-java-format << 'EOF'
#!/bin/sh
exec java -jar ~/.local/share/palantir-java-format/palantir-java-format.jar "$@"
EOF
chmod +x ~/.local/bin/palantir-java-format

# Option 2: Native binary via GraalVM (no JDK needed at runtime, ~10x faster)
#   Requires GraalVM JDK with native-image:
#     brew install --cask graalvm-jdk   # macOS
#     gu install native-image            # or: sdk install java 21.0.2-graal
native-image -jar palantir-java-format.jar palantir-java-format
mv palantir-java-format ~/.local/bin/
```

Ensure `~/.local/bin` is in your `PATH`.

### Rust

`rust_analyzer` is mason-managed, but `rustfmt` (conform.nvim formatter) ships with the Rust toolchain:

```bash
# Install Rust toolchain (includes rust_analyzer source, rustfmt)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup component add rustfmt
```

### Swift

Neither `sourcekit-lsp` nor `swift-format` are mason-managed:

```bash
# sourcekit-lsp (LSP server)
xcode-select --install                     # macOS (bundled with Xcode CLI tools)
# Linux: install Swift toolchain from swift.org, sourcekit-lsp must be in PATH

# swift-format (conform.nvim formatter)
brew install swift-format                   # macOS
# Linux: build from source — https://github.com/apple/swift-format
```

### Go

Go toolchain must be installed. `gopls`, `gofumpt`, `goimports` are mason-managed.

```bash
brew install go   # or https://go.dev/dl/
```

### JavaScript / TypeScript

Node.js (listed in system dependencies above) covers everything. `typescript-tools.nvim` uses the project-local `typescript` package (`node_modules`). For projects without it:

```bash
npm install -g typescript
```

## Private Config

`lua/private/` is git-ignored. See [`lua/private/README.md`](lua/private/README.md) for required local files (e.g. AI completion API keys).

## Structure

```
init.lua                  -- Entry point: loads common/, sets up lazy.nvim
lua/
  common/
    init.lua              -- lazy.nvim bootstrap, mason PATH injection
    options.lua           -- vim.opt / vim.g settings, ephemeral buffer autocmds
    mappings.lua          -- Global keymaps, LspAttach keymaps
    diagnostic.lua        -- vim.diagnostic.config()
  plugins/
    00_core.lua           -- plenary.nvim
    10_colorscheme.lua    -- catppuccin
    20_ui.lua             -- lualine, bufferline, dashboard, noice, dressing, indent, scrollview, marks, which-key, colorizer
    30_files.lua          -- neo-tree, oil, project.nvim, auto-session
    40_telescope.lua      -- telescope, fzf-native (with runtime case-sensitivity toggle)
    50_treesitter.lua     -- treesitter, treesitter-context, rainbow-delimiters
    60_lsp.lua            -- mason, mason-lspconfig, nvim-lspconfig, typescript-tools, nvim-cmp
    70_git.lua            -- gitsigns, diffview
    80_formatter.lua      -- mason-tool-installer, nvim-lint, conform.nvim
    90_misc.lua           -- trouble, todo-comments, zen-mode
    95_ai_completion.lua  -- minuet-ai (requires lua/private/ai_config.lua)
  utils/
    root.lua              -- Project root detection (project.nvim -> vim.fs.root -> cwd)
    buffer_stack.lua      -- Closed-buffer stack for bufferline reopen (<leader>bu)
  private/                -- git-ignored; local secrets (see private/README.md)
after/
  lsp/                    -- Neovim 0.11+ native per-server LSP config
    lua_ls.lua
    sourcekit.lua         -- Restricts filetypes to swift/objc (clangd handles c/cpp)
    cspell_ls.lua         -- Custom root_dir to avoid attaching to non-project buffers
    jdtls.lua             -- JDK 17+ required; lombok support, jdt:// classfile handler
queries/
  dockerfile/
    injections.scm        -- Shell injection for Dockerfile heredoc blocks
```
