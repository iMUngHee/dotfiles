#!/usr/bin/env bash
if command -v vm_stat &>/dev/null && [[ "$(uname)" == "Darwin" ]]; then
  stats=$(vm_stat)
  page_size=$(echo "$stats" | head -1 | grep -Eo '[0-9]+')
  get_pages() {
    echo "$stats" | awk -v pat="$1" '$0 ~ pat {gsub(/\./,"",$NF); print $NF}'
  }
  anonymous=$(get_pages "Anonymous pages")
  purgeable=$(get_pages "Pages purgeable")
  wired=$(get_pages "Pages wired down")
  compressor=$(get_pages "Pages occupied by compressor")
  used=$(( (anonymous - purgeable + wired + compressor) * page_size ))
  total=$(sysctl -n hw.memsize)
  echo "$used $total" | awk '{printf "%.1f/%.0fG", $1/1073741824, $2/1073741824}'
elif command -v free &>/dev/null; then
  free -b | awk '$1 ~ /Mem/ {printf "%.1f/%.0fG", $3/1073741824, $2/1073741824}'
fi
