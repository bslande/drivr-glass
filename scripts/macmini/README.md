# Mac mini drive-start refresh for the Drivr task board

This launchd job lives on Bud's Mac mini at `~/drivr-glass/`. Worker calls use `/usr/bin/curl` (SecureTransport) so the token is not passed on a process command line and so HTTPS works with the system CA store. It watches TeslaMate MQTT *inside* the existing `teslamate_default` Docker network (via `docker exec teslamate-mosquitto-1 mosquitto_sub`). Port 1883 is **not** published to the host or Tailscale. No Fleet API, Teslemetry, or paid Cloudflare tier.

## Trigger

- `teslamate/cars/1/state` changes to `driving`, or
- `teslamate/cars/1/shift_state` changes to `D` or `R`, or
- a parked-safe test publish to `drivr/board/refresh` (does not touch TeslaMate car state)

On trigger (60s cooldown): if `task-board.json` is present *and* its `updatedAt` is newer than the Worker board, PUT it; then POST `/s/<id>/tasks/refresh` so an open glass page updates over SSE. The glass also polls `GET /tasks` every 5 seconds while it is open.

The Worker is the live store. The optional local JSON file is only applied when it is newer, so a stale copy will not overwrite a newer board.

## Files (mode 700 directory, 600 secrets)

- `drive-sync.py` — listener
- `com.budlande.drivr-board-drive-sync.plist` — launchd unit
- `PUSH_TOKEN.local` — bearer token (never print)
- `GLASS_URL.local` — session open URL (never print)
- `task-board.json` — optional source file

## Parked tests (do not shift into Drive)

```bash
# One-shot refresh (no MQTT):
/usr/local/bin/python3 ~/drivr-glass/drive-sync.py --now

# MQTT path without changing TeslaMate car state:
docker exec teslamate-mosquitto-1 mosquitto_pub -t drivr/board/refresh -m test

# Log (should show HTTP 200 only, never a token or session URL):
tail -20 ~/Library/Logs/drivr-board-drive-sync.log
```

Then, on the already-paired parked glass, the Task board should update within a few seconds (SSE or the 5s poll).
