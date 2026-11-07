import { TraceHub } from "./trace-hub";
import { sanitizeTrace, type RawTrace, type Trace } from "./sanitize";
import { renderLoginGate, renderPage } from "./page";
import { GLASS_UI_VER } from "./ui-ver";
import { CONSTITUTION_RULES } from "./constitution";
import {
  formatSnapshotJson,
  formatSnapshotText,
  wantsSnapshotJson,
} from "./snapshot";
import {
  bearerMatches,
  canRead,
  mintSessionCookie,
  rejectsCredentialInQuery,
  timingSafeEqualString,
  tokenFromLoginBody,
} from "./read-auth";

export { TraceHub };

const PRIVATE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
} as const;

function unauthorized(body: string, contentType: string): Response {
  return new Response(body, {
    status: 401,
    headers: { ...PRIVATE_HEADERS, "Content-Type": contentType },
  });
}

async function authorizePush(request: Request, env: Env): Promise<boolean> {
  return bearerMatches(request, env);
}

function hubStub(env: Env): DurableObjectStub {
  return env.TRACE_HUB.getByName("fleet");
}

/**
 * Opaque cabin path: /s/<GLASS_SESSION_ID>/...
 * HTML open URL is always /s/<id>. Bare / does NOT redirect (path obscurity —
 * never disclose the session id via Location).
 * Content reads (HTML, /list, /snapshot, /events) require a valid session path.
 * Authenticated writes (/push, /clear) dual-serve at root; session-prefixed preferred.
 * /health stays at root (no content leak).
 * Returns rewritten pathname (without /s/<id> prefix) or null if invalid id.
 */
