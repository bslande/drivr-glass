# Drivr cabin glass — companion Worker (`drivr-glass`)

Optional, self-hosted **cabin glass** for the Drivr Grok Bot template: a driving-safe web page that mirrors Drivr captures (notes, to-dos, ideas) and live bot activity in large type, plus a plain-text `/snapshot` the in-car assistant can read. Cloudflare Worker + one SQLite Durable Object (`TraceHub`). Version: see `VERSION`. License: MIT.

**The glass is optional.** Drivr captures work without it. If you skip this, Drivr runs capture-only.

You deploy **your own** copy to **your own** Cloudflare account. Nothing here points at anyone else's Worker.

## What you'll end up with

- Open URL (what the car browser may display after a parked sign-in): `https://drivr-glass.<your-subdomain>.workers.dev/s/<GLASS_SESSION_ID>`
- Snapshot URL (authenticated pull only): `…/s/<GLASS_SESSION_ID>/snapshot`
- Bare host `https://drivr-glass.<your-subdomain>.workers.dev/` returns **404** and never redirects, so it can't leak your session id. Never share or speak the bare host as the open line.
- The session id in the path is not a password. HTML, `/list`, `/snapshot`, and `/events` reject anonymous requests. Notes are not readable without the bearer token or a cookie from `POST /session`.

Deployment steps and free-tier resources: `docs/deploy-free-tier.md`.

Examples below use `https://drivr-glass.example.workers.dev/s/REPLACE_ME_GLASS_SESSION_ID`.

## Prerequisites

- A free Cloudflare account with a `workers.dev` subdomain.
- Node.js 20+ and npm.

## Setup

### 1. Install

```bash
cd drivr-glass
npm install
```

### 2. Generate your ids (never reuse anyone else's)

```bash
umask 077
openssl rand -hex 10 > GLASS_SESSION_ID.local      # path id (obscurity, not the secret)
openssl rand -base64 32 | tr -d '\n' > PUSH_TOKEN.local   # the push secret
chmod 600 GLASS_SESSION_ID.local PUSH_TOKEN.local
```

Both files are gitignored (`*.local`). **Never paste the token into chat, memory, a skill, a trace, or a log.** Keep it in a mode-600 `.local` file (or a password vault) only.

### 3. Configure `wrangler.jsonc`

- Replace `REPLACE_ME_GLASS_SESSION_ID` in `vars.GLASS_SESSION_ID` with the contents of `GLASS_SESSION_ID.local`.
- Account: run `npx wrangler login` (recommended), or add `"account_id": "<your account id>"` locally. Don't commit your account id if you publish your fork.
- Optional: change `"name"` if you want a different Worker name (the host becomes `<name>.<subdomain>.workers.dev`).

### 4. Deploy, then set the secret

```bash
npx wrangler deploy
npx wrangler secret put PUSH_TOKEN < PUSH_TOKEN.local
```

`wrangler deploy` prints your host. Write the full open URL (host + `/s/<id>`) to `GLASS_URL.local`:

```bash
echo "https://drivr-glass.<your-subdomain>.workers.dev/s/$(cat GLASS_SESSION_ID.local)" > GLASS_URL.local
chmod 600 GLASS_URL.local
```

### 5. Smoke test

```bash
./scripts/smoke.sh        # bare host 404, /health ok, open + /snapshot 200, push arrives over SSE
./scripts/clear-glass.sh  # wipe the smoke card
```

Then open the open URL on your phone or car browser and confirm the empty glass loads.

### 6. Tell Drivr

Give Drivr the **open URL only** (not the token). Drivr saves it in memory as `Drivr glass URL: <open URL>` and the token path as `Drivr glass token file: <absolute path to PUSH_TOKEN.local>`. The `drivr-getting-started` skill walks through this.

