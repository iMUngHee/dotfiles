#!/usr/bin/env bash

if command -v gaebu >/dev/null 2>&1; then
  exec gaebu hook codex
fi

exit 0
