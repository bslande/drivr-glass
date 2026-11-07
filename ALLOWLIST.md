# Allowlist export — drivr-glass companion

- Export date: 2026-11-05 (America/Denver)
- Version: 2026.11.07-1
- Source: owner live Worker tree (not a git repo); built by **allowlist copy**, never copy+delete.
- Everything not listed here was never copied (secrets `*.local`, `.cf-account-id`, `.wrangler/`, `node_modules/`, `*-backup*`, `merge-2026-10-27/`, `preview/`, `redirect/` + `wrangler.screenr-redirect.jsonc` (owner-only legacy redirect), `scripts/local-check.mjs` + `scripts/tap-check.mjs` (owner-box tooling paths, preview fixtures), `.mode-on`).

| Path | Origin |
|---|---|
| `.gitignore` | keeps *.local |
| `ALLOWLIST.md` | this file |
| `LICENSE` | new MIT |
| `README.md` | rewritten for importers |
| `VERSION` | new |
| `constitution-rules.json` | verbatim (roles only) |
| `docs/deploy-free-tier.md` | owner free-tier deploy steps (no secrets) |
| `docs/plain-fetch-readability.md` | rewritten: reads require auth; Grok plain fetch blocked |
| `package-lock.json` | regenerated 2026-11-05 (npm install, deps: typescript, wrangler) |
| `package.json` | rewritten (no owner absolute wrangler path, no puppeteer) |
| `scripts/clear-glass.sh` | rewritten: GLASS_URL.local instead of owner pinned-endpoint helper |
| `scripts/glass-config.sh` | new: shared config loader |
| `scripts/capture-markdown.sh` | authenticated snapshot pull; writes a mode-600 file; prints no notes |
| `scripts/heartbeat.sh` | refused: this glass accepts only note, todo, and idea |
| `scripts/smoke.sh` | rewritten: GLASS_URL.local; adds bare-404 + snapshot checks |
| `src/constitution.ts` | verbatim |
| `src/index.ts` | verbatim |
| `src/page.ts` | Drivr notes/to-dos/ideas; login gate has no notes |
| `src/read-auth.ts` | bearer + HttpOnly cookie; no token in URL or logs |
| `src/sanitize.ts` | owner-private term regex → PRIVATE_TERMS_RE placeholder |
| `src/snapshot.ts` | verbatim |
| `src/trace-hub.ts` | verbatim |
| `src/ui-ver.ts` | v-private-read-1 |
| `test/env.d.ts` | vitest env typing |
| `test/glass.spec.ts` | unauth, auth read/write, retention, clear |
| `test/tsconfig.json` | test types |
| `vitest.config.ts` | workers vitest plugin; fixture token is not a deploy secret |
| `tsconfig.json` | verbatim |
| `worker-configuration.d.ts` | verbatim (generated types; no ids) |
| `wrangler.jsonc` | scrubbed (no account_id, placeholder GLASS_SESSION_ID, relative $schema) |
