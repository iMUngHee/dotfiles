#!/usr/bin/env bash
# Runs every check a change must pass before it is pushed or merged.
#
#   scripts/check.sh                    full: every registered check
#   scripts/check.sh --fast             the pre-push subset
#   scripts/check.sh --passed           exit 0 when this clean HEAD already passed here
#   scripts/check.sh --list             print the registered check names and run nothing
#   scripts/check.sh --write-baselines  rewrite the ratchet baselines to the current violations
#   scripts/check.sh --base             print the base commit the checks compare against
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
--base) mode=base ;;
"") ;;
*)
	echo "usage: scripts/check.sh [--fast | --passed | --list | --write-baselines | --base]" >&2
	exit 2
	;;
esac

data=scripts/check-data
patterns=$data/banned-patterns.tsv
audit=$data/audit.tsv
today=${CHECK_TODAY:-$(date -u +%Y-%m-%d)}
tmp=$(mktemp -d)
probe_group=
# A probe still running when the gate stops dies with it.
cleanup() {
	[ -z "$probe_group" ] || kill -KILL -- "-$probe_group" 2>/dev/null || true
	rm -rf "$tmp"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

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


clean() { [ -z "$(git status --porcelain --untracked-files=normal)" ]; }

# A pass is keyed by commit (a commit message can change a ratchet verdict),
# base, tool versions and date (exceptions and deadlines expire).
pass_key() {
	{
		git rev-parse HEAD
		echo "${gate_base:-none}"
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
	local status=0 setup=0 row=0 rc id ere allow rmode deadline reason fix path line content where re note until
	: >"$tmp/ratchet-ids"
	while IFS=$'\t' read -r id ere allow rmode deadline reason fix <&3 || [ -n "$id" ]; do
		row=$((row + 1))
		case "$id" in "" | "#"*) continue ;; esac
		if ! [[ $id =~ ^[A-Za-z0-9_-]+$ ]] || [ -z "$fix" ] ||
			! [[ $rmode =~ ^(ban|ratchet)$ ]] || ! [[ $deadline =~ ^(-|[0-9]{4}-[0-9]{2}-[0-9]{2})$ ]]; then
			echo "$patterns:$row: expected id, ere, allow, ban|ratchet, YYYY-MM-DD|-, reason, fix separated by tabs"
			setup=1
			continue
		fi
		: >"$tmp/hits.$id"
		if [ "$rmode" = ratchet ]; then
			echo "$id" >>"$tmp/ratchet-ids"
			printf '%s\n%s\n' "$reason" "$fix" >"$tmp/meta.$id"
		fi
		# -z ends the path and the line number with NUL, so a path holding ":" stays whole.
		rc=0
		git grep -z -n -I --untracked -E -e "$ere" -- . ":(exclude)$data" >"$tmp/grep" || rc=$?
		if [ "$rc" -gt 1 ]; then
			echo "$patterns:$row: git grep failed with status $rc; check the pattern"
			setup=1
			continue
		fi
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
	[ "$setup" -eq 0 ] || return 2
	return "$status"
}

# The ids named by Ratchet-Reset trailers in base..HEAD. Only real trailers
# count, and each needs a reason after its id.
reset_ids() {
	local range=$gate_base..HEAD
	[ "$gate_base" != root ] || range=HEAD
	git log --format='%(trailers:key=Ratchet-Reset,valueonly,unfold,separator=%x0A)' "$range" |
		sed -n 's/^[[:space:]]*\([A-Za-z0-9_-][A-Za-z0-9_-]*\)[[:space:]][[:space:]]*[^[:space:]].*/\1/p'
}

# Validates a baseline file: sha256, positive count and path per line, no
# repeated hash. Prints each bad line.
baseline_ok() {
	awk -F'\t' -v file="$2" '
		NF != 3 || length($1) != 64 || $1 !~ /^[0-9a-f]+$/ || $2 !~ /^[1-9][0-9]*$/ {
			printf "%s:%d: a baseline line needs a sha256, a positive count and a path\n", file, FNR; bad = 1; next
		}
		$1 in seen { printf "%s:%d: repeats a hash\n", file, FNR; bad = 1; next }
		{ seen[$1] = 1 }
		END { exit bad }' "$1"
}

# check_ratchet <ids file> [audit] compares each id's hits with its baseline
# and the baseline with the base. An audit id added after adoption must start
# with an empty baseline.
check_ratchet() {
	local status=0 id baseline resets reason fix entry kind=${2:-}
	[ -s "$1" ] || return 0
	if [ -z "$gate_base" ]; then
		echo "ratchet: no base commit to compare baselines with: $CHECK_BASE_ERROR"
		return 1
	fi
	resets=$(reset_ids)
	while IFS= read -r id; do
		{
			IFS= read -r reason
			IFS= read -r fix
		} <"$tmp/meta.$id"
		baseline=$data/ratchet/$id.txt
		: >"$tmp/empty"
		[ -f "$baseline" ] || baseline=$tmp/empty
		if ! baseline_ok "$baseline" "$data/ratchet/$id.txt"; then
			status=1
			continue
		fi
		if ! REASON=$reason FIX=$fix awk -F'\t' -v id="$id" '
			FILENAME == ARGV[1] { base[$1] = $2; next }
			{ cur[$1]++; where[$1] = where[$1] "\n  " $2 }
			END {
				bad = 0
				for (h in cur) if (cur[h] > (allowed = (h in base ? base[h] : 0))) {
					printf "ratchet %s: new violation, %d %s where the baseline allows %d: %s; fix: %s%s\n", id, cur[h], (cur[h] == 1 ? "line" : "lines"), allowed, ENVIRON["REASON"], ENVIRON["FIX"], where[h]; bad = 1
				}
				for (h in base) if ((h in cur ? cur[h] : 0) < base[h]) {
					printf "ratchet %s: fewer violations than the baseline; lower the baseline with scripts/check.sh --write-baselines\n", id; bad = 1
				}
				exit bad
			}' "$baseline" "$tmp/hits.$id"; then
			status=1
		fi
		# The first commit adopts its baselines; so does a base that lists none.
		# A baseline the base lists but cannot produce, as in a partial clone,
		# fails instead of passing as an adoption.
		[ -f "$data/ratchet/$id.txt" ] && [ "$gate_base" != root ] || continue
		if ! entry=$(git ls-tree "$gate_base" -- "$data/ratchet/$id.txt") || { [ -n "$entry" ] && ! git show "$gate_base:$data/ratchet/$id.txt" >"$tmp/base.$id"; }; then
			echo "ratchet $id: cannot read $data/ratchet/$id.txt at $gate_base; fetch that commit or set CHECK_BASE"
			status=1
			continue
		fi
		# A probe the base record did not run is new, whatever baseline file was
		# left behind, and starts empty unless the record is adopted now.
		if [ "$kind" = audit ] && [ "$audit_first" != 1 ] && ! grep -qx -- "$id" "$tmp/audit-base-probes"; then
			if [ -s "$data/ratchet/$id.txt" ]; then
				echo "audit $id: a row added after adoption starts with no baseline; fix its violations first"
				status=1
			fi
			continue
		fi
		if [ -z "$entry" ]; then
			# A probe the base ran with no violations has no baseline file: zero.
			[ "$kind" = audit ] && [ "$audit_first" != 1 ] || continue
			: >"$tmp/base.$id"
		fi
		if ! baseline_ok "$tmp/base.$id" "$data/ratchet/$id.txt at $gate_base"; then
			status=1
			continue
		fi
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
	done <"$1"
	return "$status"
}

check_banned() {
	local status=0
	scan_patterns || status=1
	check_ratchet "$tmp/ratchet-ids" || status=1
	return "$status"
}

# ── audit record ──

audit_categories="layers owner boundary hot-path coupled rule"

# run_audit <command> <stdout file> <stderr file> runs a probe in its own
# process group: 124 past CHECK_AUDIT_TIMEOUT seconds (the group is killed),
# 125 for more than 1 MiB on either stream, else the probe's status.
run_audit() {
	local limit=${CHECK_AUDIT_TIMEOUT:-60} pid ticks=0 rc=0
	[[ $limit =~ ^[1-9][0-9]*$ ]] || limit=60
	set -m
	# ulimit -f stops a probe that writes past the limit while it runs.
	bash -c 'ulimit -f 1025 2>/dev/null; eval "$1"' probe "$1" </dev/null >"$2" 2>"$3" &
	pid=$!
	set +m
	probe_group=$pid
	while kill -0 "$pid" 2>/dev/null; do
		if [ "$ticks" -ge $((limit * 10)) ]; then
			kill -TERM -- "-$pid" 2>/dev/null || true
			sleep 0.2
			kill -KILL -- "-$pid" 2>/dev/null || true
			wait "$pid" 2>/dev/null || true
			probe_group=
			return 124
		fi
		sleep 0.1
		ticks=$((ticks + 1))
	done
	wait "$pid" || rc=$?
	# Children the probe left running die with it.
	kill -KILL -- "-$pid" 2>/dev/null || true
	probe_group=
	if [ "$rc" -eq 153 ] || [ "$(wc -c <"$2")" -gt 1048576 ] || [ "$(wc -c <"$3")" -gt 1048576 ]; then
		return 125
	fi
	return "$rc"
}

# Reads the audit record. A counting row's output lines become ratchet hits;
# check: and banned: rows must name an existing check; - rows are reported as
# incomplete by whoever reads the record. Writes "id<TAB>command" for every
# row to $tmp/audit-rows. Returns 2 for a malformed row or a failed probe.
scan_audit() {
	local status=0 setup=0 row id cat cmd reason fix seen=" " covered=" " banned_ids c missing='' n line
	: >"$tmp/audit-ids"
	: >"$tmp/audit-rows"
	[ -f "$audit" ] || return 0
	banned_ids=" "
	[ ! -f "$patterns" ] || banned_ids=" $(awk -F'\t' '{ sub(/\r$/, "") } !/^#/ && NF { printf "%s ", $1 }' "$patterns")"
	# awk keeps empty fields, which a tab-separated read would collapse.
	awk -F'\t' -v file="$audit" '
		{ sub(/\r$/, "") }
		/^#/ || $0 == "" { next }
		NF != 5 || $1 == "" || $2 == "" || $3 == "" || $4 == "" || $5 == "" || $1 !~ /^[A-Za-z0-9_-]+$/ {
			printf "%s:%d: expected id, category, command, reason, fix separated by tabs\n", file, FNR > "/dev/stderr"; next
		}
		{ print FNR "\t" $0 }' "$audit" >"$tmp/audit-valid" 2>"$tmp/audit-invalid"
	if [ -s "$tmp/audit-invalid" ]; then
		cat "$tmp/audit-invalid"
		setup=1
	fi
	while IFS=$'\t' read -r row id cat cmd reason fix <&3; do
		case " $audit_categories " in *" $cat "*) ;; *)
			echo "$audit:$row: category must be one of $audit_categories"
			setup=1
			continue
			;;
		esac
		case "$seen" in *" $id "*)
			echo "$audit:$row: repeats the id $id"
			setup=1
			continue
			;;
		esac
		seen="$seen$id "
		case "$banned_ids" in *" $id "*)
			echo "audit $id: the id is also a banned-patterns id; both share the Ratchet-Reset namespace"
			setup=1
			continue
			;;
		esac
		covered="$covered$cat "
		printf '%s\t%s\n' "$id" "$cmd" >>"$tmp/audit-rows"
		case "$cmd" in
		-) continue ;;
		check:*)
			listed "${cmd#check:}" "${names[@]}" || { echo "audit $id: $cmd is not a registered check"; status=1; }
			continue
			;;
		banned:*)
			case "$banned_ids" in *" ${cmd#banned:} "*) ;; *) echo "audit $id: $cmd is not a banned-patterns id"; status=1 ;; esac
			continue
			;;
		esac
		echo "$id" >>"$tmp/audit-ids"
		printf '%s\n%s\n' "$reason" "$fix" >"$tmp/meta.$id"
		: >"$tmp/hits.$id"
		n=0
		run_audit "$cmd" "$tmp/out.$id" "$tmp/err.$id" || n=$?
		case $n in
		0) ;;
		124) echo "audit $id: the command ran past ${CHECK_AUDIT_TIMEOUT:-60}s; narrow it or raise CHECK_AUDIT_TIMEOUT"; setup=1; continue ;;
		125) echo "audit $id: the command wrote more than 1 MiB; narrow it"; setup=1; continue ;;
		*)
			echo "audit $id: the command exited with status $n; it must exit 0 and report no match as success"
			head -n 20 "$tmp/err.$id" | sed 's/^/  /'
			setup=1
			continue
			;;
		esac
		n=0
		while IFS= read -r line || [ -n "$line" ]; do
			n=$((n + 1))
			[ -n "$line" ] || continue
			if [[ $line =~ ^([^:]+):([1-9][0-9]*):(.*)$ ]] && canonical_path "${BASH_REMATCH[1]}"; then
				printf '%s\t%s\n' "$(trim "${BASH_REMATCH[3]}" | sha256)" "${BASH_REMATCH[1]}:${BASH_REMATCH[2]}" >>"$tmp/hits.$id"
			else
				echo "audit $id: output line $n is not path:line:text: $line"
				setup=1
				break
			fi
		done <"$tmp/out.$id"
	done 3<"$tmp/audit-valid"
	for c in $audit_categories; do
		case "$covered" in *" $c "*) ;; *) missing="$missing${missing:+, }$c" ;; esac
	done
	if [ -n "$missing" ]; then
		echo "audit: no row covers $missing; add a counting command, a check: or banned: reference, or a - row with its reason"
		status=1
	fi
	[ "$setup" -eq 0 ] || return 2
	return "$status"
}

