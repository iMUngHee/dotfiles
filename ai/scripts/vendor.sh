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

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENDOR_DIR="${AI_VENDOR_DIR:-$HOME/.local/share/ai-vendor}"
MANIFEST="${AI_VENDOR_MANIFEST:-$SCRIPT_DIR/vendor.manifest}"
PRIVATE_MANIFEST="$VENDOR_DIR/private.manifest"
TIMEOUT="${AI_VENDOR_TIMEOUT:-20}"
CR="$(printf '\r')"
TAB="$(printf '\t')"

# A remote lookup must never sit on a prompt: no credential UI, no SSH passphrase.
export GIT_TERMINAL_PROMPT=0
export GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh} -o BatchMode=yes"

# Windows (Git Bash): make ln -s create a real NTFS symlink or fail. MSYS's default
# silently copies, which would freeze a linked skill at the version it was copied at.
case "$(uname -s)" in
    MINGW* | MSYS*) export MSYS="${MSYS:+$MSYS }winsymlinks:nativestrict" ;;
esac

WORK="$(mktemp -d "${TMPDIR:-/tmp}/vendor.XXXXXX")" || {
    echo "vendor: cannot create a temp dir" >&2
    exit 2
}
trap 'rm -rf "$WORK"' EXIT
ENTRIES="$WORK/entries"
SELECTED="$WORK/selected"
: >"$ENTRIES"
: >"$SELECTED"

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

# Character sets are spelled out or use classes, never ranges: under macOS bash 3.2
# and most UTF-8 locales [a-z] collates as aAbB…, so it would let uppercase through.
is_sha() {
    [ "${#1}" -eq 40 ] || return 1
    case "$1" in *[!0123456789abcdef]*) return 1 ;; esac
}

is_glob() {
    case "$1" in *[*?[]*) return 0 ;; esac
    return 1
}

