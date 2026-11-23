# Mac mini drive-start refresh for the Drivr task board

This launchd job lives on Bud's Mac mini at `~/drivr-glass/`. Worker calls use `/usr/bin/curl` (SecureTransport) so the token is not passed on a process command line and so HTTPS works with the system CA store. It watches TeslaMate MQTT *inside* the existing `teslamate_default` Docker network (via `docker exec teslamate-mosquitto-1 mosquitto_sub`). Port 1883 is **not** published to the host or Tailscale. No Fleet API, Teslemetry, or paid Cloudflare tier. Requires TeslaMate 4.4.0 or newer (this mini is on v4.4.0). Do not change the nav bot or TeslaMate backups for this job.

## Trigger

- A short retained read seeds previous `state` / `shift_state` and does not fire. The live subscribe uses `-R`.
- Fires when `teslamate/cars/1/state` rises to `driving`, or `shift_state` rises to `D` or `R` (whichever comes first). Empty, `nil`, and `P` are not in gear.
- A parked-safe test can publish to `drivr/board/refresh` (does not touch TeslaMate car state).
- 60s cooldown. If the MQTT process drops, the same listener reconnects with backoff and keeps cooldown plus previous-value state.

On trigger: POST `/s/<id>/tasks/refresh` only. This job **never PUTs** a local `task-board.json`. The glass uses SSE as the live path, with a 60s `/tasks` poll only if EventSource is down.

## Files (mode 700 directory, 600 secrets)

- `drive-sync.py` — listener
- `com.budlande.drivr-board-drive-sync.plist` — launchd unit
- `PUSH_TOKEN.local` — bearer token (never print, never commit)
- `GLASS_URL.local` — session open URL (never print, never commit)

## Parked tests (do not shift into Drive)

```bash
# One-shot refresh (no MQTT, no PUT):
/usr/local/bin/python3 ~/drivr-glass/drive-sync.py --now

# MQTT path without changing TeslaMate car state:
docker exec teslamate-mosquitto-1 mosquitto_pub -t drivr/board/refresh -m test

# Log (should show HTTP 200 only, never a token or session URL):
tail -20 ~/Library/Logs/drivr-board-drive-sync.log
```

Then, on the already-paired parked glass, the Task board should update within a few seconds over SSE (or the 60s fallback if SSE is down).