# A repository-relative path: not absolute, no empty, . or .. segment.
canonical_path() {
	case "/$1/" in //* | *//* | */./* | */../*) return 1 ;; esac
}

audit_at_base() {
	[ -n "$gate_base" ] && [ "$gate_base" != root ] && [ -n "$(git ls-tree "$gate_base" -- "$audit" 2>/dev/null)" ]
}

# Compares the rows with the base: a row the base lists may not lose its
# command or disappear without a Ratchet-Reset trailer for its id. Sets
# audit_first when the record is adopted now: at a root commit, or when no
# ancestor of the base ever had it.
check_audit_base() {
	local status=0 entry resets id bcmd cmd hist
	audit_first=0
	: >"$tmp/audit-base-probes"
	if [ -z "$gate_base" ]; then
		echo "audit: no base commit to compare the record with: $CHECK_BASE_ERROR"
		return 1
	fi
	if [ "$gate_base" = root ]; then
		audit_first=1
		return 0
	fi
	if ! entry=$(git ls-tree "$gate_base" -- "$audit"); then
		echo "audit: cannot read $audit at $gate_base; fetch that commit or set CHECK_BASE"
		return 1
	fi
	if [ -z "$entry" ]; then
		if [ "$(git rev-parse --is-shallow-repository)" = true ]; then
			echo "audit: this shallow clone cannot show whether $audit existed before $gate_base; fetch the full history or set CHECK_BASE"
			return 1
		fi
		# --full-history also sees a record added and removed on a merged branch.
		if ! hist=$(git log -1 --full-history --format=%H "$gate_base" -- "$audit"); then
			echo "audit: cannot read the history of $audit before $gate_base"
			return 1
		fi
		[ -n "$hist" ] || audit_first=1
		return 0
	fi
	if ! git show "$gate_base:$audit" >"$tmp/audit-base"; then
		echo "audit: cannot read $audit at $gate_base; fetch that commit or set CHECK_BASE"
		return 1
	fi
	awk -F'\t' '{ sub(/\r$/, "") } !/^#/ && NF == 5 { print $1 "\t" $3 }' "$tmp/audit-base" >"$tmp/audit-base-rows"
	awk -F'\t' '$2 != "-" && $2 !~ /^(check|banned):/ { print $1 }' "$tmp/audit-base-rows" >"$tmp/audit-base-probes"
	resets=$(reset_ids)
	while IFS=$'\t' read -r id bcmd <&3; do
		printf '%s\n' "$resets" | grep -qx -- "$id" && continue
		if ! cmd=$(awk -F'\t' -v id="$id" '("" $1) == ("" id) { print $2; found = 1; exit } END { exit !found }' "$tmp/audit-rows"); then
			echo "audit $id: the row was removed since the base; keep it, or add a Ratchet-Reset: $id <reason> trailer"
			status=1
		elif [ "$cmd" != "$bcmd" ]; then
			echo "audit $id: the command changed since the base; add a Ratchet-Reset: $id <reason> trailer and keep the baseline total"
			status=1
		fi
	done 3<"$tmp/audit-base-rows"
	return "$status"
}

