# Task board architecture (Drivr glass)

Short design notes for the in-car task board and drive-start refresh, so other bots can review efficiency. This is already live on the Workers Free Worker `drivr-glass` as version `2026.11.23-2`. Deploy from this fork (`bslande/drivr-glass`), not `GlobalTC/drivr-glass`. Never put `PUSH_TOKEN`, a session id, or `*.local` files in git, Pages, or URLs.

## Goal

Show a glanceable, read-only task board on the parked Tesla cabin glass, using the same store as the private Drivr display. Refresh the board when a drive starts, at about $0. Do not require taps while moving, and do not bypass Tesla restrictions. Do not break the existing notes display.

The Cursor Page is a snapshot of the same data. It holds no token or session URL, so it cannot live-fetch the Worker.

## Components

| Piece | Where | Role |
| --- | --- | --- |
| Worker `drivr-glass` | Cloudflare Workers Free | Routes, auth, cabin HTML |
| Durable Object `TraceHub`, instance `fleet` | SQLite class, migration tag `v1` already applied — never resend it | Notes *and* the task board in one object |
| Cabin page | Rendered by the Worker | Read-only board + existing Capture notes |
| Mac mini listener | `launchd` `com.budlande.drivr-board-drive-sync`, source in `scripts/macmini/` | On drive start, maybe PUT a newer local board, then POST `/tasks/refresh` |
| TeslaMate MQTT | Existing Mosquitto on the mini, Docker network only | Drive-start signal (`state=driving` or `shift_state` `D`/`R`) |
| Cursor Page | Snapshot only | Human-readable board; no live auth |

No D1, KV, Queues, Access, Fleet API, Teslemetry, or paid Cloudflare add-on.

## Store (same Durable Object)

Tables `board_tasks` and `board_meta` live in the existing `TraceHub` SQLite database, beside traces. `/clear` deletes traces only, not the board. The Worker is the live source of truth. Max 80 sanitized tasks (`src/board-tasks.ts`). Columns: `todo`, `doing`, `waiting`, `waiting_richard`, `done`.

An optional `task-board.json` on the Mac mini (or any machine with the local token file) may be PUT only when its `updatedAt` is newer than the Worker board, so a stale file cannot overwrite newer data. The checked-in `scripts/task-board.example.json` is a format sample only. Do not commit a live board that includes personal items.

Why one object, not a second DO or D1: no extra cold starts, no new free-tier resource, and tasks stay consistent with the notes already served from `fleet`. At this size (tens of rows) a second store would only add cost and failure modes.

## Routes and auth

All content routes require the real `/s/<id>` path. Bare host `/` is 404 and does not leak the session id. A credential in the query string is 400.

| Method | Path | Auth | Effect |
| --- | --- | --- | --- |
| `GET` | `/s/<id>/tasks` | Bearer **or** paired HttpOnly read cookie | JSON board |
| `PUT` | `/s/<id>/tasks` | Bearer only | Replace board (sanitized), then SSE `tasks` |
| `POST` | `/s/<id>/tasks/refresh` | Bearer only | Broadcast current board on SSE; no write |
| `GET` | `/s/<id>`, `/list`, `/events`, `/snapshot` | Same read auth as before | Existing notes paths, unchanged |

Pairing is unchanged: parked browser starts a 180s request, Drivr approves with the bearer token, only that browser gets a read-only cookie. The cabin page fetches `/tasks` same-origin with that cookie. The write token never goes to the car.

## Cabin UI

`src/page.ts`, UI version `v-task-board-1` (bumped so a stale Tesla WebView reloads). The Task board sits above Capture: Waiting on Bud first, then In progress (up to six items, then a “+N more” line). Other columns are a one-line count. Large type, no board buttons, no interaction required while moving. Capture/notes rendering is unchanged.

## How the glass stays current

While the page is open:

