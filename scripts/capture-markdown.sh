#!/usr/bin/env bash
# Pull an authenticated Markdown snapshot onto this computer.
# Run later, beside the glass. It does not clear notes and it does not print them.
# Usage: ./scripts/capture-markdown.sh /absolute/path/drivr-capture.md
set -euo pipefail
source "$(dirname "$0")/glass-config.sh"
glass_load capture-markdown || exit $?
OUT="${1:-}"
if [[ -z "$OUT" || "$OUT" != /* ]]; then
  echo "capture-markdown: pass an absolute output path; refusing" >&2
  exit 2
fi
umask 077
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
code="$(curl -sS -o "$tmp" -w '%{http_code}' "$SESSION_BASE/snapshot" -H "Authorization: Bearer $TOKEN")"
if [[ "$code" != "200" ]]; then
  echo "capture-markdown: snapshot HTTP $code; refusing to write" >&2
  exit 1
fi
install -m 600 "$tmp" "$OUT"
echo "capture-markdown: wrote $(wc -c < "$OUT" | tr -d ' ') bytes"
