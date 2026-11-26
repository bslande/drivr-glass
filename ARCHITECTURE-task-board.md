# Task board architecture (Drivr glass)

Short design notes for the in-car task board and drive-start refresh, so other bots can review efficiency. This is live on the Workers Free Worker `drivr-glass` as version `2026.11.26-1`. This file lives at the repo root. Deploy from this fork (`bslande/drivr-glass`), not `GlobalTC/drivr-glass`. Never put `PUSH_TOKEN`, a session id, or `*.local` files in git, Pages, or URLs.

## Goal

Show a glanceable, read-only task board on the parked Tesla cabin glass, using the same store as the private Drivr display. Refresh the board when a drive starts, at about $0. Do not require taps while moving, and do not bypass Tesla restrictions. Do not break the existing notes display.

The Cursor Page is a snapshot of the same data. It holds no token or session URL, so it cannot live-fetch the Worker. Do not add a public or loosely shared board feed (it would include personal items).

## Components

| Piece | Where | Role |
| --- | --- | --- |
| Worker `drivr-glass` | Cloudflare Workers Free | Routes, auth, cabin HTML |
| Durable Object `TraceHub`, instance `fleet` | SQLite class, migration tag `v1` already applied — never resend it | Notes *and* the task board in one object |
| Cabin page | Rendered by the Worker, UI `v-task-board-3` | Read-only board + existing Capture notes |
| Mac mini listener | `launchd` `com.budlande.drivr-board-drive-sync`, source in `scripts/macmini/` | On drive start, POST `/tasks/refresh` only — never PUT |
| TeslaMate MQTT | Existing Mosquitto on the mini, Docker network only, TeslaMate **v4.4.0** | Drive-start signal (`state=driving` or `shift_state` `D`/`R`) |
| Cursor Page | Snapshot only | Human-readable board; no live auth |

No D1, KV, Queues, Access, Fleet API, Teslemetry, or paid Cloudflare add-on. Do not publish MQTT 1883, and do not change the nav bot or TeslaMate backups for this work.

## Store (same Durable Object)

Tables `board_tasks`, `board_meta`, and `board_idempotency` live in the existing `TraceHub` SQLite database, beside traces. `/clear` deletes traces only, not the board. The Worker is the live source of truth. Max 80 sanitized tasks (`src/board-tasks.ts`). Columns: `todo`, `doing`, `waiting`, `waiting_richard`, `done`.

Why one object, not a second DO or D1: no extra cold starts, no new free-tier resource, and tasks stay consistent with the notes already served from `fleet`. D1 cannot fan out to open clients. KV is a poor fit (1,000 writes/day Free, 1 write/sec/key, eventual consistency that can lag 60s or more). At this size (tens of rows) a second store would only add cost and failure modes.

## Routes and auth

All content routes require the real `/s/<id>` path. Bare host `/` is 404 and does not leak the session id. A credential in the query string is 400.

| Method | Path | Auth | Effect |
| --- | --- | --- | --- |
| `GET` | `/s/<id>/tasks` | Bearer **or** paired HttpOnly read cookie | JSON board |
| `PATCH` | `/s/<id>/tasks/<taskId>` | Bearer only | Per-item upsert. Body must include `source` and `idempotencyKey`. Replaying the same key is a no-op success. This is the path other bots should use. |
| `PUT` | `/s/<id>/tasks` | Bearer only | Full board replace. **Single-owner path** only (`scripts/sync-task-board.sh`). Do not use this from every bot or from the Mac mini job. |
| `POST` | `/s/<id>/tasks/refresh` | Bearer only | Broadcast current board on SSE; no write |
| `GET` | `/s/<id>`, `/list`, `/events`, `/snapshot` | Same read auth as before | Existing notes paths, unchanged |

Pairing is unchanged: parked browser starts a 180s request, Drivr approves with the bearer token, only that browser gets a read-only cookie. The cabin page fetches `/tasks` same-origin with that cookie. The write token never goes to the car.

## Cabin UI

`src/page.ts`, UI version `v-task-board-3` (bumped so a stale Tesla WebView reloads). The Task board sits above Capture: Waiting on Bud first, then In progress (up to six items, then a “+N more” line). Other columns are a one-line count. Large type, no board buttons, no interaction required while moving. Capture/notes rendering is unchanged. Paired HTML is server-rendered so the board and capture lists are visible if cabin JS never runs, with a no-JS `?nojs=1` 30-second meta refresh that script disables once it takes over. Cabin JS stays ES5-safe (XHR fallback, 8s poll if EventSource does not open in 5s) and caps UI-version reloads at one per 60 seconds.

## How the glass stays current

While the page is **visible**:

1. **SSE is the live path.** `GET /events` (25s keepalive) sends a notes `snapshot` and a `tasks` event on connect. `PATCH`, `PUT`, and `POST /tasks/refresh` broadcast `tasks` to open clients. Notes still arrive as `trace` / `snapshot`.
2. **No 5-second polls.** A 60-second fallback poll of `/list` and `/tasks` runs only while the page is visible **and** EventSource is down.
3. **Visibility / pageshow.** The page still refetches `/list` and `/tasks` when it becomes visible and on `pageshow`.
4. **Close SSE when hidden.** `visibilitychange` to hidden closes EventSource so the Durable Object can drop the connection and stop accruing duration. It reopens when the page is visible again. (Whether Tesla’s browser fires `visibilitychange` is unverified; the 60s fallback covers a dropped SSE while the page stays visible.)

