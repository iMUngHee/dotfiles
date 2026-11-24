#!/usr/bin/env bash
# Runs every check a change must pass before it is pushed or merged.
#
#   scripts/check.sh                    full: every registered check
#   scripts/check.sh --fast             the pre-push subset
#   scripts/check.sh --passed           exit 0 when this clean HEAD already passed here
#   scripts/check.sh --list             print the registered check names and run nothing
#   scripts/check.sh --write-baselines  rewrite the ratchet baselines to the current violations
#
# The repository's own checks live in scripts/check-config.sh, which defines
# tool_versions and register_checks, so a newer copy of this file can replace
# it without losing them. Every check runs even after one fails; the summary
# lists each failure with its hint. Written for the bash 3.2 that macOS ships:
# no associative arrays, no mapfile, and no expansion of a possibly empty array.
set -euo pipefail

# git exports GIT_DIR to a hook run in a linked worktree; under it, git in
# another checkout acts on the caller's repository instead.
# shellcheck disable=SC2046 # one variable name per word
unset $(git rev-parse --local-env-vars)
cd "$(dirname "$0")/.."

mode=full
case "${1:-}" in
--fast) mode=fast ;;
--passed) mode=passed ;;
--list) mode=list ;;
--write-baselines) mode=baselines ;;
"") ;;
*)
	echo "usage: scripts/check.sh [--fast | --passed | --list | --write-baselines]" >&2
	exit 2
	;;
esac

data=scripts/check-data
patterns=$data/banned-patterns.tsv
today=${CHECK_TODAY:-$(date -u +%Y-%m-%d)}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

names=()
modes=()
hints=()
commands=()

# check <name> <fast|full> <hint> -- <command...> records a check; nothing runs yet.
check() {
	if [ $# -lt 5 ] || [ "$4" != "--" ]; then
		echo "check.sh: expected check <name> <fast|full> <hint> -- <command...>, got: $*" >&2
		exit 2
	fi
	case "$2" in
	fast | full) ;;
	*)
		echo "check.sh: the mode of $1 must be fast or full, got $2" >&2
		exit 2
		;;
	esac
	names+=("$1")
	modes+=("$2")
	hints+=("$3")
	shift 4
	commands+=("$(printf '%q ' "$@")")
}

# sha256 of stdin as 64 hex digits. GNU first, then the BSD and OpenSSL
# spellings that macOS and minimal images carry instead.
sha256() {
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum | cut -c1-64
	elif command -v shasum >/dev/null 2>&1; then
		shasum -a 256 | cut -c1-64
	else
		openssl dgst -sha256 -r | cut -c1-64
	fi
}

