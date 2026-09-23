#!/usr/bin/env bash
set -euo pipefail

API_BASE="${1:-http://localhost:8080}"

show_action() {
  local action="$1"
  echo
  echo "=== ${action} ==="
  curl -fsS -X POST "${API_BASE}/api/fault-tolerance/action?action=${action}" | python3 -m json.tool
}

echo "Fault-tolerance demo against ${API_BASE}"
curl -fsS "${API_BASE}/api/fault-tolerance" | python3 -m json.tool
show_action reset
show_action append
show_action fail-primary
show_action append
show_action recover-primary

echo
echo "The final response should show Pune as the promoted primary, Mumbai rejoined, and the degraded event replayed."