1. **SSE.** On connect, the Worker sends the existing `snapshot` of notes and a `tasks` event with the current board. `PUT /tasks` and `POST /tasks/refresh` broadcast `tasks` to open clients.
2. **Poll.** The page already polls `GET /list` every 5 seconds (Tesla WebViews often drop SSE). It also polls `GET /tasks` on that same interval, plus on `visibilitychange` and `pageshow`.
3. **Drive start.** The Mac mini listener triggers `POST /tasks/refresh` so an open page updates immediately over SSE, without waiting for the next poll and without a Fleet API.

If the glass is not open, nothing is pushed into the car. That is intentional.

## Mac mini listener

Source: `scripts/macmini/` (`drive-sync.py`, launchd plist, README). Installed at `~/drivr-glass/` on the mini (directory mode 700; `PUSH_TOKEN.local` and `GLASS_URL.local` mode 600, never in git).

- Subscribes with `docker exec teslamate-mosquitto-1 mosquitto_sub`. Port 1883 is **not** published to the host or Tailscale. Mosquitto stays on the existing `teslamate_default` network.
- Fires on a transition to `teslamate/cars/1/state driving`, or `shift_state` `D`/`R`, with a 60-second cooldown. A parked test can publish to `drivr/board/refresh` or run `drive-sync.py --now`. Do not publish fake values on the TeslaMate car topics just to test.
- HTTP to the Worker uses `/usr/bin/curl` (macOS SecureTransport). The token is not placed on a process command line. (The Mac’s python.org `urllib` has no CA bundle.)
- Logs status codes and counts only, never the token or session URL.

## Costs (expected: about $0)

Uses only the existing Workers Free plan and TeslaMate already running on the mini.

- **Worker / Durable Object requests.** An open glass already polls `/list` every 5s. Adding `/tasks` on the same interval roughly doubles those polls. A two-hour drive is on the order of 3,000 extra requests, well under the Free daily 100,000 DO request allowance. Drive-start refresh is a few requests per trip.
- **DO duration.** Unchanged rule from `docs/deploy-free-tier.md`: an open SSE connection keeps `TraceHub` awake. Close the glass when it is not in use. This work does not add a second object.
- **Storage.** Tens of task rows are negligible against the 5 GB Free SQLite cap.
- **Observability.** Already enabled on this Worker before the task board. Not added here. Free ingestion still applies; see the existing free-tier doc (allowance, not a bill).
- **Not used (would cost or add vendors):** Tesla Fleet API, Teslemetry, Cloudflare paid plan ($5 minimum), Access, a public unauthenticated tasks URL, or publishing MQTT off the Docker network.

## Efficiency notes for review

These are the main tradeoffs. Suggestions that keep the $0 constraint and parked-safe UI are welcome.

1. **5-second `/tasks` poll vs. SSE-only or a slower poll.** The poll exists because Tesla WebViews drop EventSource. The board changes rarely, so a 15–30s tasks poll (keeping 5s for `/list`) would cut request volume with little user-visible delay, especially since drive-start already pokes SSE. Combining `/list` and `/tasks` into one payload would also halve polls, at the cost of a larger notes payload and a slightly wider API change.
2. **Same DO vs. a separate store.** One object is cheaper and simpler at this scale. Split only if task writes ever need to be isolated from notes durability.
3. **`docker exec` vs. binding Mosquitto to `127.0.0.1:1883`.** Exec avoids opening a broker port, at a small process-overhead cost. Localhost-only publish would be reasonable, but it is not required.
4. **Cursor Page stays a snapshot.** A live Page would need either a token in the Page or a public board endpoint. Both are worse than a periodic bot/session edit from a local token file.
5. **Growing the glass to more Grok Bot areas.** The same glanceable, read-only section pattern (large type, priority groups, no driving interaction) can cover other bot work. Prefer adding columns or sections on this board over new Workers, DOs, or per-bot routes, unless there is a clear isolation or quota reason.

## Parked tests

See `scripts/macmini/README.md`. Open the already-paired glass while parked, then run `drive-sync.py --now` or publish to `drivr/board/refresh`. Confirm `POST /tasks/refresh -> HTTP 200` in `~/Library/Logs/drivr-board-drive-sync.log` with no token or session URL in the log.
