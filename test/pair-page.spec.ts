import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src/index";

function pageUrl(): string {
  return `http://example.com/s/${env.GLASS_SESSION_ID}`;
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

describe("pairing page URL resolution", () => {
  it("posts the path a no-slash browser URL actually resolves, and parses the inline script", async () => {
    const gate = await call(pageUrl());
    expect(gate.status).toBe(401);
    const html = await gate.text();
    expect(html).toContain("Pair this browser");
    expect(html).not.toContain("<base");
    expect(html).not.toContain('name="token"');
    expect(html).not.toContain(env.PUSH_TOKEN);

    const script = html.slice(html.indexOf("<script>") + 8, html.indexOf("</script>"));
    expect(script.length).toBeGreaterThan(50);
    new Function(script);
    expect(script).not.toContain('fetch("pair"');
    expect(script).not.toContain("fetch('pair'");
    expect(script).toContain('getAttribute("action")');
    expect(script).toContain("maxPolls = 36");
    expect(html).toContain('id="error"');

    const action = /<form[^>]*action="([^"]+)"/.exec(html)?.[1];
    expect(action).toBeTruthy();
    const resolved = new URL(action as string, pageUrl());
    expect(resolved.pathname).toBe(`/s/${env.GLASS_SESSION_ID}/pair`);
    expect(new URL("pair", pageUrl()).pathname).toBe("/s/pair");
    expect(new URL("pair/wait", pageUrl()).pathname).toBe("/s/pair/wait");

    const missed = await call(new URL("pair", pageUrl()).toString(), {
      method: "POST",
      headers: { Origin: "http://example.com", Accept: "application/json" },
    });
    expect(missed.status).toBe(404);

    const hit = await call(resolved.toString(), {
      method: "POST",
      headers: { Origin: "http://example.com", Accept: "application/json" },
    });
    expect(hit.status).toBe(201);
    const body = await hit.json() as { requestId: string; phrase: string };
    expect(body.requestId).toMatch(/^[2-9A-HJKLMNP-Z]{8}$/);
    expect(body.phrase.split(" ").length).toBe(3);
    expect(body.phrase).not.toContain(env.PUSH_TOKEN);

    const form = await call(resolved.toString(), {
      method: "POST",
      headers: {
        Origin: "http://example.com",
        Accept: "text/html",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "",
    });
    expect(form.status).toBe(200);
    expect(form.headers.get("Content-Type") || "").toContain("text/html");
    const formHtml = await form.text();
    expect(formHtml).toContain("Tell Drivr these two lines");
    expect(formHtml).toContain('http-equiv="refresh"');
    expect(formHtml).toContain(`/s/${env.GLASS_SESSION_ID}/pair/wait`);
    expect(formHtml).not.toContain(env.PUSH_TOKEN);
    const verifier = cookieHeader(form, "drivr_pair");

    const waiting = await call(new URL(`/s/${env.GLASS_SESSION_ID}/pair/wait`, pageUrl()).toString(), {
      headers: { Origin: "http://example.com", Accept: "text/html", Cookie: verifier },
    });
    expect(waiting.status).toBe(200);
    const waitingHtml = await waiting.text();
    expect(waitingHtml).toContain('http-equiv="refresh"');
    expect(waitingHtml).not.toContain(env.PUSH_TOKEN);
  });
});