function rewriteSessionPath(pathname: string, sessionId: string | undefined): string | null | undefined {
  const m = /^\/s\/([^/]+)(\/.*)?$/.exec(pathname);
  if (!m) return undefined; // not a session path
  const id = m[1];
  if (!sessionId || id !== sessionId) return null; // bad id
  const rest = m[2] || "/";
  return rest === "" ? "/" : rest;
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    let path = url.pathname;

    if (rejectsCredentialInQuery(url)) {
      return new Response("credentials are not accepted in the URL", {
        status: 400,
        headers: { ...PRIVATE_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    const rewritten = rewriteSessionPath(path, env.GLASS_SESSION_ID);
    if (rewritten === null) {
      return new Response("Not found", { status: 404 });
    }
    const viaSession = rewritten !== undefined;
    if (viaSession) {
      path = rewritten;
    }

    const isHead = request.method === "HEAD";
    if (path === "/health") {
      return new Response(isHead ? null : "ok", {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

    // Bare host: never disclose session id (no 307 Location). No glass at /.
    if (path === "/" && !viaSession && (request.method === "GET" || isHead)) {
      return new Response("Not found", {
        status: 404,
        headers: { "Cache-Control": "no-store" },
      });
    }

    if (path === "/session" && viaSession && request.method === "POST") {
      const fromBearer = await bearerMatches(request, env);
      let presented = fromBearer;
      if (!presented) {
        const token = await tokenFromLoginBody(request);
        const expected = env.PUSH_TOKEN;
        presented = Boolean(token && expected && (await timingSafeEqualString(token, expected)));
      }
      if (!presented) {
        console.log(JSON.stringify({ message: "session_unauthorized" }));
        return new Response(renderLoginGate(), {
          status: 401,
          headers: { ...PRIVATE_HEADERS, "Content-Type": "text/html; charset=utf-8" },
        });
      }
      const cookie = await mintSessionCookie(request, env);
      if (!cookie) {
        return new Response("session unavailable", { status: 500, headers: PRIVATE_HEADERS });
      }
      const headers = new Headers(PRIVATE_HEADERS);
      headers.set("Set-Cookie", cookie);
      const wantsJson = (request.headers.get("Accept") || "").includes("application/json")
        && !(request.headers.get("Content-Type") || "").includes("application/x-www-form-urlencoded");
      if (wantsJson) {
        return new Response(null, { status: 204, headers });
      }
      headers.set("Location", `/s/${env.GLASS_SESSION_ID}`);
      return new Response(null, { status: 303, headers });
    }

    if (path === "/" && viaSession && (request.method === "GET" || isHead)) {
      if (!(await canRead(request, env))) {
        console.log(JSON.stringify({ message: "read_unauthorized", route: "html" }));
        return new Response(isHead ? null : renderLoginGate(), {
          status: 401,
          headers: { ...PRIVATE_HEADERS, "Content-Type": "text/html; charset=utf-8" },
        });
      }
      return new Response(isHead ? null : renderPage(), {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          ...PRIVATE_HEADERS,
        },
      });
    }

    // Content reads require valid /s/<id> — bare /list, /snapshot, /events leak traces.
    if (path === "/events" && request.method === "GET") {
      if (!viaSession) {
        return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
      }
      if (!(await canRead(request, env))) {
        console.log(JSON.stringify({ message: "read_unauthorized", route: "events" }));
        return unauthorized("unauthorized", "text/plain; charset=utf-8");
      }
      const headers = new Headers();
      if (request.headers.get("x-glass-once") === "1") headers.set("x-glass-once", "1");
      return hubStub(env).fetch(
        new Request(new URL("/events", request.url), { method: "GET", headers, signal: request.signal }),
      );
    }

    if (path === "/push" && request.method === "POST") {
      if (!(await authorizePush(request, env))) {
        console.log(JSON.stringify({ message: "push_unauthorized" }));
        return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
      }

      let raw: RawTrace;
      try {
        raw = (await request.json()) as RawTrace;
      } catch {
        return Response.json({ ok: false, error: "invalid JSON" }, { status: 400 });
      }

      const result = sanitizeTrace(raw);
      if (!result.ok) {
        console.log(JSON.stringify({ message: "push_rejected", error: result.error }));
        return Response.json({ ok: false, error: result.error }, { status: 400 });
      }

      const resp = await hubStub(env).fetch(
        new Request(new URL("/push", request.url), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(result.trace),
        }),
      );
      return resp;
    }

    if (path === "/clear" && request.method === "POST") {
      if (!(await authorizePush(request, env))) {
        console.log(JSON.stringify({ message: "clear_unauthorized" }));
        return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
      }
      // DO fetch requires a POST body; empty POST without body 404s at the stub.
      let resp = await hubStub(env).fetch(
        new Request(new URL("/clear", request.url), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        }),
      );
      if (resp.status === 404) {
        resp = await hubStub(env).fetch(
          new Request(new URL("/push", request.url), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ clear: true }),
          }),
        );
      }
      return resp;
    }


    if (path === "/snapshot" && (request.method === "GET" || isHead)) {
      if (!viaSession) {
        return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
      }
      if (!(await canRead(request, env))) {
        console.log(JSON.stringify({ message: "read_unauthorized", route: "snapshot" }));
        return unauthorized(isHead ? "" : "unauthorized", "text/plain; charset=utf-8");
      }
      // Always GET the hub list — HEAD on /snapshot must not forward HEAD into TraceHub.
      const listResp = await hubStub(env).fetch(
        new Request(new URL("/list", request.url), { method: "GET" }),
      );
      const headers = new Headers();
      headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
      headers.set("X-Content-Type-Options", "nosniff");
      if (!listResp.ok) {
        return new Response(isHead ? null : "snapshot unavailable", {
          status: listResp.status,
          headers,
        });
      }
      let traces: Trace[] = [];
      try {
        const data = (await listResp.json()) as { traces?: Trace[] };
        traces = Array.isArray(data.traces) ? data.traces : [];
      } catch {
        return new Response(isHead ? null : "snapshot unavailable", { status: 502, headers });
      }
      const generatedAt = new Date().toISOString();
      const opts = { ui: GLASS_UI_VER, generatedAt };
      if (wantsSnapshotJson(request, url)) {
        const payload = formatSnapshotJson(traces, CONSTITUTION_RULES, opts);
        headers.set("Content-Type", "application/json; charset=utf-8");
        if (isHead) return new Response(null, { status: 200, headers });
        return Response.json(payload, { status: 200, headers });
      }
      const textBody = formatSnapshotText(traces, CONSTITUTION_RULES, opts);
      headers.set("Content-Type", "text/plain; charset=utf-8");
      return new Response(isHead ? null : textBody, { status: 200, headers });
    }

    if (path === "/list" && request.method === "GET") {
      if (!viaSession) {
        return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
      }
      if (!(await canRead(request, env))) {
        console.log(JSON.stringify({ message: "read_unauthorized", route: "list" }));
        return unauthorized("unauthorized", "text/plain; charset=utf-8");
      }
      const resp = await hubStub(env).fetch(new Request(new URL("/list", request.url), request));
      const headers = new Headers(resp.headers);
      headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
      // Stamp Worker UI ver so /list matches HTML even while a long-lived DO SSE isolate lags a deploy.
      try {
        const data = (await resp.json()) as { ui?: string; traces?: unknown };
        data.ui = GLASS_UI_VER;
        return Response.json(data, { status: resp.status, headers });
      } catch {
        return new Response(resp.body, { status: resp.status, headers });
      }
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
