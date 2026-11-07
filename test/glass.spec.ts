import { env } from "cloudflare:workers";
import { createExecutionContext, runInDurableObject, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src/index";

function sid(): string {
  return env.GLASS_SESSION_ID;
}

function token(): string {
  return env.PUSH_TOKEN;
}

function sessionUrl(path = ""): string {
  return `http://example.com/s/${sid()}${path}`;
}

async function call(url: string, init?: RequestInit): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(url, init) as Request<unknown, IncomingRequestCfProperties>,
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

async function openEvents(): Promise<string> {
  const ac = new AbortController();
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(sessionUrl("/events"), {
      headers: bearer({ "x-glass-once": "1" }),
      signal: ac.signal,
    }) as Request<unknown, IncomingRequestCfProperties>,
    env,
    ctx,
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type") || "").toContain("text/event-stream");
  const text = await response.text();
  ac.abort();
  await waitOnExecutionContext(ctx);
  return text;
}

function bearer(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set("Authorization", `Bearer ${token()}`);
  return headers;
}

async function push(summary: string, kind: string, ts: string): Promise<Response> {
  return call(sessionUrl("/push"), {
    method: "POST",
    headers: bearer({ "Content-Type": "application/json" }),
    body: JSON.stringify({ bot: "Drivr", summary, kind, status: "open", ts }),
  });
}

describe("private drivr glass", () => {
  it("rejects unauthenticated reads and writes with no note text", async () => {
    const marker = "unauth-marker-note";
    const created = await push(marker, "note", "2026-11-07T15:00:00.000Z");
    expect(created.status).toBe(201);

    const html = await call(sessionUrl("/"));
    const htmlBody = await html.text();
    expect(html.status).toBe(401);
    expect(htmlBody).toContain("Parked setup only");
    expect(htmlBody).not.toContain(marker);
    expect(htmlBody).not.toContain(token());

    const snapshot = await call(sessionUrl("/snapshot"));
    expect(snapshot.status).toBe(401);
    expect(await snapshot.text()).toBe("unauthorized");

    const list = await call(sessionUrl("/list"));
    expect(list.status).toBe(401);
    expect(await list.text()).not.toContain(marker);

    const events = await call(sessionUrl("/events"));
    expect(events.status).toBe(401);
    expect(events.headers.get("Content-Type") || "").not.toContain("text/event-stream");

    const pushed = await call(sessionUrl("/push"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bot: "Drivr", summary: "nope", kind: "note" }),
    });
    expect(pushed.status).toBe(401);

    const cleared = await call(sessionUrl("/clear"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(cleared.status).toBe(401);

    const wrong = await call(sessionUrl("/snapshot"), {
      headers: { Authorization: "Bearer wrong-token" },
    });
    expect(wrong.status).toBe(401);

    const still = await call(sessionUrl("/list"), { headers: bearer() });
    const stillBody = await still.json() as { traces: { summary: string }[] };
    expect(stillBody.traces.some((t) => t.summary === marker)).toBe(true);
  });

  it("allows bearer read and write, and cookie read without cookie write", async () => {
    const summary = "Call the shop about the filter";
    const created = await push(summary, "todo", "2026-11-07T16:00:00.000Z");
    expect(created.status).toBe(201);

    const list = await call(sessionUrl("/list"), { headers: bearer() });
    expect(list.status).toBe(200);
    const listed = await list.json() as { traces: { summary: string }[] };
    expect(listed.traces.some((t) => t.summary === summary)).toBe(true);

    const snap = await call(sessionUrl("/snapshot"), { headers: bearer() });
    expect(snap.status).toBe(200);
    const text = await snap.text();
    expect(text).toContain("## To-dos");
    expect(text).toContain(summary);
    expect(text).toContain("authenticated pull only");
    expect(text).not.toContain(token());

    const page = await call(sessionUrl("/"), { headers: bearer() });
    expect(page.status).toBe(200);
    const pageBody = await page.text();
    expect(pageBody).toContain("clamp(1.75rem, 5.2vw, 2.8rem)");
    expect(pageBody).toContain("do not tap this screen while driving");
    expect(pageBody).not.toContain(token());

    const login = await call(sessionUrl("/session"), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "token=" + encodeURIComponent(token()),
    });
    expect(login.status).toBe(303);
    const setCookie = login.headers.get("Set-Cookie") || "";
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).not.toContain(token());
    const cookiePair = setCookie.split(";")[0];

    const viaCookie = await call(sessionUrl("/snapshot"), { headers: { Cookie: cookiePair } });
    expect(viaCookie.status).toBe(200);
    expect(await viaCookie.text()).toContain(summary);

    const cookiePush = await call(sessionUrl("/push"), {
      method: "POST",
      headers: { Cookie: cookiePair, "Content-Type": "application/json" },
      body: JSON.stringify({ bot: "Drivr", summary: "cookie-must-not-write", kind: "note" }),
    });
    expect(cookiePush.status).toBe(401);

    const leaked = await call(sessionUrl("/snapshot?token=" + encodeURIComponent(token())));
    expect(leaked.status).toBe(400);
    const leakedBody = await leaked.text();
    expect(leakedBody).not.toContain(token());
    expect(leakedBody).not.toContain(summary);

    const missing = await call(`http://example.com/s/not-the-session/snapshot`, { headers: bearer() });
    expect(missing.status).toBe(404);

    const otherBot = await push("Other bot note", "note", "2026-11-07T16:01:00.000Z");
    // push() always sends bot Drivr. Send a foreign bot directly.
    expect(otherBot.status).toBe(201);
    const foreign = await call(sessionUrl("/push"), {
      method: "POST",
      headers: bearer({ "Content-Type": "application/json" }),
      body: JSON.stringify({ bot: "Scout", summary: "not drivr", kind: "note" }),
    });
    expect(foreign.status).toBe(400);
    const research = await call(sessionUrl("/push"), {
      method: "POST",
      headers: bearer({ "Content-Type": "application/json" }),
      body: JSON.stringify({ bot: "Drivr", summary: "digest", kind: "research" }),
    });
    expect(research.status).toBe(400);
  });

  it("keeps notes across refresh, reconnect, and eviction, and clears only on explicit auth", async () => {
    const older = "Older nested todo";
    const newer = "Newest face todo";
    expect((await push(older, "todo", "2026-11-07T17:00:00.000Z")).status).toBe(201);
    expect((await push(newer, "todo", "2026-11-07T18:00:00.000Z")).status).toBe(201);
    expect((await push("A parked idea", "idea", "2026-11-07T18:05:00.000Z")).status).toBe(201);

    const first = await call(sessionUrl("/list"), { headers: bearer() });
    const firstBody = await first.json() as { traces: { summary: string }[] };
    const count = firstBody.traces.length;
    expect(firstBody.traces.some((t) => t.summary === newer)).toBe(true);

    // evictDurableObject waits out in-flight Durable Object I/O in this Vitest pool,
    // so this test reads the SQLite rows directly and then repeats the HTTP list and SSE snapshot.
    const stub = env.TRACE_HUB.getByName("fleet");
    await runInDurableObject(stub, async (_instance, state) => {
      const rows = state.storage.sql
        .exec<{ summary: string }>("SELECT summary FROM traces")
        .toArray();
      expect(rows.some((row) => row.summary === newer)).toBe(true);
      expect(rows.some((row) => row.summary === older)).toBe(true);
    });

    const refresh = await call(sessionUrl("/list"), { headers: bearer() });
    const refreshBody = await refresh.json() as { traces: { summary: string }[] };
    expect(refreshBody.traces.length).toBe(count);
    expect(refreshBody.traces.some((t) => t.summary === older)).toBe(true);

    const sse = await openEvents();
    expect(sse).toContain("event: snapshot");
    expect(sse).toContain(newer);
    const connected = await call(sessionUrl("/list"), { headers: bearer() });
    const connectedBody = await connected.json() as { traces: { summary: string }[] };
    expect(connectedBody.traces.length).toBe(count);
    expect(connectedBody.traces.some((t) => t.summary === newer)).toBe(true);

    const reconnectedSse = await openEvents();
    expect(reconnectedSse).toContain(newer);
    expect(reconnectedSse).toContain(older);
    const reconnected = await call(sessionUrl("/list"), { headers: bearer() });
    const reconnectedBody = await reconnected.json() as { traces: { summary: string }[] };
    expect(reconnectedBody.traces.length).toBe(count);
    expect(reconnectedBody.traces.some((t) => t.summary === newer)).toBe(true);
    expect(reconnectedBody.traces.some((t) => t.summary === older)).toBe(true);

    const snap = await call(sessionUrl("/snapshot"), { headers: bearer() });
    const snapText = await snap.text();
    const todos = snapText.split("## Ideas")[0];
    expect(todos.indexOf(newer)).toBeGreaterThan(-1);
    expect(todos.indexOf(newer)).toBeLessThan(todos.indexOf(older));
    expect(todos).toMatch(new RegExp(`- ${newer}[\\s\\S]*\\n  - ${older}`));

    const deniedClear = await call(sessionUrl("/clear"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(deniedClear.status).toBe(401);
    const still = await call(sessionUrl("/snapshot"), { headers: bearer() });
    expect(await still.text()).toContain(newer);

    const cleared = await call(sessionUrl("/clear"), {
      method: "POST",
      headers: bearer({ "Content-Type": "application/json" }),
      body: "{}",
    });
    expect(cleared.status).toBe(200);
    const empty = await call(sessionUrl("/list"), { headers: bearer() });
    const emptyBody = await empty.json() as { traces: unknown[] };
    expect(emptyBody.traces).toEqual([]);

    const afterSse = await openEvents();
    expect(afterSse).not.toContain(newer);
    expect(afterSse).toContain("\"traces\":[]");
    const afterClear = await call(sessionUrl("/list"), { headers: bearer() });
    const afterBody = await afterClear.json() as { traces: { summary: string }[] };
    expect(afterBody.traces).toEqual([]);
  });
});
