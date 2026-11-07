/** Privacy-safe ingest for cabin glass traces. Reject or strip sensitive fields. */

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const TOKENISH_RE =
  /\b(sk-[a-z0-9]{16,}|ghp_[a-z0-9]{20,}|xox[baprs]-[a-z0-9-]{10,}|Bearer\s+[a-z0-9._-]{16,}|api[_-]?key\s*[:=]\s*\S+)/i;
const HOME_PATH_RE = /\/home\/[^\s]+/i;
const MEDICAL_RE =
  /\b(patient|diagnosis|prescription|medical|clinic|hospital|hipaa|lab\s*result|blood\s*pressure|medication)\b/i;
// Owner-private terms the glass must never show. Replace the placeholder with your own
// terms (e.g. /\b(project-x|codename)\b/i). The placeholder matches nothing real.
const PRIVATE_TERMS_RE = /\bREPLACE_WITH_PRIVATE_TERMS\b/i;
const SECRET_FIELD_RE = /^(secret|token|password|passwd|authorization|cookie|api[_-]?key|private|credential|ssn|email)$/i;

const MAX_BOT = 40;
/** Brief narrative (1–2 sentences), not a title slug. */
const MAX_SUMMARY = 280;
const MAX_DETAIL = 4000;
const MAX_RESULT = 4000;
const MAX_STATUS = 24;
/** Preferred mid-task statuses for live activity stream (cabin Grok). */
const MID_TASK_STATUSES = new Set([
  "open",
  "started",
  "working",
  "found",
  "blocked",
  "retrying",
  "done",
]);

const MAX_KIND = 24;

const CAPTURE_KINDS = new Set(["note", "todo", "idea", "capture"]);
export type RawTrace = {
  bot?: unknown;
  summary?: unknown;
  detail?: unknown;
  result?: unknown;
  from?: unknown;
  status?: unknown;
  kind?: unknown;
  ts?: unknown;
  [key: string]: unknown;
};

export type Trace = {
  id: string;
  bot: string;
  summary: string;
  detail?: string;
  result?: string;
  from?: string;
  status?: string;
  kind?: string;
  ts: string;
};

export type SanitizeResult =
  | { ok: true; trace: Omit<Trace, "id"> }
  | { ok: false; error: string };

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).trimEnd() + "…";
}

/** Preserve newlines for detail/result bodies; collapse only runs of spaces/tabs. */
function clipMultiline(s: string, max: number): string {
  const t = s
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).trimEnd() + "…";
}

function looksSensitive(s: string): boolean {
  return (
    EMAIL_RE.test(s) ||
    TOKENISH_RE.test(s) ||
    HOME_PATH_RE.test(s) ||
    MEDICAL_RE.test(s) ||
    PRIVATE_TERMS_RE.test(s)
  );
}

function stripSensitive(s: string): string {
  let out = s;
  out = out.replace(EMAIL_RE, "[redacted]");
  out = out.replace(TOKENISH_RE, "[redacted]");
  out = out.replace(HOME_PATH_RE, "[path]");
  out = out.replace(PRIVATE_TERMS_RE, "[omitted]");
  return out;
}

function sanitizeLongText(
  label: string,
  value: unknown,
  max: number = MAX_DETAIL,
): { ok: true; text?: string } | { ok: false; error: string } {
  if (value == null || value === "") return { ok: true, text: undefined };
  if (typeof value !== "string") return { ok: false, error: `${label} must be a string ≤${max}` };
  if (MEDICAL_RE.test(value) || PRIVATE_TERMS_RE.test(value)) {
    return { ok: false, error: `${label} rejected: sensitive content` };
  }
  const text = clipMultiline(stripSensitive(value), max);
  return { ok: true, text: text || undefined };
}

