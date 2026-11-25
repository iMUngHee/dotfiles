#!/usr/bin/env bash
# Install as scripts/check-layers.sh. Compares a repository's production
# dependencies with the layer policy in scripts/check-data/layers.tsv.
#
#   scripts/check-layers.sh --doc <ARCHITECTURE path> -- <extractor command...>
#
# The extractor prints one `from<TAB>to` line per production dependency:
# internal files as canonical repository-relative paths, external dependencies
# as ext:<name>. The rows and outcomes are described in check-contract.md
# ("Layer policy"). Written for the bash 3.2 that macOS ships.
set -uo pipefail

policy=scripts/check-data/layers.tsv
doc=
while [ $# -gt 0 ]; do
	case $1 in
	--doc) doc=${2:-}; shift 2 ;;
	--) shift; break ;;
	*) echo "check-layers: unknown argument $1" >&2; exit 2 ;;
	esac
done
if [ -z "$doc" ] || [ $# -eq 0 ]; then
	echo "usage: scripts/check-layers.sh --doc <ARCHITECTURE path> -- <extractor command...>" >&2
	exit 2
fi
if [ ! -f "$policy" ]; then
	echo "check-layers: $policy is missing; $doc describes the layers it should hold"
	exit 1
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

status=0
"$@" >"$tmp/edges" || status=$?
if [ "$status" -ne 0 ]; then
	echo "check-layers: the extractor exited with status $status: $*"
	exit 1
fi

# The same base as the gate's ratchet: CHECK_BASE, else the merge-base with the
# default branch.
resolve_base() {
	local ref
	if [ -n "${CHECK_BASE:-}" ]; then
		git rev-parse --verify -q "$CHECK_BASE^{commit}"
		return
	fi
	for ref in refs/remotes/origin/HEAD refs/heads/main refs/heads/master; do
		if git rev-parse --verify -q "$ref^{commit}" >/dev/null; then
			git merge-base HEAD "$ref"
			return
		fi
	done
	return 1
}
if ! base=$(resolve_base); then
	echo "check-layers: no base commit to compare debt with; set CHECK_BASE to the commit before your changes"
	exit 1
fi
first=0
if git cat-file -e "$base:$policy" 2>/dev/null; then
	if ! git show "$base:$policy" >"$tmp/base"; then
		echo "check-layers: cannot read $policy at $base"
		exit 1
	fi
elif git cat-file -e "$base^{tree}" 2>/dev/null && [ -z "$(git ls-tree "$base" -- "$policy")" ]; then
	first=1
	: >"$tmp/base"
else
	echo "check-layers: cannot tell whether $policy existed at $base; fetch that commit or set CHECK_BASE"
	exit 1
fi

awk -F'\t' -v doc="$doc" -v first="$first" -v policy="$policy" \
	-v bfile="$tmp/base" -v efile="$tmp/edges" '
	function canonical(p) {
		return p != "" && p !~ /^\// && p !~ /\/$/ && p !~ /\/\// && p !~ /(^|\/)\.\.?(\/|$)/
	}
	function g2r(g,   r, i, c) {
		r = "^"
		for (i = 1; i <= length(g); i++) {
			c = substr(g, i, 1)
			if (c == "*") r = r ".*"
			else if (c == "?") r = r "."
			else if (index("\\^$.[]|()+{}", c)) r = r "\\" c
			else r = r c
		}
		return r "$"
	}
	function fail(msg) { print "check-layers: " msg; bad = 1 }
	function validate_allow(   k, parts) {
		checked = 1
		for (k in allow) {
			split(k, parts, SUBSEP)
			if (!(parts[1] in re) || !(parts[2] in re)) fail(policy ":" allow[k] ": allow names an unknown layer")
		}
	}
	function layer_of(p,   name, hits, found) {
		hits = 0
		for (name in re) if (p ~ re[name]) { hits++; found = name }
		if (hits == 0) { fail(p " belongs to no layer; add it to a layer row in " policy); return "" }
		if (hits > 1) { fail(p " matches more than one layer in " policy); return "" }
		return found
	}
	function allowed_from(l,   k, s, parts) {
		s = ""
		for (k in allow) { split(k, parts, SUBSEP); if (parts[1] == l) s = s (s == "" ? "" : ", ") parts[2] }
		return s == "" ? "none" : s
	}
	{ sub(/\r$/, "") }
	FILENAME == bfile {
		if ($1 == "debt" && NF == 3) basedebt[$2 SUBSEP $3] = 1
		next
	}
	FILENAME == policy {
		if ($0 ~ /^#/ || $0 ~ /^[ \t]*$/) next
		if ($1 == "layer" && NF == 3 && $2 != "" && $3 != "") {
			n = split($3, globs, ",")
			for (i = 1; i <= n; i++) re[$2] = (re[$2] == "" ? "" : re[$2] "|") "(" g2r(globs[i]) ")"
		} else if ($1 == "allow" && NF == 3 && $2 != "" && $3 != "") {
			allow[$2 SUBSEP $3] = FNR
		} else if ($1 == "debt" && NF == 3 && canonical($2) && canonical($3)) {
			debt[$2 SUBSEP $3] = FNR
		} else if ($1 == "empty-ok" && NF == 1) {
			emptyok = 1
		} else {
			fail(policy ":" FNR ": not a layer, allow, debt or empty-ok row: " $0)
		}
		next
	}
	FILENAME == efile {
		if (!checked) validate_allow()
		if ($0 ~ /^[ \t]*$/) next
		if (NF != 2) { fail("extractor line " FNR " is not from<TAB>to: " $0); next }
		ext = 0; lf = lt = ""
		for (i = 1; i <= 2; i++) {
			if ($i ~ /^ext:./) { ext = 1; continue }
			if (!canonical($i)) { fail("extractor line " FNR ": " $i " is not a canonical repository path"); ext = 1; continue }
			if (i == 1) lf = layer_of($i); else lt = layer_of($i)
		}
		if (ext || lf == "" || lt == "") next
		internal++
		if (lf == lt || (lf SUBSEP lt) in allow) next
		forbidden[$1 SUBSEP $2] = 1
		if (!(($1 SUBSEP $2) in debt))
			fail($1 " (" lf ") depends on " $2 " (" lt "); " lf " may depend on: " allowed_from(lf) ". The layers are described in " doc)
	}
	END {
		if (!checked) validate_allow()
		for (k in debt) {
			split(k, parts, SUBSEP)
			if (!(k in forbidden)) fail(policy ":" debt[k] ": the debt " parts[1] " -> " parts[2] " is resolved (gone or now allowed); delete the row")
			else if (!first && !(k in basedebt)) fail(policy ":" debt[k] ": debt grew; " parts[1] " -> " parts[2] " is new since the base commit, so fix the dependency instead")
		}
		if (internal == 0 && !emptyok) fail("the extractor reported no dependency between internal files; add empty-ok to " policy " if that is expected")
		exit bad
	}
' "$tmp/base" "$policy" "$tmp/edges"
