# Deploy drivr-glass on the Workers Free plan

Deploy this fork (`bslande/drivr-glass`) from your computer. Do not deploy `GlobalTC/drivr-glass`. The Worker bundle contains no token. You create the token locally and pass it to Wrangler on stdin.

Checked against Cloudflare docs on 2026-11-07:

- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
- [Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Workers traces](https://developers.cloudflare.com/workers/observability/traces/)
- [Observability traces FAQ](https://developers.cloudflare.com/observability/traces/) (header values are not span attributes; URLs and query strings are)
- [Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/)

## Free-plan resources this deploy creates

`npx wrangler deploy` provisions only what `wrangler.jsonc` declares:

| Resource | What it is | Free-plan note |
| --- | --- | --- |
| Worker `drivr-glass` | The script, on your `workers.dev` subdomain | Free plan. Requests past the daily allowance fail; they are not billed. |
| Durable Object `TraceHub` | SQLite class, migration `v1`, one instance named `fleet` | Free plan allows SQLite-backed Durable Objects only. Included: 100,000 requests/day, 13,000 GB-s/day, 5 million rows read/day, 100,000 rows written/day, 5 GB stored. Past a limit, that operation fails until 00:00 UTC. Free plan is not charged. |
| Var `GLASS_SESSION_ID` | Path id, not the password | Plain var in `wrangler.jsonc`. Do not publish the URL. |
| Secret `PUSH_TOKEN` | Read and write password | `wrangler secret put` only. Not in git, the URL, or the bundle. |
| Logs and traces | `observability.enabled` and `observability.traces.enabled` | Workers Logs on Free: 200,000 events/day, 3-day retention until 2026-12-01, then the account observability allowance (Free stops at 0.5 GB/day ingested; it does not add a charge). |

No KV, R2, D1, Queues, Access, Zero Trust, custom domain, or paid add-on. Do not switch the account to Workers Paid for this app. The Paid plan has a $5 monthly minimum.

An open browser SSE connection keeps the Durable Object awake. One 128 MB object held for 24 hours is about 11,000 GB-s, close to the free daily duration. Close the glass when you are not using it. A second all-day connection can exhaust the day; later requests fail until the UTC reset.

## Before you deploy

1. Confirm the dashboard account is the Workers **Free** plan.
2. Confirm `npx wrangler whoami` is that same account. A Cloudflare connector session on another machine is not this deploy.
3. Use Node.js 20+.

## Steps

```bash
git clone https://github.com/bslande/drivr-glass.git
cd drivr-glass
git fetch origin
git checkout <this-pr-branch>
npm ci
npm test
```

`npm test` does not contact Cloudflare.

Generate the id and token on this computer. Do not paste either into chat, a prompt, or a log.

```bash
umask 077
openssl rand -hex 10 > GLASS_SESSION_ID.local
openssl rand -base64 32 | tr -d '\n' > PUSH_TOKEN.local
chmod 600 GLASS_SESSION_ID.local PUSH_TOKEN.local
```

Replace `REPLACE_ME_GLASS_SESSION_ID` in `wrangler.jsonc` `vars.GLASS_SESSION_ID` with the contents of `GLASS_SESSION_ID.local`. Leave `account_id` unset and do not commit the id if you push the fork. Do not commit `*.local`.

```bash
npx wrangler login
npx wrangler whoami
npx wrangler deploy
npx wrangler secret put PUSH_TOKEN < PUSH_TOKEN.local
```

`wrangler secret put` reads stdin and deploys a version. The shell must not echo the file (`set +x` is already the default; do not run this under `set -x`).

```bash
umask 077
echo "https://drivr-glass.<your-subdomain>.workers.dev/s/$(cat GLASS_SESSION_ID.local)" > GLASS_URL.local
chmod 600 GLASS_URL.local
./scripts/smoke.sh
./scripts/clear-glass.sh
```

Smoke must show anonymous HTML, `/snapshot`, and `/list` as HTTP 401, then bearer reads as 200, then one note push. `clear-glass.sh` removes that note. Both scripts refuse a URL that is not `GLASS_URL.local`.

## Later Markdown copy on this computer

This does not clear the glass and does not print notes. Run it whenever you want a file beside the live store:

```bash
./scripts/capture-markdown.sh /absolute/path/outside/the/repo/drivr-capture.md
```

The output file is mode 600. It is an authenticated pull. It does not notify in-car Grok.

## Parked browser pairing (you only)

No Tesla test was run to produce this package. Do not do this while the car is moving. Do not bypass the car's browser lock. Do not type `PUSH_TOKEN` into the browser, hand it to Grok, or put it in a URL. In-car direct fetch of the snapshot is unsupported.

1. Park, with the vehicle UI allowing the browser.
2. Open the open URL from `GLASS_URL.local`. You should see the pairing page, not your notes, and no token field.
3. Tap **Pair this browser**. The page shows a request id and a three-word phrase. Those are not a password. The page checks for approval about every 5 seconds and stops after about 3 minutes, or as soon as pairing finishes.
4. On your computer, tell Drivr the request id and phrase exactly as shown. Drivr approves that one request with the bearer token from `PUSH_TOKEN.local`. Drivr must not approve any other id.
5. The waiting browser reloads into the notes. Reload and reconnect must not clear them. The cookie cannot push or clear.
6. If the phrase expires, pair again. Do not weaken auth to skip this.
7. A direct in-car fetch, including Grok opening the snapshot URL, stays HTTP 401. That is not automatic awareness.
8. Clear only by `./scripts/clear-glass.sh` or the bot's session-start `POST /clear`.

Drivr approval, from the computer, after you confirm the id and phrase:

```bash
curl -sS -X POST "$(cat GLASS_URL.local)/pair/approve" \
  -H "Authorization: Bearer $(cat PUSH_TOKEN.local)" \
  -H "Content-Type: application/json" \
  -d '{"requestId":"REQUEST_ID","phrase":"word word word"}'
```

Replace the id and phrase from the parked screen. Do not log the command with `set -x`. The bearer value stays in the local file.

## Local bundle check

From this repo, without credentials:

```bash
npx wrangler deploy --dry-run --outdir dist/dry-run
```

Confirm the output directory contains no `PUSH_TOKEN` value and no `*.local` file before you deploy for real.
