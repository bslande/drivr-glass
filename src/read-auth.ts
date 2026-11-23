/**
 * Private read auth for cabin glass.
 * Bearer (Authorization header) or an HttpOnly cookie minted by POST /session.
 * The cookie is an HMAC of the session id and expiry, keyed by PUSH_TOKEN.
 * The raw token is never stored in the cookie, the URL, or a log line.
 */

const SESSION_COOKIE = "drivr_glass";
const MAX_AGE_SEC = 12 * 60 * 60;
const CREDENTIAL_QUERY_RE =
  /^(token|access_token|push_token|password|passwd|authorization|cookie|secret)$/i;

export function rejectsCredentialInQuery(url: URL): boolean {
  for (const key of url.searchParams.keys()) {
    if (CREDENTIAL_QUERY_RE.test(key)) return true;
  }
  return false;
}

export async function timingSafeEqualString(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ah, bh] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(ah, bh);
}

export async function bearerMatches(request: Request, env: Env): Promise<boolean> {
  const header = request.headers.get("Authorization") || "";
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  if (!match) return false;
  const expected = env.PUSH_TOKEN;
  if (!expected) return false;
  return timingSafeEqualString(match[1], expected);
}

function bytesToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

function hexToBytes(hex: string): Uint8Array | null {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function sign(env: Env, message: string): Promise<ArrayBuffer | null> {
  if (!env.PUSH_TOKEN) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.PUSH_TOKEN),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
}

function sessionMessage(env: Env, exp: number): string {
  return `v1.${env.GLASS_SESSION_ID}.${exp}`;
}

export async function mintSessionCookie(request: Request, env: Env): Promise<string | null> {
  const sessionId = env.GLASS_SESSION_ID || "";
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(sessionId)) return null;
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SEC;
  const mac = await sign(env, sessionMessage(env, exp));
  if (!mac) return null;
  const value = `v1.${exp}.${bytesToHex(mac)}`;
  const parts = [
    `${SESSION_COOKIE}=${value}`,
    "HttpOnly",
    "SameSite=Strict",
    `Path=/s/${sessionId}`,
    `Max-Age=${MAX_AGE_SEC}`,
  ];
  if (new URL(request.url).protocol === "https:") parts.push("Secure");
  return parts.join("; ");
}

function cookieValue(request: Request): string | null {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) === SESSION_COOKIE) return trimmed.slice(eq + 1);
  }
  return null;
}

export async function cookieMatches(request: Request, env: Env): Promise<boolean> {
  const raw = cookieValue(request);
  if (!raw || !env.PUSH_TOKEN || !env.GLASS_SESSION_ID) return false;
  const parts = raw.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (exp < now || exp > now + MAX_AGE_SEC + 60) return false;
  const provided = hexToBytes(parts[2]);
  if (!provided || provided.length !== 32) return false;
  const expected = await sign(env, sessionMessage(env, exp));
  if (!expected) return false;
  const expectedBytes = new Uint8Array(expected);
  if (expectedBytes.length !== provided.length) return false;
  return crypto.subtle.timingSafeEqual(expectedBytes, provided);
}

/** Browser cookie or Authorization bearer. Writes stay bearer-only. */
export async function canRead(request: Request, env: Env): Promise<boolean> {
  if (await bearerMatches(request, env)) return true;
  return cookieMatches(request, env);
}

const BODY_CAP = 8192;

/** Token from a login body. Never log the return value. Bodies over 8 KB are rejected. */
export async function tokenFromLoginBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("Content-Length") || "0");
  if (Number.isFinite(declared) && declared > BODY_CAP) return null;
  const text = await readBodyText(request, BODY_CAP);
  if (text == null) return null;
  const ctype = (request.headers.get("Content-Type") || "").toLowerCase();
  if (ctype.includes("application/json")) {
    try {
      const body = JSON.parse(text) as { token?: unknown };
      return typeof body.token === "string" ? body.token : null;
    } catch {
      return null;
    }
  }
  return new URLSearchParams(text).get("token");
}

async function readBodyText(request: Request, cap: number): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buf.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(buf);
}