## Routes

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/` | **404** (no redirect; does not disclose session id) |
| `GET` | `/s/<id>` | Notes HTML when authorized. Otherwise **401** login shell with no notes |
| `POST` | `/s/<id>/pair` | Parked browser starts a short-lived pairing. Response shows a request id and phrase. The write token is not accepted here |
| `GET` | `/s/<id>/pair/wait` | That same browser polls only while the pairing is pending. On approval it receives a read-only HttpOnly cookie |
| `POST` | `/s/<id>/pair/approve` | Bearer only. Drivr sends the exact request id and phrase the owner read on the screen |
| `POST` | `/s/<id>/session` | **410.** A browser cannot submit the write token |
| `GET` | `/s/<id>/events` | SSE stream when authorized (`text/event-stream`) |
| `GET` | `/s/<id>/list` | JSON snapshot when authorized |
| `GET` | `/s/<id>/snapshot` | Plain text (default) or JSON (`?format=json`) when authorized |
| `POST` | `/s/<id>/push` (or `/push`) | Bearer write. Cookie alone is not enough |
| `POST` | `/s/<id>/clear` (or `/clear`) | Bearer wipe. Cookie alone is not enough. This is the only clear |
| `GET` | `/health` | Plain `ok` |

Bare `/events`, `/list`, `/snapshot` → 404. Wrong `/s/<id>` → 404. Missing or wrong auth on a real session → **401** and no note text. A credential in the query string → **400**. Refresh, SSE reconnect, and Durable Object eviction do not clear notes.

Parked browser login does not use the write token. The owner taps **Pair this browser**, reads the request id and phrase on that screen, and tells Drivr those two lines. Drivr approves that exact pair with the bearer token from `PUSH_TOKEN.local` on the computer. Only the waiting browser receives the read cookie. The id and phrase are not a password. In-car direct fetch is unsupported. The page polls only during that wait, then stops.

## Push contract

`POST <open URL>/push` with `Authorization: Bearer <token>` and JSON:

```json
{"bot":"Drivr","summary":"Need to call the dentist Tuesday about the cleaning.","kind":"todo","status":"open"}
```

| Field | Required | Limits |
|-------|----------|--------|
| `bot` | yes | must be `Drivr` |
| `summary` | yes | ≤ 280 — brief narrative, not a title slug |
| `detail` | no | ≤ 4000 — expanded body |
| `result` | no | ≤ 4000 — preferred expanded body |
| `from` | no | ≤ 40 |
| `status` | no | ≤ 24 — `open`, `done`, `working`, … |
| `kind` | yes | `note`, `todo`, or `idea` only |
| `ts` | no | ISO-8601; omit → server now |

Mark done: re-push the same `summary` + `kind` with `"status":"done"`. Success: `201 {"ok":true,"trace":{…}}`. Errors: `401` unauthorized, `400` validation / sanitize reject.

**Privacy:** the server sanitizes on ingest — it rejects or strips emails, token-like strings, `/home/...` paths and medical wording. Add your own private terms in `src/sanitize.ts` (`PRIVATE_TERMS_RE`). Never push secrets or health details.

**Named bots:** `src/page.ts` `BOT_NAMES` lists bot names (lowercase) that render as named fleet cards. It ships with `drivr` only; add your own bots.

Example:

```bash
TOKEN="$(cat PUSH_TOKEN.local)"
curl -sS -X POST "$(cat GLASS_URL.local)/push" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"bot":"Drivr","summary":"What if we drip-irrigate the tomatoes this spring?","kind":"idea","status":"open"}'
```

## SSE events

`EventSource` on `/s/<id>/events`: `snapshot` (`{traces: Trace[]}`, up to ~50 newest first), `trace` (one new trace), `: keepalive` comments ~every 25s.

## Storage

Durable Object `TraceHub` (SQLite), instance `fleet`. Keeps the last ~50 traces. Nothing in the Worker clears them on page load, SSE reconnect, or eviction. Clear only by an explicit bearer `POST /clear` (Drivr does that at session start, or when you ask). A later Markdown copy on the bot computer is `scripts/capture-markdown.sh`; it reads the same store and does not clear it. The glass does not push notes to in-car Grok.

## Rotating your id or token

New id: generate a new `GLASS_SESSION_ID.local`, update `vars.GLASS_SESSION_ID`, `npx wrangler deploy`, rewrite `GLASS_URL.local`, update Drivr's memory line. The old `/s/<old-id>` then 404s. New token: regenerate `PUSH_TOKEN.local`, `npx wrangler secret put PUSH_TOKEN < PUSH_TOKEN.local`.

## Local checks

```bash
npx wrangler types   # regenerates worker-configuration.d.ts if you change bindings
npx tsc --noEmit
npm test             # unauth rejected, bearer read/write, cookie read, retention, clear
```