is_abs() {
    case "$1" in
        /* | "~" | "~/"* | [[:alpha:]]:/*) return 0 ;; # [[:alpha:]]:/ — a Windows path in a Git Bash manifest
    esac
    return 1
}

# ── manifest ──

validate() { # <where> <name> <kind> <source> <ref> <dest> <post>
    local at="$1" name="$2" kind="$3" source="$4" ref="$5" dest="$6" post="$7"
    case "$name" in
        [[:lower:][:digit:]]*) ;;
        *) die "$at: bad name '$name' (start with a-z or 0-9)" ;;
    esac
    case "$name" in *[![:lower:][:digit:]._-]*) die "$at: bad name '$name' (use a-z 0-9 . _ -)" ;; esac
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
    while IFS= read -r line || [ -n "$line" ]; do
        n=$((n + 1))
        line="${line%"$CR"}"
        trimmed="${line#"${line%%[![:space:]]*}"}"
        case "$trimmed" in '' | '#'*) continue ;; esac
        name='' kind='' source='' ref='' dest='' post=''
        # A here-doc, not `set -- $trimmed`, so a glob ref like v* is never expanded.
        read -r name kind source ref dest post <<EOF
$trimmed
EOF
        [ -n "$post" ] || die "$file:$n: expected 6 fields (name kind source ref dest post); use - for an empty one"
        validate "$file:$n" "$name" "$kind" "$source" "$ref" "$dest" "$post"
        if cut -f1 "$ENTRIES" | grep -Fqx -- "$name"; then
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

# limited <out> <cmd...>: run a remote lookup with its stdout in <out>, killing it
# after $TIMEOUT seconds (status 124). macOS ships no timeout(1), hence the poll.
# Output goes to a file, not a pipe, so a child that outlives the kill cannot hold
# this script open.
limited() {
    local out="$1" pid ticks=0
    shift
    "$@" >"$out" 2>/dev/null </dev/null &
    pid=$!
    while kill -0 "$pid" 2>/dev/null; do
        if [ "$ticks" -ge $((TIMEOUT * 10)) ]; then
            kill "$pid" 2>/dev/null
            wait "$pid" 2>/dev/null
            return 124
        fi
        sleep 0.1
        ticks=$((ticks + 1))
    done
    wait "$pid"
}

# Newest tag matching <glob>, skipping prereleases (a `-` after the glob's literal
# prefix, as in v2.0.0-rc.1). Prints nothing when no tag matches.
latest_tag() { # <url> <glob>
    local out="$WORK/ls" prefix="${2%%[*?[]*}" tag
    limited "$out" git ls-remote --tags --refs "$1" "$2" || return
    tr -d "$CR" <"$out" | awk -F/ '{ print $NF }' | while IFS= read -r tag; do
        case "${tag#"$prefix"}" in *-*) ;; *) printf '%s\n' "$tag" ;; esac
    done | sort -V | tail -n 1
}

remote_ref() { # <url> <ref> -> sha
    local out="$WORK/ls" sha
    limited "$out" git ls-remote "$1" "$2" || return
    sha="$(tr -d "$CR" <"$out" | awk 'NR == 1 { print $1 }')"
    [ -n "$sha" ] || return 1
    printf '%s\n' "$sha"
}

npm_latest() { # <package>
    local out="$WORK/npm"
    limited "$out" npm view "$1" version || return
    tr -d "$CR" <"$out" | awk 'NF { v = $0 } END { print v }'
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

skill_home() { # claude | agents
    case "$1" in
        claude) printf '%s\n' "$HOME/.claude/skills" ;;
        agents) printf '%s\n' "$HOME/.agents/skills" ;;
    esac
}

link_state() { # <link> <target> -> linked | missing | conflict
    if [ -L "$1" ]; then
        if [ "$(readlink "$1")" = "$2" ]; then
            echo linked
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
    local name="$1" kind="$2" source="$3" ref="$4" dest="$5" dir head tags installed upstream status latest remote tool unlinked="" conflict=""
    dir="$(entry_dir "$name" "$kind" "$dest")"
    head="$(head_sha "$dir")" || head=""
    tags=""
    [ -n "$head" ] && tags="$(head_tags "$dir")"
    installed="$(printf '%s\n' "$tags" | tail -n 1)"
    [ -n "$installed" ] || installed="${head:0:12}"
    [ -n "$installed" ] || installed=-

    if is_sha "$ref"; then
        upstream="${ref:0:12}"
        if [ -z "$head" ]; then
            status=missing
        elif [ "$head" = "$ref" ]; then
            status="ok (pinned)"
            if remote="$(remote_ref "$source" HEAD)"; then
                [ "$remote" = "$ref" ] || status="$status, upstream moved ${remote:0:12}"
            else
                status="$status, unreachable"
            fi
        else
            status=update
        fi
    elif is_glob "$ref"; then
        if latest="$(latest_tag "$source" "$ref")"; then
            upstream="${latest:-?}"
            if [ -z "$head" ]; then
                status=missing
            elif [ -n "$latest" ] && printf '%s\n' "$tags" | grep -Fqx -- "$latest"; then
                status=ok
            else
                status=update
            fi
        else
            upstream='?'
            if [ -z "$head" ]; then status="missing, unreachable"; else status=unreachable; fi
        fi
    else
        upstream="$ref"
        if [ -z "$head" ]; then
            status=missing
        elif printf '%s\n' "$tags" | grep -Fqx -- "$ref"; then
            status="ok (pinned)"
            if latest="$(latest_tag "$source" "${ref%%[0-9]*}*")"; then
                [ -z "$latest" ] || [ "$latest" = "$ref" ] || status="$status, latest $latest"
            else
                status="$status, unreachable"
            fi
        else
            status=update
        fi
    fi

    if [ "$kind" = skill ] && [ -n "$head" ]; then
        for tool in claude agents; do
            case "$(link_state "$(skill_home "$tool")/$name" "$dir/$dest")" in
                missing) unlinked="${unlinked:+$unlinked }$tool" ;;
                conflict) conflict="${conflict:+$conflict }$tool" ;;
            esac
        done
        [ -z "$conflict" ] || status="$status, conflict: $conflict"
        [ -z "$unlinked" ] || status="$status, unlinked: $unlinked"
    fi
    row "$name" "$kind" "$installed" "$upstream" "$status"
}

# fetch_ref <dir> <ref>: bring <ref> (a tag or a SHA) into the clone and check it out.
fetch_ref() {
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
        git -C "$dir" -c advice.detachedHead=false checkout -q "$ref"
    else
        git -C "$dir" fetch -q --depth 1 origin "refs/tags/$ref:refs/tags/$ref" &&
            git -C "$dir" -c advice.detachedHead=false checkout -q "refs/tags/$ref"
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
            conflict)
                echo "$name: $link exists and is not this skill's link; left untouched" >&2
                failed=1
                ;;
        esac
    done
    return "$failed"
}

sync_git() { # <name> <kind> <source> <ref> <dest> <post>
    local name="$1" kind="$2" source="$3" ref="$4" dest="$5" post="$6" dir target head origin
    dir="$(entry_dir "$name" "$kind" "$dest")"
    target="$ref"
    if is_glob "$ref"; then
        target="$(latest_tag "$source" "$ref")" || {
            echo "$name: cannot read tags from $source" >&2
            return 1
        }
        [ -n "$target" ] || {
            echo "$name: no tag matches $ref at $source" >&2
            return 1
        }
    fi

    if [ -e "$dir/.git" ]; then
        origin="$(git -C "$dir" remote get-url origin 2>/dev/null)"
        [ "$origin" = "$source" ] || {
            echo "$name: $dir tracks ${origin:-no origin}, not $source; left untouched" >&2
            return 1
        }
    elif [ -e "$dir" ] && [ -n "$(ls -A "$dir" 2>/dev/null)" ]; then
        echo "$name: $dir exists but is not a git clone; left untouched" >&2
        return 1
    else
        mkdir -p "$dir" && git -C "$dir" init -q && git -C "$dir" remote add origin "$source" || return 1
    fi

    head="$(head_sha "$dir")" || head=""
    if { is_sha "$target" && [ "$head" = "$target" ]; } ||
        { ! is_sha "$target" && [ -n "$head" ] && head_tags "$dir" | grep -Fqx -- "$target"; }; then
        echo "$name: already at $target"
    else
        echo "$name: ${head:+${head:0:12} }-> $target"
        fetch_ref "$dir" "$target" || {
            echo "$name: cannot fetch $target from $source" >&2
            return 1
        }
    fi

    if [ "$post" != - ]; then
        (cd "$dir" && bash -c "$post") || {
            echo "$name: post command failed" >&2
            return 1
        }
    fi
    if [ "$kind" = skill ]; then
        [ -d "$dir/$dest" ] || {
            echo "$name: $dest not found in the clone" >&2
            return 1
        }
        link_skill "$name" "$dir/$dest"
    fi
}

# ── npm ──

check_npm() { # <name> <source> <ref>
    local name="$1" source="$2" ref="$3" file="$VENDOR_DIR/$1/VERSION" recorded="" latest upstream status
    [ -f "$file" ] && recorded="$(tr -d "$CR\n" <"$file")"
    if [ "$ref" = latest ]; then
        if latest="$(npm_latest "$source")" && [ -n "$latest" ]; then
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
            if latest="$(npm_latest "$source")" && [ -n "$latest" ]; then
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
        ver="$(npm_latest "$source")" && [ -n "$ver" ] || {
            echo "$name: cannot resolve the latest $source" >&2
            return 1
        }
    fi
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
    local name="$1" source="$2" ref="$3" dir head dirty origin remote="" upstream=- status="" parts=""
    dir="$(expand_path "$4")"
    if [ ! -e "$dir" ]; then
        row "$name" source - - missing
        return
    fi
    if [ ! -e "$dir/.git" ]; then
        if [ "$source" = - ]; then status=local; else status="foreign (not a git checkout)"; fi
        row "$name" source no-git - "$status"
        return
    fi
    head="$(head_sha "$dir")" || head=""
    dirty="$(git --no-optional-locks -C "$dir" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
    if [ "$source" = - ]; then
        upstream=local
        parts=local
    else
        origin="$(git -C "$dir" remote get-url origin 2>/dev/null)"
        if [ "$origin" != "$source" ]; then
            row "$name" source "${head:0:12}" - "foreign (origin ${origin:-none})"
            return
        fi
        if remote="$(remote_ref "$source" "refs/heads/$ref")"; then
            upstream="${remote:0:12}"
        else
            upstream='?'
        fi
    fi
    [ "$dirty" = 0 ] || parts="${parts:+$parts, }dirty $dirty"
    [ "$upstream" = local ] || [ "$upstream" = '?' ] || [ "$remote" = "$head" ] || parts="${parts:+$parts, }remote differs"
    [ "$upstream" != '?' ] || parts="${parts:+$parts, }unreachable"
    row "$name" source "${head:0:12}" "$upstream" "${parts:-ok}"
}

sync_source() { # <name> <source> <ref> <dest> <post>
    local name="$1" source="$2" ref="$3" post="$5" dir origin
    dir="$(expand_path "$4")"
    if [ ! -e "$dir" ]; then
        [ "$source" != - ] || {
            echo "$name: $dir is missing and the entry is local-only; nothing to clone" >&2
            return 1
        }
        echo "$name: cloning $ref into $dir"
        mkdir -p "$(dirname "$dir")" && git clone -q --branch "$ref" "$source" "$dir" || return 1
    elif [ "$source" != - ]; then
        [ -e "$dir/.git" ] || {
            echo "$name: $dir exists but is not a git checkout; left untouched" >&2
            return 1
        }
        origin="$(git -C "$dir" remote get-url origin 2>/dev/null)"
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
[ ! -f "$PRIVATE_MANIFEST" ] || parse_manifest "$PRIVATE_MANIFEST"

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
