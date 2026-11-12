#!/bin/bash
# lib/aws-cli.sh — AWS CLI v2 at a pinned version under ~/.local/opt, linked into
# ~/.local/bin, for the macOS package layer.
#
# Sourced, not executed. Same shape as lib/rust-analyzer.sh.
#
# Not from Homebrew, which carries only the latest release: the S3-compatible
# store this CLI is used against supports 2.17.21 on macOS and warns that other
# releases may fail. That build is x86_64 only, so Apple Silicon runs it under
# Rosetta 2. The official .pkg installs for the current user only (-target
# CurrentUserHomeDirectory plus a choices file naming the folder), so no sudo;
# the download is checked against a pinned sha256 on top of the package's own
# Developer ID signature. Install only when absent; moving the pin is a
# decision, not a side effect of a deploy.
#
# Profiles, endpoints and keys live in ~/.aws, never in this repo.

if ! declare -F warn >/dev/null 2>&1; then
    warn() { echo "⚠ $1"; }
fi

AWS_CLI_VERSION="${AWS_CLI_VERSION:-2.17.21}"
AWS_CLI_PKG_SHA256="${AWS_CLI_PKG_SHA256:-9582c48e0aec00cfe2f12a13d21cbfe5b1cddd4ce9fb7ac49bea333e8117fabe}"

ensure_aws_cli() {
    [ "$(uname -s)" = Darwin ] || return 0
    local bin="${LOCAL_BIN:-$HOME/.local/bin}"
    local dest="$HOME/.local/opt/aws-cli-$AWS_CLI_VERSION"
    if [ -x "$dest/aws-cli/aws" ]; then
        echo "aws-cli $AWS_CLI_VERSION present — skip ($dest)"
    else
        echo "── aws-cli $AWS_CLI_VERSION ──"
        local tmp
        tmp="$(mktemp -d)"
        if ! curl -fsSL --retry 2 -o "$tmp/AWSCLIV2.pkg" \
            "https://awscli.amazonaws.com/AWSCLIV2-$AWS_CLI_VERSION.pkg"; then
            warn "aws-cli: download failed"
        elif [ "$(shasum -a 256 "$tmp/AWSCLIV2.pkg" | awk '{print $1}')" != "$AWS_CLI_PKG_SHA256" ]; then
            warn "aws-cli: sha256 mismatch — not installed"
        else
            # The installer creates aws-cli/ inside customLocation, which must exist.
            mkdir -p "$dest"
            cat >"$tmp/choices.xml" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <array>
    <dict>
      <key>choiceAttribute</key>
      <string>customLocation</string>
      <key>attributeSetting</key>
      <string>$dest</string>
      <key>choiceIdentifier</key>
      <string>default</string>
    </dict>
  </array>
</plist>
EOF
            installer -pkg "$tmp/AWSCLIV2.pkg" -target CurrentUserHomeDirectory \
                -applyChoiceChangesXML "$tmp/choices.xml" >/dev/null ||
                warn "aws-cli: installer failed"
        fi
        rm -rf "$tmp"
    fi
    if [ -x "$dest/aws-cli/aws" ]; then
        mkdir -p "$bin"
        ln -sfn "$dest/aws-cli/aws" "$bin/aws"
        # A link that cannot run (no Rosetta) would pass every `command -v aws`.
        if ! "$bin/aws" --version >/dev/null 2>&1; then
            rm -f "$bin/aws"
            warn "aws-cli: 'aws --version' failed — unlinked"
        fi
    fi
}
