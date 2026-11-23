import { env } from "cloudflare:workers";
import { createExecutionContext, runInDurableObject, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src/index";

function sessionUrl(path = ""): string {
  return `http://example.com/s/${env.GLASS_SESSION_ID}${path}`;
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

function cookieHeader(res: Response, name: string): string {
  const hit = res.headers.getSetCookie().find((item) => item.startsWith(name + "="));
  if (!hit) throw new Error("missing " + name);
  return hit.split(";")[0];
}

async function startPair(): Promise<{ requestId: string; phrase: string; verifier: string }> {
  const started = await call(sessionUrl("/pair"), {
    method: "POST",
    headers: { Origin: "http://example.com", Accept: "application/json" },
  });
  expect(started.status).toBe(201);
  const body = await started.json() as { requestId: string; phrase: string };
  expect(body.requestId).not.toContain(env.PUSH_TOKEN);
  expect(body.phrase).not.toContain(env.PUSH_TOKEN);
  return { requestId: body.requestId, phrase: body.phrase, verifier: cookieHeader(started, "drivr_pair") };
}

describe("device pairing", () => {
  it("rejects anonymous approval and does not grant a read", async () => {
    const pending = await startPair();
    const denied = await call(sessionUrl("/pair/approve"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: pending.requestId, phrase: pending.phrase }),
    });
    expect(denied.status).toBe(401);
    const wrong = await call(sessionUrl("/pair/approve"), {
      method: "POST",
      headers: { Authorization: "Bearer wrong-token", "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: pending.requestId, phrase: pending.phrase }),
    });
    expect(wrong.status).toBe(401);
    const waiting = await call(sessionUrl("/pair/wait"), {
      headers: { Origin: "http://example.com", Accept: "application/json", Cookie: pending.verifier },
    });
    const waitingBody = await waiting.json() as { state: string };
    expect(waiting.status).toBe(200);
    expect(waitingBody.state).toBe("pending");
    expect(waiting.headers.get("Set-Cookie") || "").not.toContain("drivr_glass=");
    const snap = await call(sessionUrl("/snapshot"), { headers: { Cookie: pending.verifier } });
    expect(snap.status).toBe(401);

    const retired = await call(sessionUrl("/session"), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "http://example.com" },
      body: "token=" + encodeURIComponent(env.PUSH_TOKEN),
    });
    expect(retired.status).toBe(410);
    expect(await retired.text()).not.toContain(env.PUSH_TOKEN);
    expect(retired.headers.get("Set-Cookie")).toBeNull();
  });

  it("approves only the requesting browser and keeps the cookie read-only", async () => {
    const first = await startPair();
    const second = await startPair();
    const mismatch = await call(sessionUrl("/pair/approve"), {
      method: "POST",
      headers: { Authorization: `Bearer ${env.PUSH_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: first.requestId, phrase: "not the phrase" }),
    });
    expect(mismatch.status).toBe(404);
    const swapped = await call(sessionUrl("/pair/approve"), {
      method: "POST",
      headers: { Authorization: `Bearer ${env.PUSH_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: first.requestId, phrase: second.phrase }),
    });
    expect(swapped.status).toBe(404);

    const approved = await call(sessionUrl("/pair/approve"), {
      method: "POST",
      headers: { Authorization: `Bearer ${env.PUSH_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: first.requestId, phrase: first.phrase }),
    });
    expect(approved.status).toBe(200);
    expect(JSON.stringify(await approved.clone().json())).not.toContain(env.PUSH_TOKEN);

    const other = await call(sessionUrl("/pair/wait"), {
      headers: { Origin: "http://example.com", Accept: "application/json", Cookie: second.verifier },
    });
    expect((await other.json() as { state: string }).state).toBe("pending");
    expect(other.headers.getSetCookie().some((item) => item.startsWith("drivr_glass="))).toBe(false);

    const claimed = await call(sessionUrl("/pair/wait"), {
      headers: { Origin: "http://example.com", Accept: "application/json", Cookie: first.verifier },
    });
    expect(claimed.status).toBe(200);
    const readCookie = cookieHeader(claimed, "drivr_glass");
    expect(claimed.headers.getSetCookie().some((item) => item.startsWith("drivr_glass=") && item.includes("HttpOnly"))).toBe(true);
    expect(readCookie).not.toContain(env.PUSH_TOKEN);

    const marker = "paired-browser-can-read";
    const pushed = await call(sessionUrl("/push"), {
      method: "POST",
      headers: { Authorization: `Bearer ${env.PUSH_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ bot: "Drivr", summary: marker, kind: "note", status: "open" }),
    });
    expect(pushed.status).toBe(201);
    const snap = await call(sessionUrl("/snapshot"), { headers: { Cookie: readCookie } });
    expect(snap.status).toBe(200);
    expect(await snap.text()).toContain(marker);
    const write = await call(sessionUrl("/push"), {
      method: "POST",
      headers: { Cookie: readCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ bot: "Drivr", summary: "cookie-must-not-write", kind: "note" }),
    });
    expect(write.status).toBe(401);

    const replayWait = await call(sessionUrl("/pair/wait"), {
      headers: { Origin: "http://example.com", Accept: "application/json", Cookie: first.verifier },
    });
    expect(replayWait.status).toBe(410);
    expect(replayWait.headers.getSetCookie().some((item) => item.startsWith("drivr_glass="))).toBe(false);
    const replayApprove = await call(sessionUrl("/pair/approve"), {
      method: "POST",
      headers: { Authorization: `Bearer ${env.PUSH_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: first.requestId, phrase: first.phrase }),
    });
    expect(replayApprove.status).toBe(404);
  });

  it("expires a request and rejects a cross-origin start", async () => {
    const pending = await startPair();
    const stub = env.TRACE_HUB.getByName("fleet");
    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec(`UPDATE pairings SET exp = 1 WHERE id = ?`, pending.requestId);
    });
    const expiredApprove = await call(sessionUrl("/pair/approve"), {
      method: "POST",
      headers: { Authorization: `Bearer ${env.PUSH_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: pending.requestId, phrase: pending.phrase }),
    });
    expect(expiredApprove.status).toBe(404);
    const expiredWait = await call(sessionUrl("/pair/wait"), {
      headers: { Origin: "http://example.com", Accept: "application/json", Cookie: pending.verifier },
    });
    expect(expiredWait.status).toBe(410);
    expect((await expiredWait.json() as { state: string }).state).toBe("expired");

    const cross = await call(sessionUrl("/pair"), {
      method: "POST",
      headers: { Origin: "https://evil.example", Accept: "application/json" },
    });
    expect(cross.status).toBe(403);
    expect(cross.headers.get("Set-Cookie")).toBeNull();

    const gate = await call(sessionUrl("/"));
    const html = await gate.text();
    expect(html).toContain("Pair this browser");
    expect(html).toContain("maxPolls = 36");
    expect(html).not.toContain('name="token"');
    expect(html).not.toContain(env.PUSH_TOKEN);
  });
});
