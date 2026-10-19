#!/bin/bash
# ai/scripts/vendor.sh — install, update or check the third-party code listed in
# ai/scripts/vendor.manifest, plus the machine-only entries in
# ${AI_VENDOR_DIR:-~/.local/share/ai-vendor}/private.manifest (outside this repo).
# The manifest format and the four kinds are described at the top of vendor.manifest.
#
#   vendor.sh [check] [name...]        read-only: installed vs upstream, one row per entry
#   vendor.sh sync <name[@ref]>...     install or update the named entries; @ref
#                                      replaces the manifest ref for this run only
#   vendor.sh sync --all               every entry, in manifest order
#
# check exits 0 even when an entry is behind (its row says so); sync tries every
# selected entry and exits 1 if any failed; a usage or manifest error exits 2.
# User-invoked only: ai/scripts/bootstrap.sh never calls this, so deploys stay
# offline-safe. On Windows run it through windows/scripts/vendor.ps1.
#
# Runs on macOS /bin/bash 3.2, Linux and Git Bash alike: no associative arrays,
# mapfile or ${x,,}, and no sed -i, readlink -f or stat.
#
# No `set -e`: most steps here are probes whose failure is an answer, not an
# error, and -e would not see a failure inside a command substitution anyway.
set -uo pipefail

# An exported CDPATH makes `cd` print the directory, which would corrupt SCRIPT_DIR.
unset CDPATH
# Git exports these to hooks, `rebase -x`, `bisect run` and `submodule foreach`.
# Inherited, they would aim every `git -C <clone>` below at that other repository.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES \
    GIT_COMMON_DIR GIT_NAMESPACE GIT_PREFIX

CR="$(printf '\r')"
TAB="$(printf '\t')"
NL='
'
BOM="$(printf '\357\273\277')"
IS_MSYS=0

# Windows (Git Bash): make ln -s create a real NTFS symlink or fail. MSYS's default
# silently copies, which would freeze a linked skill at the version it was copied at.
case "$(uname -s)" in
    MINGW* | MSYS*)
        IS_MSYS=1
        export MSYS="${MSYS:+$MSYS }winsymlinks:nativestrict"
        ;;
esac

usage() {
    cat <<'EOF'
usage: vendor.sh [check] [name...]
       vendor.sh sync <name[@ref]>... | --all
EOF
}

die() {
    echo "vendor: $*" >&2
    exit 2
}

expand_path() {
    case "$1" in
        "~") printf '%s\n' "$HOME" ;;
        "~/"*) printf '%s\n' "$HOME/${1#\~/}" ;;
        *) printf '%s\n' "$1" ;;
    esac
}

# Character sets are spelled out, never ranges: under macOS bash 3.2 and most UTF-8
# locales [a-z] collates as aAbB…, and [[:lower:]] takes é, so either lets through
# more than the ASCII the manifest format promises.
is_sha() {
    [ "${#1}" -eq 40 ] || return 1
    case "$1" in *[!0123456789abcdef]*) return 1 ;; esac
}

# A tag glob takes * and ? only (see check_ref).
is_glob() {
    case "$1" in *[*?]*) return 0 ;; esac
    return 1
}

# Git refs cannot contain [, so a [class] could only be a glob — and splitting a
# glob into literal prefix and suffix around one would drop real tags.
check_ref() { # <where> <ref>
    case "$2" in *[[]*) die "$1: '$2': a ref or tag glob may use * and ?, but not [...]" ;; esac
}

