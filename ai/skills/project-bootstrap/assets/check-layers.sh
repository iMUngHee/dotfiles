#!/usr/bin/env bash
# Install as scripts/check-layers.sh. Compares a repository's production
# dependencies with the layer policy in scripts/check-data/layers.tsv.
#
#   scripts/check-layers.sh --doc <ARCHITECTURE path> -- <extractor command...>
#
# The extractor prints one `from<TAB>to` line per production dependency, and
# each production file without one alone on its line: internal files as
# canonical repository-relative paths, external dependencies as ext:<name>.
# The rows and outcomes are described in check-contract.md ("Layer policy").
# Debt is compared with the same base as scripts/check.sh.
# Written for the bash 3.2 that macOS ships.
set -uo pipefail

usage() {
	echo "usage: scripts/check-layers.sh --doc <ARCHITECTURE path> -- <extractor command...>" >&2
	exit 2
}
policy=scripts/check-data/layers.tsv
doc=
while [ $# -gt 0 ]; do
	case $1 in
	--doc)
		[ $# -ge 2 ] || usage
		doc=$2
		shift 2
		;;
	--) shift; break ;;
	*) usage ;;
	esac
done
if [ -z "$doc" ] || [ $# -eq 0 ]; then usage; fi
if [ ! -f "$policy" ]; then
	echo "check-layers: $policy is missing; $doc describes the layers it should hold"
	exit 1
fi

if ! tmp=$(mktemp -d) || [ -z "$tmp" ]; then
	echo "check-layers: cannot create a temporary directory; the layers are described in $doc"
	exit 1
fi
trap 'rm -rf "$tmp"' EXIT

status=0
"$@" >"$tmp/edges" || status=$?
if [ "$status" -ne 0 ]; then
	echo "check-layers: the extractor exited with status $status: $*; the layers are described in $doc"
	exit 1
fi
# awk stops reading a record at a NUL byte, so reject it before parsing.
if [ "$(tr -d '\000' <"$tmp/edges" | wc -c)" -ne "$(wc -c <"$tmp/edges")" ]; then
	echo "check-layers: the extractor output holds a NUL byte; the layers are described in $doc"
	exit 1
fi

# True when HEAD is detached or is the branch the default ref $1 names.
on_default_branch() {
	local branch name
	branch=$(git symbolic-ref -q HEAD) || return 0
	case $1 in
	refs/remotes/origin/HEAD)
		name=$(git symbolic-ref -q "$1") || return 1
		name=${name#refs/remotes/origin/}
		;;
	*) name=${1#refs/heads/} ;;
	esac
	[ "$branch" = "refs/heads/$name" ]
}

# Prints the commit that ratchet baselines and layer debt are compared
# against, or "root" when HEAD is the first commit; diagnostics go to stderr.
resolve_base() {
	local ref found='' head mb header parent
	if [ -n "${CHECK_BASE:-}" ]; then
		if ! git rev-parse --verify -q "$CHECK_BASE^{commit}"; then
			echo "CHECK_BASE=$CHECK_BASE is not a commit" >&2
			return 1
		fi
		return 0
	fi
	for ref in refs/remotes/origin/HEAD refs/heads/main refs/heads/master; do
		if git rev-parse --verify -q "$ref^{commit}" >/dev/null; then
			found=$ref
			break
		fi
	done
	if [ -z "$found" ]; then
		echo "no origin/HEAD, main or master to take a base from; set CHECK_BASE to the commit before your changes" >&2
		return 1
	fi
	head=$(git rev-parse HEAD)
	if ! mb=$(git merge-base HEAD "$found"); then
		echo "HEAD shares no history with $found; set CHECK_BASE to the commit before your changes" >&2
		return 1
	fi
	# A branch with no commits of its own changes only the working tree, so
	# HEAD is its base. On the default branch itself the last commit is the
	# change: compare with its first parent, read from the commit header so a
	# shallow boundary is not mistaken for the first commit.
	if [ "$mb" != "$head" ] || ! on_default_branch "$found"; then
		echo "$mb"
		return 0
	fi
	if ! header=$(git cat-file commit "$head"); then
		echo "cannot read the commit HEAD ($head); set CHECK_BASE to the commit before your changes" >&2
		return 1
	fi
	parent=$(awk '/^$/ { body = 1 } !body && !p && /^parent / { p = $2 } END { print p }' <<<"$header")
	if [ -z "$parent" ]; then
		echo root
	elif git cat-file -e "$parent^{commit}" 2>/dev/null; then
		echo "$parent"
	else
		echo "cannot read $parent, the parent of HEAD (a shallow clone?); fetch more history or set CHECK_BASE to the commit before your changes" >&2
		return 1
	fi
}
# End of the base resolver, kept identical in check.sh and check-layers.sh.

# The gate passes the base it resolved for its run; run alone, resolve it here,
# with a CHECK_BASE that scripts/check-config.sh sets, as the gate would.
why=
if [ -z "${CHECK_RESOLVED_BASE+set}" ] && [ -z "${CHECK_BASE:-}" ] && [ -f scripts/check-config.sh ]; then
	# shellcheck source=/dev/null
	CHECK_BASE=$(. scripts/check-config.sh >&2 && printf '%s' "${CHECK_BASE:-}")
fi
if [ -n "${CHECK_RESOLVED_BASE+set}" ]; then
	base=$CHECK_RESOLVED_BASE
	why=${CHECK_BASE_ERROR:-}
elif ! base=$(resolve_base 2>"$tmp/base-error"); then
	base=
	why=$(cat "$tmp/base-error")
fi
if [ -z "$base" ]; then
	echo "check-layers: no base commit to compare debt with: ${why:-set CHECK_BASE to the commit before your changes}; the layers are described in $doc"
	exit 1
fi
# Only a successful listing that is empty proves the policy absent at the base;
# any read error fails instead of opening a first adoption. The first commit
# adopts its policy.
first=0
if [ "$base" = root ]; then
	first=1
	: >"$tmp/base"
elif ! entry=$(git ls-tree "$base" -- "$policy"); then
	echo "check-layers: cannot read $policy at $base; fetch that commit or set CHECK_BASE; the layers are described in $doc"
	exit 1
elif [ -z "$entry" ]; then
	first=1
	: >"$tmp/base"
elif ! git show "$base:$policy" >"$tmp/base"; then
	echo "check-layers: cannot read $policy at $base; fetch that commit or set CHECK_BASE; the layers are described in $doc"
	exit 1
fi

# Values go through the environment, where awk does not decode backslash
# escapes as it does for -v.
CL_DOC=$doc CL_FIRST=$first CL_POLICY=$policy CL_BFILE=$tmp/base CL_EFILE=$tmp/edges awk -F'\t' '
	BEGIN { doc = ENVIRON["CL_DOC"]; first = ENVIRON["CL_FIRST"]; policy = ENVIRON["CL_POLICY"]; bfile = ENVIRON["CL_BFILE"]; efile = ENVIRON["CL_EFILE"] }
	# A canonical repository path: relative, no empty, . or .. segment, no
	# control character (so no endpoint can contain SUBSEP), not an ext: name.
	function canonical(p) {
		return p != "" && p !~ /^\// && p !~ /\/$/ && p !~ /\/\// && p !~ /(^|\/)\.\.?(\/|$)/ && p !~ /[\001-\037\177]/ && p !~ /^ext:/
	}
	function external(p) { return p ~ /^ext:[^\001-\037\177]+$/ }
	# The supported glob subset: *, ? and [...] or [!...] without classes or escapes.
	function glob_ok(g) { return g !~ /\\|\[:|\[[^]]*$|\[!?\]|\[[^]]*\[/ }
	function name_ok(n) { return n ~ /^[A-Za-z0-9_.-]+$/ }
	# A supported glob as a regular expression: * and ? also match /, and
	# [...] or [!...] is a character class.
	function g2r(g,   r, i, c, j) {
		r = "^"
		for (i = 1; i <= length(g); i++) {
			c = substr(g, i, 1)
			if (c == "*") r = r ".*"
			else if (c == "?") r = r "."
			else if (c == "[" && (j = index(substr(g, i + 1), "]")) > 1) {
				c = substr(g, i + 1, j - 1)
				if (substr(c, 1, 1) == "!") c = "^" substr(c, 2)
				r = r "[" c "]"
				i += j
			} else if (index("\\^$.[]|()+{}", c)) r = r "\\" c
			else r = r c
		}
		return r "$"
	}
	function fail(msg) { print "check-layers: " msg; bad = 1 }
	function layer_of(p,   name, hits, found) {
		hits = 0
		for (name in re) if (p ~ re[name]) { hits++; found = name }
		if (hits == 0) fail(p " belongs to no layer; add it to a layer row in " policy " (layers are described in " doc ")")
		if (hits > 1) fail(p " matches more than one layer in " policy " (layers are described in " doc ")")
		return hits == 1 ? found : ""
	}
	function allowed_from(l,   k, s, parts) {
		s = ""
		for (k in allow) { split(k, parts, SUBSEP); if (parts[1] == l) s = s (s == "" ? "" : ", ") parts[2] }
		return s == "" ? "none" : s
	}
	function layer_row(name, list,   n, globs, i) {
		if (!name_ok(name) || list == "") return 0
		n = split(list, globs, ",")
		for (i = 1; i <= n; i++) {
			if (globs[i] == "" || !glob_ok(globs[i])) return 0
			re[name] = (re[name] == "" ? "" : re[name] "|") "(" g2r(globs[i]) ")"
		}
		return 1
	}
	{ sub(/\r$/, "") }
	FILENAME == bfile {
		if ($1 == "debt" && NF == 3) basedebt[$2 SUBSEP $3] = 1
		next
	}
	FILENAME == policy {
		if ($0 ~ /^#/ || $0 ~ /^[ \t]*$/) next
		if ($1 == "layer" && NF == 3 && layer_row($2, $3)) next
		if ($1 == "allow" && NF == 3 && name_ok($2) && name_ok($3)) { allow[$2 SUBSEP $3] = FNR; next }
		if ($1 == "debt" && NF == 3 && canonical($2) && canonical($3)) {
			if (($2 SUBSEP $3) in debt) fail(policy ":" FNR ": repeats the debt row on line " debt[$2 SUBSEP $3])
			else debt[$2 SUBSEP $3] = FNR
			next
		}
		if ($1 == "empty-ok" && NF == 1) { emptyok = 1; next }
		fail(policy ":" FNR ": not a layer, allow, debt or empty-ok row (globs take only *, ? and [...]): " $0)
		next
	}
	FILENAME == efile {
		if ($0 == "") next
		# A file with no dependencies is listed alone, so it is still classified.
		if (NF == 1) {
			if (canonical($1)) { lone++; alone[lone] = $1 }
			else fail("extractor line " FNR ": \"" $1 "\" is not a canonical repository path")
			next
		}
		if (NF != 2) { fail("extractor line " FNR " is not from<TAB>to: " $0); next }
		for (i = 1; i <= 2; i++)
			if (!external($i) && !canonical($i)) fail("extractor line " FNR ": \"" $i "\" is neither ext:<name> nor a canonical repository path")
		edges++; from[edges] = $1; to[edges] = $2
	}
	END {
		for (k in allow) {
			split(k, parts, SUBSEP)
			if (!(parts[1] in re) || !(parts[2] in re)) fail(policy ":" allow[k] ": allow names an unknown layer")
		}
		# Classify only input that passed validation.
		if (bad) { print "check-layers: the layers and their policy are described in " doc; exit 1 }
		for (e = 1; e <= lone; e++) layer_of(alone[e])
		for (e = 1; e <= edges; e++) {
			lf = lt = ""
			if (!external(from[e])) lf = layer_of(from[e])
			if (!external(to[e])) lt = layer_of(to[e])
			if (external(from[e]) || external(to[e]) || lf == "" || lt == "") continue
			internal++
			if (lf == lt || (lf SUBSEP lt) in allow) continue
			forbidden[from[e] SUBSEP to[e]] = 1
			if (!((from[e] SUBSEP to[e]) in debt))
				fail(from[e] " (" lf ") depends on " to[e] " (" lt "); " lf " may depend on: " allowed_from(lf) ". The layers are described in " doc)
		}
		for (k in debt) {
			split(k, parts, SUBSEP)
			if (!(k in forbidden)) fail(policy ":" debt[k] ": the debt " parts[1] " -> " parts[2] " is resolved (gone or now allowed); delete the row")
			else if (!first && !(k in basedebt)) fail(policy ":" debt[k] ": debt grew; " parts[1] " -> " parts[2] " is new since the base commit, so fix the dependency instead")
		}
		if (internal == 0 && !emptyok) fail("the extractor reported no dependency between internal files; add empty-ok to " policy " if that is expected")
		if (bad) print "check-layers: the layers and their policy are described in " doc
		exit bad
	}
' "$tmp/base" "$policy" "$tmp/edges"
