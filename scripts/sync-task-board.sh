#!/usr/bin/env bash
# PUT the task board JSON to the live glass Worker. Reads GLASS_URL.local + PUSH_TOKEN.local.
# Never prints the token or the session URL.
set -euo pipefail
source "$(dirname "$0")/glass-config.sh"
glass_load sync-task-board || exit $?
JSON="${1:-}"
if [[ -z "$JSON" || "$JSON" != /* || ! -f "$JSON" ]]; then
  echo "sync-task-board: pass an absolute path to a task-board JSON file; refusing" >&2
  exit 2
fi
out="$(mktemp)"
trap 'rm -f "$out"' EXIT
code="$(curl -sS -o "$out" -w '%{http_code}' -X PUT "$SESSION_BASE/tasks" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" --data-binary @"$JSON")"
echo "PUT <session>/tasks -> HTTP $code"
if [[ "$code" != "200" ]]; then
  echo "sync-task-board: failed; response redacted" >&2
  exit 1
fi
# Print only ok/count, never raw board in case a future field is sensitive
python3 - "$out" << 'PY'
import json,sys
data=json.load(open(sys.argv[1]))
print("ok=", data.get("ok"), "count=", data.get("count"))
PY
echo "SYNC OK"
