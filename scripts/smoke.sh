#!/usr/bin/env bash
# Smoke: bare host 404 → health → snapshot 200 → SSE listen → push → SSE receives marker.
# Reads GLASS_URL.local + PUSH_TOKEN.local. Token never printed. Leaves one smoke card; run clear-glass.sh after.
set -euo pipefail
source "$(dirname "$0")/glass-config.sh"
glass_load smoke "${1:-}" || exit $?
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

echo "== bare host must 404 =="
code="$(curl -sS -o /dev/null -w '%{http_code}' "$HOST_BASE/")"
echo "GET / -> HTTP $code"; [[ "$code" == "404" ]]

echo "== health =="
code="$(curl -sS -o "$TMP/health" -w '%{http_code}' "$HOST_BASE/health")"
echo "HTTP $code body=$(cat "$TMP/health")"; [[ "$code" == "200" && "$(cat "$TMP/health")" == "ok" ]]

echo "== open + snapshot + list without auth are rejected =="
for p in "" "/snapshot" "/list"; do
  code="$(curl -sS -o "$TMP/unauth" -w '%{http_code}' "$SESSION_BASE$p")"
  echo "GET <session>$p -> HTTP $code"; [[ "$code" == "401" ]]
  if grep -q "Smoke test" "$TMP/unauth"; then echo "unauth body leaked a smoke note" >&2; exit 1; fi
done

echo "== open + snapshot with bearer =="
for p in "" "/snapshot"; do
  code="$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" "$SESSION_BASE$p")"
  echo "GET <session>$p -> HTTP $code"; [[ "$code" == "200" ]]
done

MARKER="smoke-$(date +%s)"
echo "== sse listen (background) =="
timeout 20 curl -sS -N -H "Authorization: Bearer $TOKEN" -H 'Accept: text/event-stream' "$SESSION_BASE/events" > "$TMP/sse" &
SSE_PID=$!
sleep 2

echo "== push =="
push_resp="$(curl -sS -X POST "$SESSION_BASE/push" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"bot\":\"Drivr\",\"summary\":\"Smoke test $MARKER\",\"detail\":\"Automated smoke\",\"kind\":\"note\"}")"
echo "$push_resp" | head -c 400; echo
echo "$push_resp" | grep -q '"ok":true'

echo "== wait for sse =="
for _ in $(seq 1 16); do
  if grep -q "$MARKER" "$TMP/sse" 2>/dev/null; then
    kill "$SSE_PID" 2>/dev/null || true; wait "$SSE_PID" 2>/dev/null || true
    echo "SSE received marker"; echo "SMOKE OK"; exit 0
  fi
  sleep 1
done
kill "$SSE_PID" 2>/dev/null || true; wait "$SSE_PID" 2>/dev/null || true
echo "SSE did not show marker." >&2; exit 1
