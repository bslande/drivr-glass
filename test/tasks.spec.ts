import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
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

function bearer(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set("Authorization", `Bearer ${token()}`);
  return headers;
}

function cookieHeader(res: Response, name: string): string {
  const all = typeof res.headers.getSetCookie === "function"
    ? res.headers.getSetCookie()
    : [res.headers.get("Set-Cookie") || ""];
  const hit = all.find((item) => item.startsWith(name + "="));
  if (!hit) throw new Error("missing " + name);
  return hit.split(";")[0];
}

async function pairedReadCookie(): Promise<string> {
  const started = await call(sessionUrl("/pair"), {
    method: "POST",
    headers: { Origin: "http://example.com", Accept: "application/json" },
  });
  expect(started.status).toBe(201);
  const startedBody = await started.json() as { requestId: string; phrase: string };
  const verifier = cookieHeader(started, "drivr_pair");
  const approved = await call(sessionUrl("/pair/approve"), {
    method: "POST",
    headers: bearer({ "Content-Type": "application/json" }),
    body: JSON.stringify({ requestId: startedBody.requestId, phrase: startedBody.phrase }),
  });
  expect(approved.status).toBe(200);
  const claimed = await call(sessionUrl("/pair/wait"), {
    headers: { Origin: "http://example.com", Accept: "application/json", Cookie: verifier },
  });
  expect(claimed.status).toBe(200);
  return cookieHeader(claimed, "drivr_glass");
}

const sample = {
  updatedAt: "2026-11-23T16:00:00.000Z",
  tasks: [
    { id: "lumbar-install", title: "Line up lumbar install steps once the parts arrive", bot: "Richard", area: "Home/Tesla", column: "todo" },
    { id: "maye-claim", title: "Monitoring Mayfield-for-Maye claim", bot: "Berry", area: "Fantasy", date: "Slated Nov 21", column: "waiting" },
  ],
};

describe("task board store", () => {
  it("rejects unauthenticated and non-session task reads", async () => {
    const unauth = await call(sessionUrl("/tasks"));
    expect(unauth.status).toBe(401);
    expect(await unauth.text()).toBe("unauthorized");

    const bare = await call("http://example.com/tasks");
    expect(bare.status).toBe(404);

    const query = await call(`${sessionUrl("/tasks")}?token=${encodeURIComponent(token())}`, {
      headers: bearer(),
    });
    expect(query.status).toBe(400);
    expect(await query.text()).toContain("credentials are not accepted in the URL");
  });

  it("stores the board behind bearer write and allows paired-cookie read", async () => {
    const putUnauth = await call(sessionUrl("/tasks"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sample),
    });
    expect(putUnauth.status).toBe(401);

    const cookie = await pairedReadCookie();
    const putCookie = await call(sessionUrl("/tasks"), {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(sample),
    });
    expect(putCookie.status).toBe(401);

    const put = await call(sessionUrl("/tasks"), {
      method: "PUT",
      headers: bearer({ "Content-Type": "application/json" }),
      body: JSON.stringify(sample),
    });
    expect(put.status).toBe(200);
    const putBody = await put.json() as { ok: boolean; count: number };
    expect(putBody.ok).toBe(true);
    expect(putBody.count).toBe(2);

    const listed = await call(sessionUrl("/tasks"), { headers: bearer() });
    expect(listed.status).toBe(200);
    const board = await listed.json() as { updatedAt: string; tasks: Array<{ id: string }> };
    expect(board.updatedAt).toBe(sample.updatedAt);
    expect(board.tasks.map((t) => t.id)).toEqual(["lumbar-install", "maye-claim"]);

    const viaCookie = await call(sessionUrl("/tasks"), { headers: { Cookie: cookie } });
    expect(viaCookie.status).toBe(200);
    const cookieBoard = await viaCookie.json() as { tasks: Array<{ id: string }> };
    expect(cookieBoard.tasks).toHaveLength(2);
  });

  it("does not wipe tasks when traces are cleared", async () => {
    const put = await call(sessionUrl("/tasks"), {
      method: "PUT",
      headers: bearer({ "Content-Type": "application/json" }),
      body: JSON.stringify(sample),
    });
    expect(put.status).toBe(200);

    const note = await call(sessionUrl("/push"), {
      method: "POST",
      headers: bearer({ "Content-Type": "application/json" }),
      body: JSON.stringify({ bot: "Drivr", summary: "A glass note to clear", kind: "note", status: "open" }),
    });
    expect(note.status).toBe(201);

    const cleared = await call(sessionUrl("/clear"), {
      method: "POST",
      headers: bearer({ "Content-Type": "application/json" }),
      body: "{}",
    });
    expect(cleared.status).toBe(200);

    const list = await call(sessionUrl("/list"), { headers: bearer() });
    expect(list.status).toBe(200);
    const traces = await list.json() as { traces: unknown[] };
    expect(traces.traces).toEqual([]);

    const tasks = await call(sessionUrl("/tasks"), { headers: bearer() });
    expect(tasks.status).toBe(200);
    const board = await tasks.json() as { tasks: Array<{ id: string }> };
    expect(board.tasks.map((t) => t.id)).toEqual(["lumbar-install", "maye-claim"]);
  });

  it("rejects a token-like task field", async () => {
    const bad = await call(sessionUrl("/tasks"), {
      method: "PUT",
      headers: bearer({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        tasks: [{ id: "x", title: "Bearer abcdefghijklmnopqr", bot: "CoS", column: "todo" }],
      }),
    });
    expect(bad.status).toBe(400);
    const body = await bad.json() as { error: string };
    expect(body.error).toContain("sensitive");
  });

  it("requires bearer for POST /tasks/refresh and rejects a paired cookie", async () => {
    const cookie = await pairedReadCookie();
    const viaCookie = await call(sessionUrl("/tasks/refresh"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: "{}",
    });
    expect(viaCookie.status).toBe(401);

    const unauth = await call(sessionUrl("/tasks/refresh"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(unauth.status).toBe(401);

    const bare = await call("http://example.com/tasks/refresh", {
      method: "POST",
      headers: bearer({ "Content-Type": "application/json" }),
      body: "{}",
    });
    expect(bare.status).toBe(404);

    const put = await call(sessionUrl("/tasks"), {
      method: "PUT",
      headers: bearer({ "Content-Type": "application/json" }),
      body: JSON.stringify(sample),
    });
    expect(put.status).toBe(200);

    const refresh = await call(sessionUrl("/tasks/refresh"), {
      method: "POST",
      headers: bearer({ "Content-Type": "application/json" }),
      body: "{}",
    });
    expect(refresh.status).toBe(200);
    const body = await refresh.json() as { ok: boolean; count: number; refreshed: boolean };
    expect(body.ok).toBe(true);
    expect(body.refreshed).toBe(true);
    expect(body.count).toBe(2);
  });

  it("renders a read-only task board on the cabin page", async () => {
    const page = await call(sessionUrl(), { headers: bearer() });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('id="board-section"');
    expect(html).toContain('glassApi("/tasks")');
    expect(html).toContain("Waiting on Bud");
    expect(html).toContain("Parked display only");
    expect(html).toContain("v-task-board-1");
    expect(html).not.toContain(token());
    expect(html).toContain('id="capture-section"');
  });
});