is_abs() {
    case "$1" in
        /* | "~" | "~/"*) return 0 ;;
        # A drive path is absolute only under Git Bash; elsewhere C:/x is relative.
        [ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz]:/*) [ "$IS_MSYS" = 1 ] ;;
        *) return 1 ;;
    esac
}

is_version() { # npm-style version: starts with a digit, then digits, letters, . + -
    case "$1" in
        '' | [!0123456789]* | *[!0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.+-]*) return 1 ;;
    esac
}

# has_line <list> <item>: is <item> one of the newline-separated lines of <list>?
# A case match, not `printf | grep -q`: under pipefail an early-exiting grep can
# turn a match into a failure through SIGPIPE.
has_line() {
    case "$NL$1$NL" in *"$NL$2$NL"*) return 0 ;; esac
    return 1
}

trim() {
    local s="$1"
    s="${s#"${s%%[![:space:]]*}"}"
    printf '%s\n' "${s%"${s##*[![:space:]]}"}"
}

# Resolve the script through symlinks (no readlink -f on macOS) so the manifest
# next to the real file is found.
script_path="$0"
while [ -L "$script_path" ]; do
    link_target="$(readlink "$script_path")"
    case "$link_target" in
        /*) script_path="$link_target" ;;
        *) script_path="$(dirname "$script_path")/$link_target" ;;
    esac
done
SCRIPT_DIR="$(cd "$(dirname "$script_path")" && pwd)"

VENDOR_DIR="$(expand_path "${AI_VENDOR_DIR:-$HOME/.local/share/ai-vendor}")"
is_abs "$VENDOR_DIR" || die "AI_VENDOR_DIR must be an absolute path: $VENDOR_DIR"
MANIFEST="${AI_VENDOR_MANIFEST:-$SCRIPT_DIR/vendor.manifest}"
PRIVATE_MANIFEST="$VENDOR_DIR/private.manifest"
TIMEOUT="${AI_VENDOR_TIMEOUT:-20}"
case "$TIMEOUT" in
    '' | 0* | *[!0123456789]*) die "AI_VENDOR_TIMEOUT must be a whole number of seconds above 0: '$TIMEOUT'" ;;
esac

# A remote lookup must never sit on a prompt: no terminal credential prompt, and no SSH
# passphrase unless the user set up their own SSH command (a per-key
# core.sshCommand, GIT_SSH, plink on Windows), which must win over ours. Only the
# lookups get this (see exec_lookup); sync's own fetches keep the user's
# environment, repo-local and includeIf SSH settings included.
LOOKUP_SSH=""
if [ -z "${GIT_SSH_COMMAND:-}" ] && [ -z "${GIT_SSH:-}" ] &&
    [ -z "$(cd / && git config --get core.sshCommand 2>/dev/null)" ]; then
    LOOKUP_SSH="ssh -o BatchMode=yes"
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/vendor.XXXXXX")" || {
    echo "vendor: cannot create a temp dir" >&2
    exit 2
}
trap 'rm -rf "$WORK"' EXIT
ENTRIES="$WORK/entries"
SELECTED="$WORK/selected"
: >"$ENTRIES"
: >"$SELECTED"

# ── manifest ──

validate() { # <where> <name> <kind> <source> <ref> <dest> <post>
    local at="$1" name="$2" kind="$3" source="$4" ref="$5" dest="$6" post="$7"
    check_ref "$at" "$ref"
    case "$name" in
        [abcdefghijklmnopqrstuvwxyz0123456789]*) ;;
        *) die "$at: bad name '$name' (start with a-z or 0-9)" ;;
    esac
    case "$name" in *[!abcdefghijklmnopqrstuvwxyz0123456789._-]*) die "$at: bad name '$name' (use a-z 0-9 . _ -)" ;; esac
    case "$kind" in
        release | skill)
            [ "$source" != - ] && [ "$ref" != - ] || die "$at: $kind needs a source and a ref"
            if [ "$kind" = skill ]; then
                case "$dest" in
                    - | /* | "~"* | *..*) die "$at: skill dest must be a relative path inside the clone" ;;
                esac
            elif [ "$dest" != - ] && ! is_abs "$dest"; then
                die "$at: release dest must be - or an absolute path"
            fi
            ;;
        npm)
            [ "$source" != - ] && [ "$ref" != - ] && [ "$post" != - ] ||
                die "$at: npm needs a package, a ref and a post command"
            [ "$ref" = latest ] || is_version "$ref" || die "$at: npm ref must be latest or a version"
            ;;
        source)
            is_abs "$dest" || die "$at: source dest must be an absolute path"
            [ "$source" = - ] || [ "$ref" != - ] || die "$at: a source with a URL needs a branch"
            ;;
        *) die "$at: unknown kind '$kind' (release, skill, npm, source)" ;;
    esac
}

parse_manifest() { # <file>
    local file="$1" n=0 line trimmed name kind source ref dest post
    [ -f "$file" ] && [ -r "$file" ] || die "cannot read manifest: $file"
    while IFS= read -r line || [ -n "$line" ]; do
        n=$((n + 1))
        line="${line%"$CR"}"
        line="${line#"$BOM"}"
        trimmed="${line#"${line%%[![:space:]]*}"}"
        case "$trimmed" in '' | '#'*) continue ;; esac
        name='' kind='' source='' ref='' dest='' post=''
        # A here-doc, not `set -- $trimmed`, so a glob ref like v* is never expanded.
        read -r name kind source ref dest post <<EOF
$trimmed
EOF
        [ -n "$post" ] || die "$file:$n: expected 6 fields (name kind source ref dest post); use - for an empty one"
        validate "$file:$n" "$name" "$kind" "$source" "$ref" "$dest" "$post"
        if awk -F'\t' -v n="$name" '$1 == n { found = 1 } END { exit !found }' "$ENTRIES"; then
            die "$file:$n: duplicate name '$name'"
        fi
        printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$name" "$kind" "$source" "$ref" "$dest" "$post" >>"$ENTRIES"
    done <"$file"
}

select_entry() { # <name[@ref]> <allow-ref:0|1>
    local name="$1" ref="" line
    case "$1" in
        *@*)
            [ "$2" = 1 ] || die "check takes plain names: $1"
            name="${1%%@*}"
            ref="${1#*@}"
            [ -n "$ref" ] || die "empty ref in '$1'"
            check_ref "$1" "$ref"
            ;;
    esac
    line="$(awk -F'\t' -v n="$name" '$1 == n' "$ENTRIES")"
    [ -n "$line" ] || die "unknown entry '$name'"
    if [ -n "$ref" ]; then
        line="$(printf '%s\n' "$line" | awk -F'\t' -v OFS='\t' -v r="$ref" '{ $4 = r; print }')"
    fi
    printf '%s\n' "$line" >>"$SELECTED"
}

# ── remote lookups ──

# limited <out> <cmd...>: run a remote lookup with its stdout in <out>, ending it
# after $TIMEOUT seconds (status 124): SIGTERM first, SIGKILL a second later for a
# command that ignores it. macOS ships no timeout(1), hence the poll. Output goes to
# a file, not a pipe, so a child that outlives the kill cannot hold this script open.
limited() {
    local out="$1" pid ticks=0 limit=$((TIMEOUT * 10)) timed_out=0
    shift
    "$@" >"$out" 2>/dev/null </dev/null &
    pid=$!
    # A background job of a non-interactive shell ignores Ctrl-C, so end it here —
    # with SIGKILL, since this shell is leaving and a lookup has nothing to save.
    trap 'kill -KILL "$pid" 2>/dev/null; exit 130' INT
    trap 'kill -KILL "$pid" 2>/dev/null; exit 143' TERM
    while kill -0 "$pid" 2>/dev/null; do
        if [ "$ticks" -eq "$limit" ]; then
            timed_out=1
            kill "$pid" 2>/dev/null
        elif [ "$ticks" -ge $((limit + 10)) ]; then
            kill -KILL "$pid" 2>/dev/null
            break
        fi
        sleep 0.1
        ticks=$((ticks + 1))
    done
    trap - INT TERM
    if [ "$timed_out" = 1 ]; then
        wait "$pid" 2>/dev/null
        return 124
    fi
    wait "$pid"
}

# exec_lookup <git args...>: git with prompts off, for limited() only — exec turns
# the background subshell into git itself, so the pid limited() ends is git's.
exec_lookup() {
    export GIT_TERMINAL_PROMPT=0
    [ -z "$LOOKUP_SSH" ] || export GIT_SSH_COMMAND="$LOOKUP_SSH"
    exec git "$@"
}

# remote_ref <url> <ref>: the object a remote ref points at. Status 1 when the
# remote answered without that ref, 2 when it did not answer.
remote_ref() {
    local out="$WORK/ls" sha ref
    limited "$out" exec_lookup ls-remote "$1" "$2" || return 2
    while read -r sha ref; do
        [ "$ref" = "$2" ] && {
            printf '%s\n' "$sha"
            return 0
        }
    done <<EOF
$(tr -d "$CR" <"$out")
EOF
    return 1
}

# latest_tag <url> <glob> [version]: "<tag> <object>" for the newest tag whose
# whole name matches <glob>, skipping prereleases; nothing when none matches.
# ls-remote matches a pattern against the tail of a ref, so release/v9.9.9 also
# answers v*; the case below drops it. A prerelease is a version-shaped part
# (digits, a dot, then a dash: 1.2.0-rc.1) where the glob's wildcard matched, so
# dated tags (release-2024-01) and suffix globs (v*-stable) still count. With
# `version`, the matched part must also start with a digit (drops `nightly`).
latest_tag() {
    local out="$WORK/ls" prefix="${2%%[*?]*}" suffix="${2##*[*?]}" sha ref tag core
    limited "$out" exec_lookup ls-remote --tags --refs "$1" "$2" || return 2
    while read -r sha ref; do
        [ -n "$ref" ] || continue
        tag="${ref#refs/tags/}"
        # shellcheck disable=SC2254 # the glob is the point
        case "$tag" in $2) ;; *) continue ;; esac
        core="${tag#"$prefix"}"
        core="${core%"$suffix"}"
        case "$core" in [0123456789]*.*-*) continue ;; esac
        if [ "${3:-}" = version ]; then
            case "$core" in [0123456789]*) ;; *) continue ;; esac
        fi
        printf '%s %s\n' "$tag" "$sha"
    done <<EOF | sort -V | tail -n 1
$(tr -d "$CR" <"$out")
EOF
}

# A glob for the tag's siblings: its last run of version digits and dots becomes *.
# v2.16.0 -> v*, py3-v1.0 -> py3-v*, v1.0.0-stable -> v*-stable, 1.0.0 -> *.
version_glob() {
    local re='^(.*[^0-9.])?([0-9.]*[0-9][0-9.]*)([^0-9]*)$'
    if [[ $1 =~ $re ]]; then
        printf '%s*%s\n' "${BASH_REMATCH[1]}" "${BASH_REMATCH[3]}"
    else
        printf '%s\n' "$1"
    fi
}

npm_latest() { # <package>: a trimmed, version-shaped answer or failure
    local out="$WORK/npm" v
    limited "$out" npm view "$1" version || return 2
    v="$(trim "$(tr -d "$CR" <"$out" | awk 'NF { v = $0 } END { print v }')")"
    is_version "$v" || return 1
    printf '%s\n' "$v"
}

# ── git-backed entries (release, skill) ──

entry_dir() { # <name> <kind> <dest>
    if [ "$2" = release ] && [ "$3" != - ]; then expand_path "$3"; else printf '%s\n' "$VENDOR_DIR/$1"; fi
}

head_sha() { # <dir>
    [ -e "$1/.git" ] || return 1
    git -C "$1" rev-parse --verify -q HEAD 2>/dev/null
}

head_tags() { # <dir>
    git -C "$1" tag --points-at HEAD 2>/dev/null | sort -V
}

# The URL as written in the clone's config. `remote get-url` would apply
# url.*.insteadOf and never equal the manifest's URL again.
origin_url() { # <dir>
    git -C "$1" config --get remote.origin.url 2>/dev/null
}

# Why a dest cannot be used as this entry's clone, or nothing when it can.
dest_problem() { # <dir> <source>
    local origin
    if [ -L "$1" ] && [ ! -e "$1" ]; then
        echo "dangling symlink"
    elif [ -e "$1/.git" ]; then
        origin="$(origin_url "$1")"
        [ "$origin" = "$2" ] || echo "origin ${origin:-none}"
    elif [ -e "$1" ] && { [ ! -d "$1" ] || [ -n "$(ls -A "$1" 2>/dev/null)" ]; }; then
        echo "not a git clone"
    fi
}

skill_home() { # claude | agents
    case "$1" in
        claude) printf '%s\n' "$HOME/.claude/skills" ;;
        agents) printf '%s\n' "$HOME/.agents/skills" ;;
    esac
}

link_state() { # <link> <target> -> linked | broken | missing | conflict
    if [ -L "$1" ]; then
        if [ "$(readlink "$1")" = "$2" ]; then
            if [ -d "$2" ]; then echo linked; else echo broken; fi
        elif [ -d "$1" ] && [ -d "$2" ] && [ "$(cd "$1" && pwd -P)" = "$(cd "$2" && pwd -P)" ]; then
            echo linked
        else
            echo conflict
        fi
    elif [ -e "$1" ]; then
        echo conflict
    else
        echo missing
    fi
}

check_git() { # <name> <kind> <source> <ref> <dest>
    local name="$1" kind="$2" source="$3" ref="$4" dest="$5" dir problem head tags installed upstream status
    local line latest latest_obj local_obj remote tool unlinked="" conflict="" broken=""
    dir="$(entry_dir "$name" "$kind" "$dest")"
    problem="$(dest_problem "$dir" "$source")"
    if [ -n "$problem" ]; then
        row "$name" "$kind" - - "foreign ($problem)"
        return
    fi
    head="$(head_sha "$dir")" || head=""
    tags=""
    [ -n "$head" ] && tags="$(head_tags "$dir")"

    if is_sha "$ref"; then
        upstream="${ref:0:12}"
        installed="${head:0:12}"
        if [ -z "$head" ]; then
            status=missing
        elif [ "$head" = "$ref" ]; then
            status="ok (pinned)"
            remote="$(remote_ref "$source" HEAD)"
            case $? in
                0) [ "$remote" = "$ref" ] || status="$status, upstream moved ${remote:0:12}" ;;
                *) status="$status, unreachable" ;;
            esac
        else
            status=update
        fi
    elif is_glob "$ref"; then
        if line="$(latest_tag "$source" "$ref")"; then
            latest="${line%% *}"
            latest_obj="${line#* }"
            upstream="${latest:--}"
            if [ -z "$latest" ]; then
                if [ -z "$head" ]; then status="missing, no matching tag"; else status="no matching tag"; fi
            elif [ -z "$head" ]; then
                status=missing
            elif has_line "$tags" "$latest"; then
                local_obj="$(git -C "$dir" rev-parse -q --verify "refs/tags/$latest" 2>/dev/null)"
                if [ "$local_obj" = "$latest_obj" ]; then status=ok; else status="update (tag moved)"; fi
            else
                status=update
            fi
        else
            latest=""
            upstream='?'
            if [ -z "$head" ]; then status="missing, unreachable"; else status=unreachable; fi
        fi
        installed="$latest"
    else
        upstream="$ref"
        installed="$ref"
        if [ -z "$head" ]; then
            status=missing
        elif has_line "$tags" "$ref"; then
            status="ok (pinned)"
            remote="$(remote_ref "$source" "refs/tags/$ref")"
            case $? in
                0)
                    local_obj="$(git -C "$dir" rev-parse -q --verify "refs/tags/$ref" 2>/dev/null)"
                    if [ "$remote" != "$local_obj" ]; then
                        status="update (tag moved)"
                    elif line="$(latest_tag "$source" "$(version_glob "$ref")" version)" && [ -n "$line" ]; then
                        latest="${line%% *}"
                        [ "$latest" = "$ref" ] || status="$status, latest $latest"
                    fi
                    ;;
                1) status="$status, tag gone upstream" ;;
                *) status="$status, unreachable" ;;
            esac
        else
            status=update
        fi
    fi
    # Show the tag this entry asked for when HEAD carries several (v1.0.0 beside v1.0.0-rc.1).
    if [ -z "$head" ]; then
        installed=-
    elif [ -z "$installed" ] || ! has_line "$tags" "$installed"; then
        installed="$(printf '%s\n' "$tags" | tail -n 1)"
        [ -n "$installed" ] || installed="${head:0:12}"
    fi

    if [ "$kind" = skill ] && [ -n "$head" ]; then
        for tool in claude agents; do
            case "$(link_state "$(skill_home "$tool")/$name" "$dir/$dest")" in
                missing) unlinked="${unlinked:+$unlinked }$tool" ;;
                broken) broken="${broken:+$broken }$tool" ;;
                conflict) conflict="${conflict:+$conflict }$tool" ;;
            esac
        done
        [ -z "$conflict" ] || status="$status, conflict: $conflict"
        [ -z "$unlinked" ] || status="$status, unlinked: $unlinked"
        [ -z "$broken" ] || status="$status, broken: $broken"
    fi
    row "$name" "$kind" "$installed" "$upstream" "$status"
}

# Fetch <ref> (a tag or a SHA) into the clone. A tag is fetched with force, so a
# tag moved upstream replaces the local one instead of being refused.
fetch_ref() { # <dir> <ref>
    local dir="$1" ref="$2"
    if is_sha "$ref"; then
        # GitHub serves a commit by SHA; a server that refuses falls back to full history.
        if ! git -C "$dir" fetch -q --depth 1 origin "$ref" 2>/dev/null; then
            if [ "$(git -C "$dir" rev-parse --is-shallow-repository)" = true ]; then
                git -C "$dir" fetch -q --unshallow --tags origin || return 1
            else
                git -C "$dir" fetch -q --tags origin || return 1
            fi
        fi
    else
        git -C "$dir" fetch -q --depth 1 origin "+refs/tags/$ref:refs/tags/$ref"
    fi
}

link_skill() { # <name> <target>
    local name="$1" target="$2" tool link failed=0
    for tool in claude agents; do
        link="$(skill_home "$tool")/$name"
        case "$(link_state "$link" "$target")" in
            linked) ;;
            missing)
                if mkdir -p "$(dirname "$link")" && ln -s "$target" "$link"; then
                    echo "$name: linked $link"
                else
                    echo "$name: cannot link $link" >&2
                    failed=1
                fi
                ;;
            broken | conflict)
                echo "$name: $link exists and is not a working link to this skill; left untouched" >&2
                failed=1
                ;;
        esac
    done
    return "$failed"
}

sync_git() { # <name> <kind> <source> <ref> <dest> <post>
    local name="$1" kind="$2" source="$3" ref="$4" dest="$5" post="$6" dir problem target line head commit
    dir="$(entry_dir "$name" "$kind" "$dest")"
    problem="$(dest_problem "$dir" "$source")"
    if [ -n "$problem" ]; then
        echo "$name: $dir cannot be used ($problem); left untouched" >&2
        return 1
    fi

    target="$ref"
    if is_glob "$ref"; then
        line="$(latest_tag "$source" "$ref")" || {
            echo "$name: cannot read tags from $source" >&2
            return 1
        }
        target="${line%% *}"
        [ -n "$target" ] || {
            echo "$name: no tag matches $ref at $source" >&2
            return 1
        }
    fi

    if [ ! -e "$dir/.git" ]; then
        mkdir -p "$dir" && git -C "$dir" init -q && git -C "$dir" remote add origin "$source" || {
            echo "$name: cannot create a clone at $dir" >&2
            return 1
        }
    fi
    fetch_ref "$dir" "$target" || {
        echo "$name: cannot fetch $target from $source" >&2
        return 1
    }
    if is_sha "$target"; then commit="$target"; else commit="refs/tags/$target"; fi
    commit="$(git -C "$dir" rev-parse -q --verify "$commit^{commit}" 2>/dev/null)" || {
        echo "$name: $target is not a commit at $source" >&2
        return 1
    }
    # Check before moving: a tag without the skill dir would leave both links dangling.
    if [ "$kind" = skill ] && [ "$(git -C "$dir" cat-file -t "$commit:$dest" 2>/dev/null)" != tree ]; then
        echo "$name: $target has no directory $dest; the clone stays where it was" >&2
        return 1
    fi

    head="$(head_sha "$dir")" || head=""
    if [ "$head" = "$commit" ]; then
        echo "$name: already at $target"
    else
        echo "$name: ${head:+${head:0:12} }-> $target"
        git -C "$dir" -c advice.detachedHead=false checkout -q "$commit" || {
            echo "$name: cannot check out $target in $dir" >&2
            return 1
        }
    fi

    if [ "$post" != - ]; then
        (cd "$dir" && bash -c "$post") || {
            echo "$name: post command failed" >&2
            return 1
        }
    fi
    [ "$kind" != skill ] || link_skill "$name" "$dir/$dest"
}

# ── npm ──

check_npm() { # <name> <source> <ref>
    local name="$1" source="$2" ref="$3" file="$VENDOR_DIR/$1/VERSION" recorded="" latest upstream status
    [ -f "$file" ] && recorded="$(trim "$(tr -d "$CR" <"$file")")"
    if [ "$ref" = latest ]; then
        if latest="$(npm_latest "$source")"; then
            upstream="$latest"
            if [ -z "$recorded" ]; then status=missing; elif [ "$recorded" = "$latest" ]; then status=ok; else status=update; fi
        else
            upstream='?'
            if [ -z "$recorded" ]; then status="missing, unreachable"; else status=unreachable; fi
        fi
    else
        upstream="$ref"
        if [ -z "$recorded" ]; then
            status=missing
        elif [ "$recorded" = "$ref" ]; then
            status="ok (pinned)"
            if latest="$(npm_latest "$source")"; then
                [ "$latest" = "$ref" ] || status="$status, latest $latest"
            else
                status="$status, unreachable"
            fi
        else
            status=update
        fi
    fi
    row "$name" npm "${recorded:--}" "$upstream" "$status"
}

sync_npm() { # <name> <source> <ref> <post>
    local name="$1" source="$2" ref="$3" post="$4" ver cmd
    ver="$ref"
    if [ "$ref" = latest ]; then
        ver="$(npm_latest "$source")" || {
            echo "$name: cannot resolve the latest $source (npm view gave no version)" >&2
            return 1
        }
    fi
    is_version "$ver" || {
        echo "$name: '$ver' is not a version" >&2
        return 1
    }
    cmd="${post//\{ver\}/$ver}"
    echo "$name: $source@$ver"
    (cd "$HOME" && bash -c "$cmd") || {
        echo "$name: post command failed" >&2
        return 1
    }
    # A receipt of what this script installed, not proof the install is still there.
    mkdir -p "$VENDOR_DIR/$name" && printf '%s\n' "$ver" >"$VENDOR_DIR/$name/VERSION"
}

# ── source ──

check_source() { # <name> <source> <ref> <dest>
    local name="$1" source="$2" ref="$3" dir head shown dirty origin remote="" rc upstream=- parts=""
    dir="$(expand_path "$4")"
    if [ ! -e "$dir" ]; then
        row "$name" source - - missing
        return
    fi
    if [ ! -e "$dir/.git" ]; then
        if [ "$source" = - ]; then parts=local; else parts="foreign (not a git checkout)"; fi
        row "$name" source no-git - "$parts"
        return
    fi
    head="$(head_sha "$dir")" || head=""
    shown="${head:0:12}"
    shown="${shown:--}"
    # Lock-free, so reading a checkout never rewrites its index.
    dirty="$(git --no-optional-locks -C "$dir" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
    if [ "$source" = - ]; then
        upstream=local
        parts=local
    else
        origin="$(origin_url "$dir")"
        if [ "$origin" != "$source" ]; then
            row "$name" source "$shown" - "foreign (origin ${origin:-none})"
            return
        fi
        remote="$(remote_ref "$source" "refs/heads/$ref")"
        rc=$?
        case $rc in
            0) upstream="${remote:0:12}" ;;
            1) parts="remote branch missing" ;;
            *)
                upstream='?'
                parts=unreachable
                ;;
        esac
    fi
    [ -n "$head" ] || parts="${parts:+$parts, }no commits"
    [ "$dirty" = 0 ] || parts="${parts:+$parts, }dirty $dirty"
    [ -z "$remote" ] || [ -z "$head" ] || [ "$remote" = "$head" ] || parts="${parts:+$parts, }remote differs"
    row "$name" source "$shown" "$upstream" "${parts:-ok}"
}

sync_source() { # <name> <source> <ref> <dest> <post>
    local name="$1" source="$2" ref="$3" post="$5" dir origin
    dir="$(expand_path "$4")"
    if [ -L "$dir" ] && [ ! -e "$dir" ]; then
        echo "$name: $dir is a dangling symlink; left untouched" >&2
        return 1
    fi
    if [ ! -e "$dir" ]; then
        [ "$source" != - ] || {
            echo "$name: $dir is missing and the entry is local-only; nothing to clone" >&2
            return 1
        }
        echo "$name: cloning $ref into $dir"
        mkdir -p "$(dirname "$dir")" && git clone -q --branch "$ref" "$source" "$dir" || {
            echo "$name: cannot clone $ref of $source" >&2
            return 1
        }
    elif [ "$source" != - ]; then
        [ -e "$dir/.git" ] || {
            echo "$name: $dir exists but is not a git checkout; left untouched" >&2
            return 1
        }
        origin="$(origin_url "$dir")"
        [ "$origin" = "$source" ] || {
            echo "$name: $dir tracks ${origin:-no origin}, not $source; left untouched" >&2
            return 1
        }
    fi
    # Never a git operation on an existing checkout: it may carry unpushed work.
    [ "$post" = - ] && return 0
    echo "$name: building in $dir"
    (cd "$dir" && bash -c "$post") || {
        echo "$name: post command failed" >&2
        return 1
    }
}

row() {
    printf '%-18s %-8s %-14s %-14s %s\n' "$@"
}

# ── main ──

cmd=check
case "${1:-}" in
    check) shift ;;
    sync)
        cmd=sync
        shift
        ;;
    -h | --help)
        usage
        exit 0
        ;;
esac

[ -f "$MANIFEST" ] || die "manifest not found: $MANIFEST"
parse_manifest "$MANIFEST"
[ ! -e "$PRIVATE_MANIFEST" ] || parse_manifest "$PRIVATE_MANIFEST"

if [ "$cmd" = sync ]; then
    [ $# -gt 0 ] || {
        usage >&2
        die "sync needs entry names or --all"
    }
    if [ "$1" = --all ]; then
        [ $# -eq 1 ] || die "--all takes no names"
        cp "$ENTRIES" "$SELECTED"
    else
        for arg; do select_entry "$arg" 1; done
    fi
elif [ $# -eq 0 ]; then
    cp "$ENTRIES" "$SELECTED"
else
    for arg; do select_entry "$arg" 0; done
fi

failures=0
[ "$cmd" = sync ] || row NAME KIND INSTALLED UPSTREAM STATUS
# fd 3, so git, ssh and npx in the loop body cannot swallow the entry list from stdin.
while IFS="$TAB" read -r name kind source ref dest post <&3; do
    if [ "$cmd" = check ]; then
        case "$kind" in
            release | skill) check_git "$name" "$kind" "$source" "$ref" "$dest" ;;
            npm) check_npm "$name" "$source" "$ref" ;;
            source) check_source "$name" "$source" "$ref" "$dest" ;;
        esac
    else
        case "$kind" in
            release | skill) sync_git "$name" "$kind" "$source" "$ref" "$dest" "$post" ;;
            npm) sync_npm "$name" "$source" "$ref" "$post" ;;
            source) sync_source "$name" "$source" "$ref" "$dest" "$post" ;;
        esac || failures=$((failures + 1))
    fi
done 3<"$SELECTED"

[ "$failures" -eq 0 ] || exit 1
