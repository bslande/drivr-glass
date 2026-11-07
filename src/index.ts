import { TraceHub } from "./trace-hub";
import { sanitizeTrace, type RawTrace, type Trace } from "./sanitize";
import { renderLoginGate, renderPage, renderPairMessage, renderPairPending } from "./page";
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
} from "./read-auth";
import {
  PAIR_POLL_MS,
  PAIR_TTL_SEC,
  clearPairCookie,
  newPhrase,
  newRequestId,
  newVerifier,
  normalizePhrase,
  pairCookie,
  readCookie,
  sameOriginBrowser,
  sha256Hex,
  PAIR_COOKIE,
} from "./pair";

export { TraceHub };

const PRIVATE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
} as const;

function wantsPairDocument(request: Request): boolean {
  const accept = (request.headers.get("Accept") || "").toLowerCase();
  if (accept.includes("application/json") && !accept.includes("text/html")) return false;
  if (accept.includes("text/html")) return true;
  const ctype = (request.headers.get("Content-Type") || "").toLowerCase();
  return ctype.includes("application/x-www-form-urlencoded") || ctype.includes("multipart/form-data");
}

function pairDocument(sessionId: string, message: string, status: number): Response {
  return new Response(renderPairMessage(sessionId, message), {
    status,
    headers: { ...PRIVATE_HEADERS, "Content-Type": "text/html; charset=utf-8" },
  });
}

function unauthorized(body: string, contentType: string): Response {
  return new Response(body, {
    status: 401,
    headers: { ...PRIVATE_HEADERS, "Content-Type": contentType },
  });
}

async function authorizePush(request: Request, env: Env): Promise<boolean> {
  return bearerMatches(request, env);
}