check_audit() {
	local status=0
	scan_audit || status=1
	check_audit_base || status=1
	check_ratchet "$tmp/audit-ids" audit || status=1
	return "$status"
}

# Rewrites every ratchet baseline, banned-pattern and audit alike, but only
# when every pattern row and audit probe ran cleanly; otherwise nothing changes.
write_baselines() {
	local id s=0
	: >"$tmp/ratchet-ids"
	: >"$tmp/audit-ids"
	if [ -f "$patterns" ]; then
		scan_patterns >/dev/null || s=$?
		if [ "$s" -eq 2 ]; then
			echo "write-baselines: fix the rows of $patterns first; nothing was written"
			return 1
		fi
	fi
	s=0
	scan_audit || s=$?
	if [ "$s" -ne 0 ]; then
		echo "write-baselines: fix the audit record above first; nothing was written"
		return 1
	fi
	mkdir -p "$tmp/new"
	while IFS= read -r id; do
		awk -F'\t' '{ sub(/:[0-9]+$/, "", $2); c[$1]++; if (!($1 in p)) p[$1] = $2 }
			END { for (h in c) printf "%s\t%d\t%s\n", h, c[h], p[h] }' "$tmp/hits.$id" |
			LC_ALL=C sort >"$tmp/new/$id.txt"
	done < <(cat "$tmp/ratchet-ids" "$tmp/audit-ids")
	mkdir -p "$data/ratchet"
	for id in "$tmp"/new/*.txt; do
		[ -f "$id" ] || continue
		mv "$id" "$data/ratchet/${id##*/}"
		echo "wrote $data/ratchet/${id##*/}"
	done
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

