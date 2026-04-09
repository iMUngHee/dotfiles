#!/usr/bin/env bash
# SubagentStop hook: inject Subagent Trust reminder into main context
# Outputs additionalContext so Claude sees the reminder after every subagent completion
# Always exits 0

INPUT=$(cat)
AGENT_TYPE=$(echo "$INPUT" | jq -r '.agent_type // "unknown"' 2>/dev/null)

cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "SubagentStop",
    "additionalContext": "[subagent-trust] ${AGENT_TYPE} completed. Per DEVGUARD rules: (1) Review git diff — check every removed line for silent behavioral changes (2) Cross-verify research claims with independent tool calls (3) 'No issues found' reports may be incomplete"
  }
}
EOF

exit 0
