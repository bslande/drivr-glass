/**
 * Device pairing for a parked browser.
 * The request id and phrase are shown to the owner and repeated to Drivr.
 * Neither value is a password: approval also needs the bearer token, and the
 * read cookie is issued only to the browser that holds the pairing verifier.
 */

export const PAIR_TTL_SEC = 180;
export const PAIR_MAX_POLLS = 36;
export const PAIR_POLL_MS = 5_000;
export const PAIR_MAX_PENDING = 5;

const ID_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const WORDS = [
  "amber", "birch", "cedar", "drift", "ember", "flint", "grove", "hazel",
  "ivory", "juniper", "kelp", "maple", "north", "olive", "pebble", "quartz",
  "ridge", "sage", "timber", "umber", "violet", "willow", "yarrow", "cobalt",
  "harbor", "linden", "meadow", "orchid", "spruce", "thistle", "willow", "zephyr",
];

function randomIndex(mod: number): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % mod;
}

export function newRequestId(): string {
  let out = "";
  for (let i = 0; i < 8; i++) out += ID_ALPHABET[randomIndex(ID_ALPHABET.length)];
  return out;
}

export function newPhrase(): string {
  return [0, 1, 2].map(() => WORDS[randomIndex(WORDS.length)]).join(" ");
}

export function newVerifier(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  let out = "";
  for (let i = 0; i < buf.length; i++) out += buf[i].toString(16).padStart(2, "0");
  return out;
}

export function normalizePhrase(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const bytes = new Uint8Array(digest);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

export const PAIR_COOKIE = "drivr_pair";

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1);
  }
  return null;
}

export function pairCookie(request: Request, sessionId: string, verifier: string): string {
  const parts = [
    `${PAIR_COOKIE}=${verifier}`,
    "HttpOnly",
    "SameSite=Strict",
    `Path=/s/${sessionId}`,
    `Max-Age=${PAIR_TTL_SEC}`,
  ];
  if (new URL(request.url).protocol === "https:") parts.push("Secure");
  return parts.join("; ");
}

export function clearPairCookie(request: Request, sessionId: string): string {
  const parts = [
    `${PAIR_COOKIE}=`,
    "HttpOnly",
    "SameSite=Strict",
    `Path=/s/${sessionId}`,
    "Max-Age=0",
  ];
  if (new URL(request.url).protocol === "https:") parts.push("Secure");
  return parts.join("; ");
}

/** Browser POST/GET for pairing must come from this host. Missing Origin fails closed. */
export function sameOriginBrowser(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  const url = new URL(request.url);
  if (parsed.origin !== url.origin) return false;
  const site = (request.headers.get("Sec-Fetch-Site") || "").toLowerCase();
  if (site && site !== "same-origin" && site !== "none") return false;
  return true;
}