function hubStub(env: Env): DurableObjectStub<TraceHub> {
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
      // The write token is never accepted from a browser body.
      console.log(JSON.stringify({ message: "session_rejected" }));
      return new Response("browser login uses device pairing", {
        status: 410,
        headers: { ...PRIVATE_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    if (path === "/pair" && viaSession && request.method === "POST") {
      const asDocument = wantsPairDocument(request);
      if (!sameOriginBrowser(request)) {
        console.log(JSON.stringify({ message: "pair_origin_rejected" }));
        if (asDocument) return pairDocument(env.GLASS_SESSION_ID, "This browser was not accepted. Stay on the glass page and try again.", 403);
        return new Response("origin rejected", { status: 403, headers: PRIVATE_HEADERS });
      }
      const now = Math.floor(Date.now() / 1000);
      const stub = hubStub(env);
      let created: { ok: true } | { ok: false; error: string } = { ok: false, error: "exists" };
      let requestId = "";
      let phrase = "";
      let verifier = "";
      for (let attempt = 0; attempt < 5 && !created.ok; attempt++) {
        requestId = newRequestId();
        phrase = newPhrase();
        verifier = newVerifier();
        const verifierHash = await sha256Hex(verifier);
        created = await stub.startPair({
          id: requestId,
          phrase,
          verifierHash,
          exp: now + PAIR_TTL_SEC,
          now,
        });
      }
      if (!created.ok) {
        const status = created.error === "busy" ? 429 : 503;
        const message = created.error === "busy" ? "Too many pairing requests. Wait a minute and try again." : "Pairing did not start.";
        if (asDocument) return pairDocument(env.GLASS_SESSION_ID, message, status);
        return Response.json({ ok: false, error: created.error }, { status, headers: PRIVATE_HEADERS });
      }
      console.log(JSON.stringify({ message: "pair_started", requestId }));
      const headers = new Headers(PRIVATE_HEADERS);
      headers.set("Set-Cookie", pairCookie(request, env.GLASS_SESSION_ID, verifier));
      if (asDocument) {
        headers.set("Content-Type", "text/html; charset=utf-8");
        return new Response(renderPairPending(env.GLASS_SESSION_ID, requestId, phrase, true), { status: 200, headers });
      }
      return Response.json(
        { ok: true, requestId, phrase, expiresInSec: PAIR_TTL_SEC, pollMs: PAIR_POLL_MS },
        { status: 201, headers },
      );
    }

    if (path === "/pair/wait" && viaSession && request.method === "GET") {
      const asDocument = wantsPairDocument(request);
      if (!sameOriginBrowser(request)) {
        if (asDocument) return pairDocument(env.GLASS_SESSION_ID, "This browser was not accepted. Stay on the glass page and try again.", 403);
        return new Response("origin rejected", { status: 403, headers: PRIVATE_HEADERS });
      }
      const verifier = readCookie(request, PAIR_COOKIE);
      if (!verifier) {
        if (asDocument) return pairDocument(env.GLASS_SESSION_ID, "This browser has no pairing in progress.", 401);
        return Response.json({ ok: false, state: "unknown" }, { status: 401, headers: PRIVATE_HEADERS });
      }
      const stub = hubStub(env);
      const result = await stub.pollPair(await sha256Hex(verifier), Math.floor(Date.now() / 1000));
      if (result.state !== "ready") {
        const status = result.state === "pending" ? 200 : 410;
        if (asDocument && result.state === "pending" && result.requestId && result.phrase) {
          return new Response(renderPairPending(env.GLASS_SESSION_ID, result.requestId, result.phrase, true), {
            status: 200,
            headers: { ...PRIVATE_HEADERS, "Content-Type": "text/html; charset=utf-8" },
          });
        }
        if (asDocument) {
          return pairDocument(env.GLASS_SESSION_ID, "Pairing ended. Pair again if you are still parked.", status);
        }
        return Response.json({ ok: result.state === "pending", state: result.state }, { status, headers: PRIVATE_HEADERS });
      }
      const session = await mintSessionCookie(request, env);
      if (!session) {
        if (asDocument) return pairDocument(env.GLASS_SESSION_ID, "Pairing could not finish.", 500);
        return new Response("session unavailable", { status: 500, headers: PRIVATE_HEADERS });
      }
      const headers = new Headers(PRIVATE_HEADERS);
      headers.append("Set-Cookie", session);
      headers.append("Set-Cookie", clearPairCookie(request, env.GLASS_SESSION_ID));
      console.log(JSON.stringify({ message: "pair_claimed" }));
      if (asDocument) {
        headers.set("Location", `/s/${env.GLASS_SESSION_ID}`);
        return new Response(null, { status: 303, headers });
      }
      return Response.json({ ok: true, state: "ready" }, { status: 200, headers });
    }

    if (path === "/pair/approve" && viaSession && request.method === "POST") {
      if (!(await bearerMatches(request, env))) {
        console.log(JSON.stringify({ message: "pair_approve_unauthorized" }));
        return Response.json({ ok: false, error: "unauthorized" }, { status: 401, headers: PRIVATE_HEADERS });
      }
      let body: { requestId?: unknown; phrase?: unknown };
      try {
        body = (await request.json()) as { requestId?: unknown; phrase?: unknown };
      } catch {
        return Response.json({ ok: false, error: "invalid JSON" }, { status: 400, headers: PRIVATE_HEADERS });
      }
      if (typeof body.requestId !== "string" || typeof body.phrase !== "string") {
        return Response.json({ ok: false, error: "requestId and phrase are required" }, { status: 400, headers: PRIVATE_HEADERS });
      }
      const requestId = body.requestId.trim();
      const phrase = normalizePhrase(body.phrase);
      if (!/^[2-9A-HJKLMNP-Z]{8}$/.test(requestId) || !phrase) {
        return Response.json({ ok: false, error: "no matching request" }, { status: 404, headers: PRIVATE_HEADERS });
      }
      const stub = hubStub(env);
      const now = Math.floor(Date.now() / 1000);
      const row = await stub.lookupPair(requestId, now);
      if (!row || row.state !== "pending") {
        return Response.json({ ok: false, error: "no matching request" }, { status: 404, headers: PRIVATE_HEADERS });
      }
      const phraseOk = await timingSafeEqualString(phrase, row.phrase);
      if (!phraseOk) {
        return Response.json({ ok: false, error: "no matching request" }, { status: 404, headers: PRIVATE_HEADERS });
      }
      const marked = await stub.markPairApproved(requestId);
      if (!marked) {
        return Response.json({ ok: false, error: "no matching request" }, { status: 404, headers: PRIVATE_HEADERS });
      }
      console.log(JSON.stringify({ message: "pair_approved", requestId }));
      return Response.json({ ok: true }, { status: 200, headers: PRIVATE_HEADERS });
    }

    if (path === "/" && viaSession && (request.method === "GET" || isHead)) {
      if (!(await canRead(request, env))) {
        console.log(JSON.stringify({ message: "read_unauthorized", route: "html" }));
        return new Response(isHead ? null : renderLoginGate(env.GLASS_SESSION_ID), {
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