trim() {
	local s=$1
	s=${s#"${s%%[![:space:]]*}"}
	printf '%s' "${s%"${s##*[![:space:]]}"}"
}

# The commit ratchet baselines are compared against.
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

clean() { [ -z "$(git status --porcelain --untracked-files=normal)" ]; }

# A pass is keyed by commit (a commit message can change a ratchet verdict),
# base, tool versions and date (exceptions and deadlines expire).
pass_key() {
	{
		git rev-parse HEAD
		resolve_base 2>/dev/null || echo none
		tool_versions
		echo "$today"
	} | sha256
}
passes=$(git rev-parse --git-path check-passes)

# ── banned patterns, inline exceptions, ratchet ──

allowed() {
	local path=$1 globs=$2 glob hit=1
	[ "$globs" = - ] && return 1
	set -f # the globs are patterns for case, not for the shell
	local IFS=,
	for glob in $globs; do
		# shellcheck disable=SC2254 # glob is a pattern on purpose
		case "$path" in $glob) hit=0 ;; esac
	done
	set +f
	return "$hit"
}

# Scans every pattern. Prints each failing line, writes the ratchet hits of
# each ratchet id as "hash<TAB>path:line" to $tmp/hits.<id> and its id to
# $tmp/ratchet-ids. Returns 1 when a line fails outright.
scan_patterns() {
	local status=0 row=0 id ere allow rmode deadline reason fix path line content where re note until
	: >"$tmp/ratchet-ids"
	while IFS=$'\t' read -r id ere allow rmode deadline reason fix <&3; do
		row=$((row + 1))
		case "$id" in "" | "#"*) continue ;; esac
		if ! [[ $id =~ ^[A-Za-z0-9_-]+$ ]] || [ -z "$fix" ] ||
			! [[ $rmode =~ ^(ban|ratchet)$ ]] || ! [[ $deadline =~ ^(-|[0-9]{4}-[0-9]{2}-[0-9]{2})$ ]]; then
			echo "$patterns:$row: expected id, ere, allow, ban|ratchet, YYYY-MM-DD|-, reason, fix separated by tabs"
			status=1
			continue
		fi
		: >"$tmp/hits.$id"
		if [ "$rmode" = ratchet ]; then
			echo "$id" >>"$tmp/ratchet-ids"
			printf '%s\n%s\n' "$reason" "$fix" >"$tmp/meta.$id"
		fi
		# -z ends the path and the line number with NUL, so a path holding ":" stays whole.
		git grep -z -n -I --untracked -E -e "$ere" -- . ":(exclude)$data" >"$tmp/grep" || true
		re="check-allow\\($id\\):(.*)until=([0-9]{4}-[0-9]{2}-[0-9]{2})"
		while IFS= read -r -d '' path <&4 && IFS= read -r -d '' line <&4 && IFS= read -r content <&4; do
			where="$path:$line"
			if allowed "$path" "$allow"; then
				case "$content" in *"check-allow($id)"*) echo "$where: redundant check-allow($id) inside an allow path of $id" ;; esac
				continue
			fi
			if [ "$deadline" != - ] && [[ $today > $deadline ]]; then
				echo "$where: [$id] past its $deadline deadline: $reason; fix: $fix"
				status=1
				continue
			fi
			if [[ $content =~ $re ]]; then
				note=$(trim "${BASH_REMATCH[1]}")
				until=${BASH_REMATCH[2]}
				if [ -z "$note" ]; then
					echo "$where: check-allow($id) needs a reason before until="
					status=1
				elif [[ $until < $today ]]; then
					echo "$where: check-allow($id) expired on $until: $reason; fix: $fix"
					status=1
				fi
				continue
			fi
			case "$content" in *"check-allow($id)"*)
				echo "$where: write check-allow($id): <reason> until=YYYY-MM-DD"
				status=1
				continue
				;;
			esac
			if [ "$rmode" = ban ]; then
				echo "$where: [$id] $reason; fix: $fix"
				status=1
				continue
			fi
			printf '%s\t%s\n' "$(trim "$content" | sha256)" "$where" >>"$tmp/hits.$id"
		done 4<"$tmp/grep"
	done 3<"$patterns"
	return "$status"
}

# Compares each ratchet id's hits with its baseline and the baseline with the base.
check_ratchet() {
	local status=0 id baseline base resets reason fix
	[ -s "$tmp/ratchet-ids" ] || return 0
	if ! base=$(resolve_base 2>/dev/null); then
		echo "ratchet: no base commit to compare baselines with; set CHECK_BASE to the commit this branch starts from"
		return 1
	fi
	resets=$(git log --format=%B "$base..HEAD" | sed -n 's/^Ratchet-Reset:[[:space:]]*\([A-Za-z0-9_-]*\).*/\1/p')
	while IFS= read -r id; do
		{
			IFS= read -r reason
			IFS= read -r fix
		} <"$tmp/meta.$id"
		baseline=$data/ratchet/$id.txt
		: >"$tmp/empty"
		[ -f "$baseline" ] || baseline=$tmp/empty
		if ! REASON=$reason FIX=$fix awk -F'\t' -v id="$id" '
			FILENAME == ARGV[1] { base[$1] = $2; next }
			{ cur[$1]++; where[$1] = where[$1] "\n  " $2 }
			END {
				bad = 0
				for (h in cur) if (cur[h] > (h in base ? base[h] : 0)) {
					printf "ratchet %s: new violation: %s; fix: %s%s\n", id, ENVIRON["REASON"], ENVIRON["FIX"], where[h]; bad = 1
				}
				for (h in base) if ((h in cur ? cur[h] : 0) < base[h]) {
					printf "ratchet %s: fewer violations than the baseline; lower the baseline with scripts/check.sh --write-baselines\n", id; bad = 1
				}
				exit bad
			}' "$baseline" "$tmp/hits.$id"; then
			status=1
		fi
		[ -f "$data/ratchet/$id.txt" ] || continue
		git show "$base:$data/ratchet/$id.txt" >"$tmp/base.$id" 2>/dev/null || continue
		if ! awk -F'\t' -v id="$id" -v reset="$(printf '%s\n' "$resets" | grep -qx -- "$id" && echo 1)" '
			FILENAME == ARGV[1] { base[$1] = $2; btotal += $2; next }
			{ work[$1] = $2; wtotal += $2 }
			END {
				if (reset) {
					if (wtotal > btotal) { printf "ratchet %s: Ratchet-Reset may not raise the total from %d to %d\n", id, btotal, wtotal; exit 1 }
					exit 0
				}
				bad = 0
				for (h in work) if (work[h] > (h in base ? base[h] : 0)) bad = 1
				if (bad) printf "ratchet %s: the baseline grew relative to the base; fix the new violations, or add a Ratchet-Reset: %s <reason> trailer for a reformat\n", id, id
				exit bad
			}' "$tmp/base.$id" "$data/ratchet/$id.txt"; then
			status=1
		fi
	done <"$tmp/ratchet-ids"
	return "$status"
}

