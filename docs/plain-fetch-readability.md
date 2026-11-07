# Design note — plain-fetch readability (`/snapshot`)

**Trigger:** An in-car assistant that fetches the interactive glass URL as plain text sees no usable content.

## Why

- `GET /s/<id>` returns HTML chrome only after authorization. Live notes, to-dos, and ideas are filled in by client JS from `GET /s/<id>/list` + SSE `/s/<id>/events`.
- `/list` returns raw JSON traces, but not a prose-friendly summary.

## Design

`GET /s/<GLASS_SESSION_ID>/snapshot` is a **read twin** of the same TraceHub store:

- Default `text/plain; charset=utf-8` — Constitution, then nested To-dos, Ideas, and Notes (newest item is the face bullet; older items of that kind are indented under it).
- `Accept: application/json` or `?format=json` → `{ui, generatedAt, constitution, capture, research, fleet, traces}`.
- Valid session id required; bare `/snapshot` → 404; wrong id → 404; `Cache-Control: no-store`.
- **Authorization required.** Bearer token, or the HttpOnly cookie from `POST /s/<id>/session`. Anonymous reads are 401 and contain no notes. A token in the query string is 400.
- The header states that the snapshot is an authenticated pull. It does not make in-car Grok aware.

## In-car Grok and the Tesla browser

Plain fetch cannot send `Authorization` or the sign-in cookie, and the token must not be placed in the URL or in chat. That retrieval path is **blocked**. Do not treat a 401 as a temporary outage and do not open the snapshot to make the assistant able to read it.

A Tesla browser can try the parked login form. This repository's tests demonstrate the cookie in the Workers runtime only. They do not demonstrate a Tesla browser or in-car Grok. If the parked test fails, leave the read blocked.

## Clear

The store survives refresh, SSE reconnect, and Durable Object eviction. `POST /clear` with the bearer token is the only wipe.

## Non-goals

- Don't break SSE / the nested capture cards.
- Don't put the token in the URL, source, or logs.
- Don't announce the bare host.
- Don't claim the assistant is watching the glass.