# The tag rules shared by both grammars: an item's last line ends with exactly
# one [check: <names>] naming registered checks or banned:<id>, or one
# [unchecked: <reason>]. The closed grammar (strict) also wants a reason of
# more than one word, since a bare "review" never says why no check decides it.
rule_flush='
	function flush(   copy, count, last, tag, kind, body, n, parts, i, name, words) {
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
		} else if (kind == "unchecked" && strict && split(body, words, /[ \t]+/) < 2) {
			printf "%s:%d: [unchecked: %s] needs a reason that says why no check decides it, such as [unchecked: review judges allocation on the request path]\n", file, start, body
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
'

# .ai/rules keeps its original grammar: a rule starts at an unindented "- ".
# shellcheck disable=SC2016 # an awk program; its $ fields are not shell expansions
rule_legacy='
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
'

# Documents registered through rule_files use a closed grammar, so that no list
# form or fence can hide a rule: every unindented list line is a rule, every
# indented list line is rejected, and a fence opens only at column 0.
# shellcheck disable=SC2016 # an awk program; its $ fields are not shell expansions
rule_strict='
	BEGIN { strict = 1 }
	function opened() {
		if (fence != "") { printf "%s:%d: close this fence; the rest of the file was hidden from the rule check\n", ffile, fstart; bad = 1 }
		fence = ""
	}
	function closes(line,   i, n) {
		for (i = 0; i < 3 && substr(line, 1, 1) == " "; i++) line = substr(line, 2)
		n = 0
		while (substr(line, n + 1, 1) == fence) n++
		return n >= flen && substr(line, n + 1) ~ /^[ \t]*$/
	}
	function marker(rest) {
		if (rest ~ /^[-*+]([ \t]|$)/) return 1
		return match(rest, /^[0-9]+[.)]([ \t]|$)/) && match(rest, /^[0-9]+/) && RLENGTH <= 9
	}
	FNR == 1 { flush(); opened() }
	{ sub(/\r$/, "") }
	fence != "" { if (closes($0)) fence = ""; next }
	/<!--/ {
		flush()
		printf "%s:%d: rule files take no HTML comments; they can hide a rule from this check\n", FILENAME, FNR
		bad = 1; next
	}
	/^(```|~~~)/ {
		c = substr($0, 1, 1)
		if (c == "`") { match($0, /^`+/) } else { match($0, /^~+/) }
		if (!(c == "`" && index(substr($0, RLENGTH + 1), "`"))) {
			flush(); fence = c; flen = RLENGTH; fstart = FNR; ffile = FILENAME; next
		}
	}
	/^ ? ? ?>/ {
		quoted = $0; sub(/^ *>[> \t]*/, "", quoted)
		if (marker(quoted)) {
			flush()
			printf "%s:%d: rule files take no lists inside block quotes; write the rule as an unindented list item\n", FILENAME, FNR
			bad = 1; next
		}
	}
	{
		ind = match($0, /^[ \t]+/) ? RLENGTH : 0
		rest = substr($0, ind + 1)
		if (marker(rest)) {
			flush()
			if (ind > 0) {
				printf "%s:%d: rule files take no indented or nested lists; write it as a paragraph or a separate rule\n", FILENAME, FNR
				bad = 1; next
			}
			body = rest; sub(/^([-*+]|[0-9]+[.)])/, "", body)
			if (body ~ /^[ \t]*$/) {
				printf "%s:%d: write the rule on the marker line\n", FILENAME, FNR
				bad = 1; next
			}
			item = $0; start = FNR; file = FILENAME; next
		}
		if (ind > 0 && rest != "" && item != "") { item = item "\n" $0; next }
		flush()
	}
	END { flush(); opened(); exit bad }
