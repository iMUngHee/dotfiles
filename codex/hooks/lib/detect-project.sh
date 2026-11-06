#!/usr/bin/env bash
# Shared project detection utility for Codex quality hooks.

detect_project_root() {
  git rev-parse --show-toplevel 2>/dev/null || true
}

# Usage: portable_timeout <seconds> <command> [args...]
# Ends the command's whole process tree at the deadline, not just the command:
# rustc under cargo, test runners under a suite. Exit 124 on expiry.
portable_timeout() {
  local secs="$1"; shift
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) ;; # Windows Git Bash: MSYS emulates fork/setpgrp, unverified there — GNU below
    *)
      if command -v perl &>/dev/null; then
        # A supervisor, not `alarm; exec` (which signalled only the exec'd
        # process). The child leads its own process group, as under GNU
        # timeout. On expiry, or on TERM/INT/HUP sent to the supervisor,
        # signal that group, give it up to 2 s, then KILL and reap. Exit 124
        # on expiry, 128+n on a forwarded signal. The four signals stay
        # blocked from before fork until handlers, group and alarm exist, so
        # an early one waits instead of killing the supervisor; the child
        # restores default handlers and the old mask before exec. Cleanup
        # runs once: the first reason wins and later signals are ignored.
        perl -e '
          use POSIX ();
          my $s = shift;
          my $old = POSIX::SigSet->new;
          POSIX::sigprocmask(POSIX::SIG_BLOCK(), POSIX::SigSet->new(POSIX::SIGTERM(), POSIX::SIGINT(), POSIX::SIGHUP(), POSIX::SIGALRM()), $old);
          my ($pid, $ending);
          my $end = sub {
            my ($sig, $code) = @_;
            return if $ending++;
            alarm 0; $SIG{$_} = "IGNORE" for qw(TERM INT HUP ALRM);
            kill $sig, -$pid;
            for (1 .. 20) { waitpid $pid, 1; last unless kill 0, -$pid; select undef, undef, undef, 0.1 }
            kill "KILL", -$pid; waitpid $pid, 0; exit $code;
          };
          $SIG{ALRM} = sub { $end->("TERM", 124) };
          $SIG{TERM} = sub { $end->("TERM", 143) };
          $SIG{INT}  = sub { $end->("INT", 130) };
          $SIG{HUP}  = sub { $end->("HUP", 129) };
          $pid = fork; defined $pid or die "fork: $!";
          if (!$pid) {
            $SIG{$_} = "DEFAULT" for qw(TERM INT HUP ALRM);
            setpgrp(0, 0); POSIX::sigprocmask(POSIX::SIG_SETMASK(), $old);
            exec { $ARGV[0] } @ARGV; exit 127;
          }
          setpgrp($pid, $pid);
          alarm $s;
          POSIX::sigprocmask(POSIX::SIG_SETMASK(), $old);
          waitpid $pid, 0;
          exit($? & 127 ? 128 + ($? & 127) : $? >> 8);
        ' "$secs" "$@"
        return
      fi ;;
  esac
  # GNU timeout signals the command's process group; -k 2 adds KILL, but only
  # while the direct child lives, so a TERM-ignoring descendant of a parent
  # that died on TERM survives. Windows and perl-less hosts accept that gap.
  timeout -k 2 "$secs" "$@"
}

file_checksum() {
  local file="$1"
  if command -v md5sum &>/dev/null; then
    md5sum "$file" 2>/dev/null | awk '{print $1}'
  elif command -v md5 &>/dev/null; then
    md5 -q "$file" 2>/dev/null
  else
    shasum -a 256 "$file" 2>/dev/null | awk '{print $1}'
  fi
}

