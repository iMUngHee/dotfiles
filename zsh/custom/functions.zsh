#
# Utility functions for zsh
#

# --- Navigation ---

# Create directory and cd into it (oh-my-zsh has `take`, but mkcd is more intuitive)
mkcd() { mkdir -p "$1" && cd "$1" }

# Go up N directories: `up 3` → cd ../../..
up() {
	local d=""
	for ((i = 1; i <= ${1:-1}; i++)); do d="../$d"; done
	cd "$d" || return
}

# --- Display ---

# Print PATH entries one per line
path() { echo "$PATH" | tr ":" "\n" }

# 256-color terminal palette
colors() {
	for i in {0..255}; do
		printf '\e[48;5;%dm%3d ' "$i" "$i"
		(((i + 3) % 18)) || printf '\e[0m\n'
	done
	printf '\e[0m\n'
}

# --- Network ---

# List listening TCP ports
ports() { lsof -iTCP -sTCP:LISTEN -P -n }

# Show local + external IP
myip() {
	echo "Local : $(ipconfig getifaddr en0 2>/dev/null || echo 'N/A')"
	echo "Public: $(curl -s --max-time 3 ifconfig.me || echo 'N/A')"
}

# Quick local HTTP server
serve() {
	local port=${1:-8000}
	echo "Serving on http://localhost:$port"
	python3 -m http.server "$port"
}

# --- File ---

# Top 10 largest items in current directory
top-size() { du -hs * 2>/dev/null | sort -rh | head -10 }

# Quick file backup: backup foo.txt → foo.txt.2026-03-17_143022.bak
backup() {
	[[ -z "$1" ]] && echo "Usage: backup <file>" && return 1
	cp -a "$1" "${1}.$(date +%Y-%m-%d_%H%M%S).bak"
}

# Pretty-print JSON from file or stdin
json() {
	if [[ -n "$1" ]]; then
		python3 -m json.tool "$1"
	else
		python3 -m json.tool
	fi
}

# --- Git ---

# Undo last commit, keep changes staged
git-undo() { git reset --soft HEAD~1 }

# Show concise git log graph
git-graph() { git log --oneline --graph --decorate --all -20 }

# --- Meta ---

# List all custom functions with descriptions
fls() {
	local src="${ZDOTDIR:-$HOME/.config/zsh}/custom/functions.zsh"
	awk '
		/^# ---/ { next }
		/^#/     { desc = substr($0, 3) }
		/^[a-zA-Z_-]+\(\)/ {
			name = $1; gsub(/\(.*/, "", name)
			if (desc != "") printf "  \033[36m%-12s\033[0m %s\n", name, desc
			desc = ""
		}
		/^$/ { desc = "" }
	' "$src"
}