'

listed() {
	local want=$1 x
	shift
	for x in "$@"; do [ "$x" = "$want" ] && return 0; done
	return 1
}

check_rule_tags() {
	local legacy=() strict=() f p q seg rest out status=0 match bad=0
	for f in .ai/rules/*.md; do
		[ -f "$f" ] && legacy+=("./$f")
	done
	if declare -F rule_files >/dev/null; then
		out=$(rule_files) || status=$?
		if [ "$status" -ne 0 ]; then
			echo "rule_files exited with status $status; it must print one repository-relative path per line"
			return 1
		fi
		while IFS= read -r p; do
			[ -n "$p" ] || continue
			while case $p in *//*) true ;; *) false ;; esac do p=${p//\/\//\/}; done
			p=${p#./}
			case $p in /*)
				echo "rule_files: $p: give a path relative to the repository root"; bad=1; continue ;;
			esac
			case "/$p/" in */./* | */../*)
				echo "rule_files: $p: remove the . and .. segments"; bad=1; continue ;;
			esac
			q='' rest=$p
			while [ -n "$rest" ]; do
				seg=${rest%%/*}
				if [ "$seg" = "$rest" ]; then rest=''; else rest=${rest#*/}; fi
				q=${q:+$q/}$seg
				if [ -L "$q" ]; then break; fi
			done
			if [ -L "$q" ]; then
				echo "rule_files: $p: $q is a symlink; register the file it points to"; bad=1; continue
			fi
			if ! match=$(git ls-files -s -z -- ":(literal)$p" | tr '\0' '\n'); then
				echo "rule_files: $p: git ls-files failed"; bad=1; continue
			fi
			if [ "${match#*$'\t'}" != "$p" ]; then
				echo "rule_files: $p: not a tracked file with this exact spelling"; bad=1; continue
			fi
			case $match in 120000\ *)
				echo "rule_files: $p: git records it as a symlink; register the file it points to"; bad=1; continue ;;
			esac
			if [ ! -f "$p" ] || [ ! -r "$p" ]; then
				echo "rule_files: $p: not a readable file"; bad=1; continue
			fi
			case $p in
			.ai/rules/*) [ ${#legacy[@]} -gt 0 ] && listed "./$p" "${legacy[@]}" || legacy+=("./$p") ;;
			*) [ ${#strict[@]} -gt 0 ] && listed "./$p" "${strict[@]}" || strict+=("./$p") ;;
			esac
		done <<EOF
$out
EOF
	fi
	CHECK_KNOWN=$(
		printf '%s\n' "${names[@]}"
		[ -f "$patterns" ] && awk -F'\t' '!/^#/ && NF { print "banned:" $1 }' "$patterns"
		[ -f "$audit" ] && awk -F'\t' '!/^#/ && NF >= 3 { c = $3; sub(/\r$/, "", c); if (c != "-" && c !~ /^(check|banned):/) print "audit:" $1 }' "$audit"
	) || true
	export CHECK_KNOWN
	if [ ${#legacy[@]} -gt 0 ]; then
		awk "$rule_flush$rule_legacy" "${legacy[@]}" || bad=1
	fi
	if [ ${#strict[@]} -gt 0 ]; then
		awk "$rule_flush$rule_strict" "${strict[@]}" || bad=1
	fi
	return "$bad"
}

# ── registration ──

# --base needs no configuration, so a repository with its own gate can call it.
if [ -f scripts/check-config.sh ]; then
	# --base prints only the base, so the configuration's output goes to stderr.
	if [ "$mode" = base ]; then
		# shellcheck source=/dev/null
		. scripts/check-config.sh >&2
	else
		# shellcheck source=/dev/null
		. scripts/check-config.sh
	fi
elif [ "$mode" != base ]; then
	echo "check.sh: scripts/check-config.sh is missing; it defines tool_versions and register_checks" >&2
	exit 2
fi
if [ "$mode" = base ]; then
	resolve_base
	exit
fi

# One base for the whole run: the ratchet, the pass record and the checks,
# which read it from CHECK_RESOLVED_BASE (empty when unresolved, with the
# reason in CHECK_BASE_ERROR).
gate_base=$(resolve_base 2>"$tmp/base-error") || gate_base=
CHECK_BASE_ERROR=$(cat "$tmp/base-error")
export CHECK_RESOLVED_BASE=$gate_base CHECK_BASE_ERROR

if [ "$mode" = passed ]; then
	# A run without a base never compared growth, so it never counts.
	[ -n "$gate_base" ] && clean && grep -qE "^(fast|full) $(pass_key)\$" "$passes" 2>/dev/null
	exit
fi

if [ -f "$patterns" ]; then
	check "banned patterns" fast "fix each listed line as its fix says; the patterns are in $patterns" -- check_banned
fi
if [ -f "$audit" ] || audit_at_base; then
	check audit fast "fix each listed violation or audit row; the record is $audit" -- check_audit
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
if [ -d .ai/rules ] || declare -F rule_files >/dev/null; then
	check "rule tags" fast "end each rule item in .ai/rules and the rule_files documents with [check: <name>] or [unchecked: <reason>]" -- check_rule_tags
fi

if [ "$mode" = list ]; then
	[ ${#names[@]} -eq 0 ] || printf '%s\n' "${names[@]}"
	exit 0
fi
if [ "$mode" = baselines ]; then
	if [ -f "$patterns" ] || [ -f "$audit" ]; then
		write_baselines || exit 1
	fi
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
	rc=0
	eval "${commands[$i]}" || rc=$?
	if [ "$rc" -eq 0 ]; then
		echo "-- ${names[$i]}: ok ($((SECONDS - t))s)"
	elif [ "$rc" -eq 127 ]; then
		# 127 is how the shell reports a missing command, so point at setup first.
		echo "-- ${names[$i]}: FAILED ($((SECONDS - t))s); exit 127: if the output names a missing command or interpreter, install it or fix PATH"
		failed+=("$i")
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