# toml_edition <Cargo.toml> <section>: the edition one section declares, a year,
# or `workspace` for `edition.workspace = true` and `edition = { workspace = true }`.
# Per section, so `[workspace.package]` and `[package]` in one file never mix.
toml_edition() {
  awk -v want="$2" -v q="'" '
    { sub(/\r$/, "") }  # a CRLF Cargo.toml (Windows)
    /^[[:space:]]*\[/ {
      sec = $0
      sub(/^[[:space:]]*\[[[:space:]]*/, "", sec)
      sub(/[[:space:]]*\].*$/, "", sec)
      next
    }
    sec != want { next }
    /^[[:space:]]*edition[[:space:]]*\.[[:space:]]*workspace[[:space:]]*=[[:space:]]*true/ { print "workspace"; exit }
    /^[[:space:]]*edition[[:space:]]*=/ {
      v = $0
      sub(/^[^=]*=[[:space:]]*/, "", v)
      if (v ~ /^\{/) { if (v ~ /workspace[[:space:]]*=[[:space:]]*true/) print "workspace"; exit }
      if (match(v, "^[\"" q "][0-9]+[\"" q "]")) print substr(v, 2, RLENGTH - 2)
      exit
    }
  ' "$1" 2>/dev/null
}

# cargo_edition <file>: the edition of the crate <file> belongs to, as Cargo reads
# it. The nearest Cargo.toml with a [package] decides: its own `edition`, or the
# workspace root's [workspace.package] one when it inherits. Prints nothing for
# 2015, the default of Cargo and rustfmt alike. Always returns 0, for set -e.
cargo_edition() {
  local dir parent ed=""
  dir=$(cd "$(dirname "$1")" 2>/dev/null && pwd) || return 0
  # parent == dir ends a climb at / and at MSYS's // root alike.
  while ! { [[ -f "$dir/Cargo.toml" ]] && grep -q '^[[:space:]]*\[package\]' "$dir/Cargo.toml"; }; do
    parent=$(dirname "$dir")
    [[ "$parent" == "$dir" ]] && return 0
    dir=$parent
  done
  ed=$(toml_edition "$dir/Cargo.toml" package) || ed=""
  if [[ "$ed" == workspace ]]; then
    ed=""
    while :; do
      if [[ -f "$dir/Cargo.toml" ]]; then
        ed=$(toml_edition "$dir/Cargo.toml" workspace.package) || ed=""
        [[ "$ed" == workspace ]] && ed=""
        [[ -n "$ed" ]] && break
      fi
      parent=$(dirname "$dir")
      [[ "$parent" == "$dir" ]] && break
      dir=$parent
    done
  fi
  [[ -n "$ed" ]] && printf '%s\n' "$ed"
  return 0
}

detect_checker() {
  local file="$1" root="$2"
  CHECK_CMD="" LANG_LABEL="" FMT_CMD=""

  case "$file" in
    *.ts|*.tsx)
      if [[ -f "$root/tsconfig.json" ]] && [[ -f "$root/node_modules/.bin/tsc" ]]; then
        CHECK_CMD="npx tsc --noEmit --pretty 2>&1"
        LANG_LABEL="tsc"
      fi
      if command -v npx &>/dev/null && [[ -f "$root/node_modules/.bin/prettier" ]]; then
        FMT_CMD="npx prettier --write"
      fi
      ;;
    *.js|*.jsx|*.json|*.css|*.scss)
      if command -v npx &>/dev/null && [[ -f "$root/node_modules/.bin/prettier" ]]; then
        FMT_CMD="npx prettier --write"
      fi
      ;;
    *.go)
      if [[ -f "$root/go.mod" ]]; then
        CHECK_CMD="go vet ./... 2>&1"
        LANG_LABEL="go vet"
      fi
      command -v gofmt &>/dev/null && FMT_CMD="gofmt -w"
      ;;
    *.rs)
      # No checker: compiling Rust belongs to each project (its CI, or the
      # rust skill's clippy loop). A global gate cannot know a workspace's
      # layout, toolchain or build time. Only the formatter runs here.
      # Bare rustfmt formats as edition 2015 and reflows a 2024 crate's
      # untouched lines; cargo fmt knows the edition but formats the whole
      # crate. So rustfmt on the one file, with the crate's edition.
      if command -v rustfmt &>/dev/null; then
        local edition
        edition=$(cargo_edition "$file")
        FMT_CMD="rustfmt${edition:+ --edition $edition}"
      fi
      ;;
    *.py)
      if command -v ruff &>/dev/null; then
        FMT_CMD="ruff format"
      elif command -v black &>/dev/null; then
        FMT_CMD="black -q"
      fi
      ;;
    *.lua)
      command -v stylua &>/dev/null && FMT_CMD="stylua"
      ;;
  esac
  # Explicit: otherwise the status of a `command -v <formatter> && ...` above
  # leaks out, and a missing formatter aborts a caller running under set -e.
  return 0
}