If the glass is not open, nothing is pushed into the car. That is intentional.

## Mac mini listener

Source: `scripts/macmini/` (`drive-sync.py`, launchd plist, README). Installed at `~/drivr-glass/` on the mini (directory mode 700; `PUSH_TOKEN.local` and `GLASS_URL.local` mode 600, never in git). TeslaMate on this mini is **v4.4.0** (meets the 4.4.0+ requirement).

- Subscribes with `docker exec teslamate-mosquitto-1 mosquitto_sub`. Port 1883 is **not** published to the host or Tailscale. Mosquitto stays on the existing `teslamate_default` network.
- A short retained read (no `-R`) seeds `prev_state` / `prev_shift` and does **not** fire. Live subscribe then uses `-R` so retained messages are not replayed as events.
- First message for each topic is also treated as a seed if it was not already seeded (covers a live message before retained seed finishes).
- Fires on whichever rising edge comes first: `state` becomes `driving`, or `shift_state` becomes `D` or `R`. Empty, `nil`/`null`/`none`, and `P` are not in gear. 60-second cooldown.
- If `mosquitto_sub` or `docker exec` drops, the same process reconnects with exponential backoff (2–60s) and **keeps** the cooldown and previous-value state. `launchd` KeepAlive is only a last resort if the process itself exits.
- On trigger, POST `/tasks/refresh` only. **Never PUT** a local `task-board.json`.
- Parked tests: `drive-sync.py --now`, or publish to `drivr/board/refresh`. Do not publish fake values on the TeslaMate car topics.
- HTTP uses `/usr/bin/curl` (macOS SecureTransport). The token is not placed on a process command line.
- Logs status codes and counts only, never the token or session URL.

## Costs (expected: about $0)

Uses only the existing Workers Free plan and TeslaMate already running on the mini.

[Workers Free](https://developers.cloudflare.com/workers/platform/pricing/) is 100k Worker req/day, 100k DO req/day, and 13,000 GB-s/day. [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) are 200k events/day. Trace sampling is **10%** (`observability.traces.head_sampling_rate = 0.1`), down from 100%.

| Pattern (1 cabin page) | Req / 2h drive | Req / 24h open | Duration / 2h | Duration / 24h |
| --- | ---: | ---: | ---: | ---: |
| Previous: SSE + 5s `/tasks` and `/list` | ~2,880 Worker and DO | ~34,560 (~35% of 100k) | ~922 GB-s | ~11,059 GB-s (~85% of 13k) |
| Current: SSE + 60s fallback only if SSE is down + fetch on visible + close SSE when hidden | typically a few (connect, visibility, drive-start poke); worst ~240 if SSE stays down the whole drive | typically low; worst ~2,880 if SSE stays down 24h | ~922 GB-s if SSE stays up while visible; ~0 if closed when hidden | still ~11,059 if SSE is left up 24h; ~0 if the page is closed or hidden and the browser actually closes the socket |

The duration cap is still the tight constraint if a visible glass tab is left streaming all day (~85% of 13k GB-s). Closing the glass (or relying on hide-to-close) is what protects that cap. Workers Paid ($5/mo) is not needed if the stream is not left open 24h.

- **Storage and row ops.** Tens of task rows are negligible against 5M row reads/day, 100k writes/day, and 5 GB.
- **Drive-start refresh.** A few Worker/DO requests per trip.
- **Not used (would cost or add vendors):** Tesla Fleet API, Teslemetry, Cloudflare paid plan, Access, a public unauthenticated tasks URL, or publishing MQTT off the Docker network.

## Efficiency notes for review

1. **SSE first, 60s fallback only when down, close on hide.** This was the main fix from the 23 Nov 2026 review. It cuts the request budget from ~35% of the Free cap (24h open with 5s dual polls) to typically a handful of requests, and it gives duration a chance to drop when the page is hidden.
2. **Same SQLite DO, no D1/KV.** Unchanged, and still the right call.
3. **PATCH with `source` and an idempotency key**, instead of every bot doing a whole-board PUT. Full PUT stays for one owner so two close replaces cannot clobber each other as easily.
4. **Mac mini job never PUTs.** It only pokes SSE for an already-open page whose stream may have gone silent.
5. **Cursor Page stays a snapshot.** A live Page would need a token in the Page or a public board endpoint. Both are worse.
6. **WebSocket hibernation is a later option**, not now: Tesla already drops SSE, and in-car WebSocket support is unverified.
7. **Growing the glass to more Grok Bot areas.** Prefer adding columns or glanceable sections on this board, written with PATCH, over new Workers, DOs, or per-bot routes.

## Parked tests

See `scripts/macmini/README.md`. Open the already-paired glass while parked, then run `drive-sync.py --now` or publish to `drivr/board/refresh`. Confirm `POST /tasks/refresh -> HTTP 200` in `~/Library/Logs/drivr-board-drive-sync.log` with no token or session URL in the log. Confirm Capture notes still display.