check_banned() {
	local status=0
	scan_patterns || status=1
	check_ratchet || status=1
	return "$status"
}

write_baselines() {
	local id
	scan_patterns >/dev/null || true
	while IFS= read -r id; do
		mkdir -p "$data/ratchet"
		awk -F'\t' '{ sub(/:[0-9]+$/, "", $2); c[$1]++; if (!($1 in p)) p[$1] = $2 }
			END { for (h in c) printf "%s\t%d\t%s\n", h, c[h], p[h] }' "$tmp/hits.$id" |
			LC_ALL=C sort >"$data/ratchet/$id.txt"
		echo "wrote $data/ratchet/$id.txt"
	done <"$tmp/ratchet-ids"
}

# ── formal verification record ──

formal=$data/formal.tsv

# Prints the valid rows of formal.tsv as tab-separated fields. With report=1
# it also prints to stderr why each other row is invalid and returns 1. awk splits on
# every tab, so an empty field stays a field instead of shifting the rest.
formal_rows() {
	awk -F'\t' -v report="$1" '
		{ sub(/\r$/, "") }
		/^#/ || $0 == "" { next }
		{
			bad = NF != 6
			for (i = 1; i <= NF; i++) if ($i == "") bad = 1
			if ($1 !~ /^[A-Za-z0-9_-]+$/) bad = 1
			if (length($4) != 40 || $4 ~ /[^0-9a-f]/) bad = 1
			if ($5 != "full" && $5 != "manual") bad = 1
			if ($3 == "-") bad = 1
			if (!bad && seen[$1]++) bad = 1
			if (bad) {
				if (report) printf "%s:%d: expected a unique name, command, covers, a 40-digit synced commit, full|manual and a property, separated by tabs\n", FILENAME, FNR > "/dev/stderr"
				status = 1
				next
			}
			print
		}
		END { exit status }' "$formal"
}