export function sanitizeTrace(raw: RawTrace): SanitizeResult {
  if (raw == null || typeof raw !== "object") {
    return { ok: false, error: "body must be a JSON object" };
  }

  for (const key of Object.keys(raw)) {
    if (SECRET_FIELD_RE.test(key)) {
      return { ok: false, error: `field "${key}" is not allowed` };
    }
  }

  if (typeof raw.bot !== "string" || !raw.bot.trim()) {
    return { ok: false, error: "bot is required (string ≤40)" };
  }
  if (typeof raw.summary !== "string" || !raw.summary.trim()) {
    return { ok: false, error: "summary is required (string ≤280)" };
  }

  let bot = clip(raw.bot, MAX_BOT);
  if (bot.toLowerCase() !== "drivr") {
    return { ok: false, error: "bot must be Drivr" };
  }
  bot = "Drivr";
  let summary = clip(raw.summary, MAX_SUMMARY);

  if (MEDICAL_RE.test(bot) || MEDICAL_RE.test(summary) || PRIVATE_TERMS_RE.test(bot) || PRIVATE_TERMS_RE.test(summary)) {
    return { ok: false, error: "trace rejected: sensitive content" };
  }

  bot = stripSensitive(bot);
  summary = stripSensitive(summary);

  if (!bot || !summary) {
    return { ok: false, error: "bot and summary must remain non-empty after sanitize" };
  }

  const detailRes = sanitizeLongText("detail", raw.detail, MAX_DETAIL);
  if (!detailRes.ok) return detailRes;
  const resultRes = sanitizeLongText("result", raw.result, MAX_RESULT);
  if (!resultRes.ok) return resultRes;

  let detail = detailRes.text;
  let result = resultRes.text;
  // Prefer result as the expanded body when present; keep detail if only detail was sent.
  if (result && !detail) detail = result;
  if (result && detail && result !== detail) {
    // Keep both: detail stays short context, result is full body for expand.
  }

  let ts: string;
  if (raw.ts == null || raw.ts === "") {
    ts = new Date().toISOString();
  } else if (typeof raw.ts === "string") {
    const parsed = Date.parse(raw.ts);
    if (Number.isNaN(parsed)) {
      return { ok: false, error: "ts must be ISO-8601 or omitted" };
    }
    ts = new Date(parsed).toISOString();
  } else {
    return { ok: false, error: "ts must be ISO-8601 or omitted" };
  }

  if (looksSensitive(bot) && EMAIL_RE.test(bot)) {
    return { ok: false, error: "bot still looks sensitive after sanitize" };
  }

  let from: string | undefined;
  if (raw.from != null && raw.from !== "") {
    if (typeof raw.from !== "string") return { ok: false, error: "from must be a string ≤40" };
    if (MEDICAL_RE.test(raw.from) || PRIVATE_TERMS_RE.test(raw.from)) {
      return { ok: false, error: "from rejected: sensitive content" };
    }
    from = stripSensitive(clip(raw.from, MAX_BOT)) || undefined;
  }
  if (!from && detail) {
    const m = /^from\s+([A-Za-z0-9][\w .-]{0,38}?)\s*:/i.exec(detail);
    if (m) from = m[1].trim();
  }

  let status: string | undefined;
  if (raw.status != null && raw.status !== "") {
    if (typeof raw.status !== "string") return { ok: false, error: "status must be a string" };
    status = clip(stripSensitive(raw.status), MAX_STATUS).toLowerCase() || undefined;
  }

  let kind: string | undefined;
  if (raw.kind != null && raw.kind !== "") {
    if (typeof raw.kind !== "string") return { ok: false, error: "kind must be a string" };
    kind = clip(stripSensitive(raw.kind), MAX_KIND).toLowerCase() || undefined;
  }
  // This glass stores Drivr notes, to-dos, and ideas only.
  // Never infer kind from status. status is lifecycle only (open/done/working).
  if (kind !== "note" && kind !== "todo" && kind !== "idea") {
    return { ok: false, error: "kind must be note, todo, or idea" };
  }

  const out: Omit<Trace, "id"> = { bot, summary, ts };
  if (detail) out.detail = detail;
  if (result) out.result = result;
  if (from) out.from = from;
  if (status) out.status = status;
  if (kind) out.kind = kind;
  return { ok: true, trace: out };
}

/** True when a sanitized trace belongs on the tap-with-voice capture mirror. */
export function isCaptureTrace(t: { kind?: string; status?: string; bot?: string }): boolean {
  const kind = String(t.kind || "").toLowerCase();
  return CAPTURE_KINDS.has(kind);
}

/**
 * Research / news digest lane (locked v-capture-card-15).
 * Push with kind:"research" (not a Capture kind). Renders above Fleet.
 * Capture kinds remain note|todo|idea|capture only — research never lands in Capture.
 */
export function isResearchTrace(t: { kind?: string }): boolean {
  return String(t.kind || "").toLowerCase() === "research";
}
