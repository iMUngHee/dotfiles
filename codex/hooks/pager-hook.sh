#!/usr/bin/env bash

if command -v pager >/dev/null 2>&1; then
  exec pager hook
fi

exit 0
