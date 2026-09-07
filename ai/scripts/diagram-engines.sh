#!/bin/bash
# ai/scripts/diagram-engines.sh — install or update the local diagram engines that the
# `diagram` skill routes to. Engines live outside every tool's skill discovery path
# (~/.claude/skills, ~/.agents/skills), so only the diagram router appears in skill
# listings. Each engine is pinned to a release tag; bump the tag here to update.
#
#   diagram-engines.sh          install or move every engine to its pinned tag, then run doctor
#   diagram-engines.sh --check  print pinned vs latest upstream tag; changes nothing
#
# User-invoked only: ai/scripts/bootstrap.sh never calls this (it must stay offline-safe).
set -euo pipefail

ENGINES_DIR="${DIAGRAM_ENGINES_DIR:-$HOME/.local/share/diagram-engines}"
ARCHIFY_REPO="${ARCHIFY_REPO:-https://github.com/tt-a1i/archify}"
ARCHIFY_TAG="v2.16.0"

CHECK=0
for arg in "$@"; do
    case "$arg" in
        --check) CHECK=1 ;;
        *) echo "usage: $(basename "$0") [--check]" >&2; exit 2 ;;
    esac
done

latest_tag() {
    git ls-remote --tags --refs "$1" 'v*' | awk -F/ '{print $NF}' | sort -V | tail -1
}

# sync_engine <name> <repo> <tag>: clone at the tag, or fetch+checkout it when the clone exists.
sync_engine() {
    local name="$1" repo="$2" tag="$3" dir="$ENGINES_DIR/$1" have
    if [ -d "$dir/.git" ]; then
        have="$(git -C "$dir" describe --tags --exact-match 2>/dev/null || echo unknown)"
        if [ "$have" = "$tag" ]; then
            echo "$name: $tag already installed at $dir"
            return
        fi
        echo "$name: $have -> $tag"
        git -C "$dir" fetch -q --depth 1 origin "refs/tags/$tag:refs/tags/$tag"
        git -C "$dir" checkout -q "$tag"
    else
        mkdir -p "$ENGINES_DIR"
        echo "$name: cloning $tag into $dir"
        git -c advice.detachedHead=false clone -q --depth 1 --branch "$tag" "$repo" "$dir"
    fi
}

if [ "$CHECK" -eq 1 ]; then
    # Assign first: a failing pipeline inside an echo argument would be masked by set -e.
    latest="$(latest_tag "$ARCHIFY_REPO")" || { echo "archify: could not read upstream tags from $ARCHIFY_REPO" >&2; exit 1; }
    [ -n "$latest" ] || { echo "archify: no v* tags found at $ARCHIFY_REPO" >&2; exit 1; }
    echo "archify: pinned $ARCHIFY_TAG, latest upstream $latest"
    exit 0
fi

command -v node >/dev/null || { echo "node >= 18 is required for the archify engine" >&2; exit 1; }
sync_engine archify "$ARCHIFY_REPO" "$ARCHIFY_TAG"
ARCHIFY_UPDATE_CHECK_DISABLED=1 node "$ENGINES_DIR/archify/archify/bin/archify.mjs" doctor | tail -1