check_formal() {
	local status=0 rows name command covers synced property path changed
	rows=$(formal_rows 1) || status=1
	[ -n "$rows" ] || return "$status"
	while IFS=$'\t' read -r name command covers synced _ property; do
		if ! git cat-file -e "$synced^{commit}" 2>/dev/null; then
			echo "formal $name: synced commit $synced does not exist"
			status=1
			continue
		fi
		if ! git merge-base --is-ancestor "$synced" HEAD; then
			echo "formal $name: synced commit $synced is not an ancestor of HEAD"
			status=1
			continue
		fi
		# The synced tree against the working tree (index included, both sides
		# of a rename, deletions) plus untracked files.
		{
			git diff --name-only -z --no-renames "$synced" --
			git ls-files -z --others --exclude-standard
		} >"$tmp/changed"
		changed=""
		while IFS= read -r -d '' path; do
			case "$path" in "$data"/*) continue ;; esac
			if allowed "$path" "$covers"; then
				changed="$changed
  $path"
			fi
		done <"$tmp/changed"
		if [ -n "$changed" ]; then
			echo "formal $name: covered code changed since $synced:$changed"
			echo "  rerun \`$command\`, confirm the model still describes the code ($property), then set synced in $formal to the commit you checked"
			status=1
		fi
	done <<EOF
$rows
EOF
	return "$status"
}

# ── rule tags ──

check_rule_tags() {
	local files=() f
	for f in .ai/rules/*.md; do
		[ -f "$f" ] && files+=("$f")
	done
	[ ${#files[@]} -gt 0 ] || return 0
	CHECK_KNOWN=$(
		printf '%s\n' "${names[@]}"
		[ -f "$patterns" ] && awk -F'\t' '!/^#/ && NF { print "banned:" $1 }' "$patterns"
	) || true
	export CHECK_KNOWN
	awk '
		function flush(   copy, count, last, tag, kind, body, n, parts, i, name) {
			if (item == "") return
			copy = item
			count = gsub(/\[(check|unchecked):[^]]*\]/, "&", copy)
			last = item
			sub(/^.*\n/, "", last)
			if (count != 1 || !match(last, /\[(check|unchecked):[^]]*\][ \t]*$/)) {
				printf "%s:%d: end the rule with exactly one [check: <name>] or [unchecked: <reason>]\n", file, start
				bad = 1; item = ""; return
			}
			tag = substr(last, RSTART + 1, RLENGTH - 1)
			sub(/\][ \t]*$/, "", tag)
			kind = tag; sub(/:.*/, "", kind)
			body = tag; sub(/^[a-z]+:/, "", body)
			gsub(/^[ \t]+|[ \t]+$/, "", body)
			if (body == "") {
				printf "%s:%d: [%s: ] needs %s\n", file, start, kind, (kind == "check" ? "a check name" : "a reason")
				bad = 1
			} else if (kind == "check") {
				n = split(body, parts, ",")
				for (i = 1; i <= n; i++) {
					name = parts[i]; gsub(/^[ \t]+|[ \t]+$/, "", name)
					if (!(name in known)) {
						printf "%s:%d: unknown check \"%s\"; use a scripts/check.sh --list name or banned:<id>\n", file, start, name
						bad = 1
					}
				}
			}
			item = ""
		}
		BEGIN { n = split(ENVIRON["CHECK_KNOWN"], k, "\n"); for (i = 1; i <= n; i++) known[k[i]] = 1 }
		FNR == 1 { flush(); front = 0; fence = 0 }
		{ sub(/\r$/, "") }
		FNR == 1 && $0 == "---" { front = 1; next }
		front { if ($0 == "---") front = 0; next }
		/^[ \t]*(```|~~~)/ { flush(); fence = !fence; next }
		fence { next }
		/^- / { flush(); item = $0; start = FNR; file = FILENAME; next }
		/^[ \t]+[^ \t]/ && item != "" { item = item "\n" $0; next }
		{ flush() }
		END { flush(); exit bad }
	' "${files[@]}"
}

# ── registration ──

if [ ! -f scripts/check-config.sh ]; then
	echo "check.sh: scripts/check-config.sh is missing; it defines tool_versions and register_checks" >&2
	exit 2
fi
# shellcheck source=/dev/null
. scripts/check-config.sh

if [ "$mode" = passed ]; then
	clean && grep -qE "^(fast|full) $(pass_key)\$" "$passes" 2>/dev/null
	exit
fi

if [ -f "$patterns" ]; then
	check "banned patterns" fast "fix each listed line as its fix says; the patterns are in $patterns" -- check_banned
fi
if [ -f "$formal" ]; then
	check "formal drift" fast "rerun each listed formal check, then update its synced commit in $formal" -- check_formal
	while IFS=$'\t' read -r f_name f_command _ _ f_tier _; do
		if [ "$f_tier" = full ]; then
			check "formal:$f_name" full "the $f_name model or proof failed; read its counterexample in the output above" -- bash -c "$f_command"
		fi
	done <<EOF
$(formal_rows 0 || true)
EOF
fi
register_checks
if [ -d .ai/rules ]; then
	check "rule tags" fast "end each rule item in .ai/rules with [check: <name>] or [unchecked: <reason>]" -- check_rule_tags
fi

if [ "$mode" = list ]; then
	[ ${#names[@]} -eq 0 ] || printf '%s\n' "${names[@]}"
	exit 0
fi
if [ "$mode" = baselines ]; then
	[ -f "$patterns" ] && write_baselines
	exit 0
fi

failed=()
started=$SECONDS
echo "check.sh: $mode"
i=0
while [ "$i" -lt ${#names[@]} ]; do
	if [ "$mode" = fast ] && [ "${modes[$i]}" != fast ]; then
		i=$((i + 1))
		continue
	fi
	t=$SECONDS
	echo "== ${names[$i]}"
	if eval "${commands[$i]}"; then
		echo "-- ${names[$i]}: ok ($((SECONDS - t))s)"
	else
		echo "-- ${names[$i]}: FAILED ($((SECONDS - t))s)"
		failed+=("$i")
	fi
	i=$((i + 1))
done

echo
if [ ${#failed[@]} -gt 0 ]; then
	echo "check.sh $mode: FAILED in $((SECONDS - started))s"
	for i in "${failed[@]}"; do
		echo "  ${names[$i]}: ${hints[$i]}"
	done
	exit 1
fi
echo "check.sh $mode: ok in $((SECONDS - started))s"
if clean; then
	echo "$mode $(pass_key)" >>"$passes"
fi
