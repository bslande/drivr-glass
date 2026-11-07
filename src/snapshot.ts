/**
 * Plain-fetch twin of TraceHub for cabin / in-car Grok.
 * GET /s/<id>/snapshot — text/plain by default; JSON via Accept or ?format=json.
 */
import type { ConstitutionRule } from "./constitution";
import { isCaptureTrace, isResearchTrace, type Trace } from "./sanitize";

export type SnapshotTrace = Trace;

export type SnapshotGroups = {
  capture: SnapshotTrace[];
  research: SnapshotTrace[];
  fleet: SnapshotTrace[];
};

export function groupTraces(traces: SnapshotTrace[]): SnapshotGroups {
  const capture: SnapshotTrace[] = [];
  const research: SnapshotTrace[] = [];
  const fleet: SnapshotTrace[] = [];
  for (const t of traces) {
    if (isCaptureTrace(t)) capture.push(t);
    else if (isResearchTrace(t)) research.push(t);
    else fleet.push(t);
  }
  return { capture, research, fleet };
}

function sortNewestFirst(a: SnapshotTrace, b: SnapshotTrace): number {
  return String(b.ts || "").localeCompare(String(a.ts || ""));
}

function formatTs(ts: string | undefined): string {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return ts;
    return d.toLocaleString("en-US", {
      timeZone: "America/Denver",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }) + " MT";
  } catch {
    return ts;
  }
}

function bodyOf(t: SnapshotTrace): string {
  const parts: string[] = [];
  if (t.result && t.result.trim()) parts.push(t.result.trim());
  if (t.detail && t.detail.trim() && t.detail.trim() !== (t.result || "").trim()) {
    parts.push(t.detail.trim());
  }
  return parts.join("\n\n");
}

function formatTraceBlock(t: SnapshotTrace, index: number): string {
  const lines: string[] = [];
  const kind = t.kind ? ` · ${t.kind}` : "";
  const status = t.status ? ` · ${t.status}` : "";
  const when = formatTs(t.ts);
  lines.push(`${index}. [${t.bot}${kind}${status}]${when ? ` (${when})` : ""}`);
  lines.push(`   ${t.summary}`);
  const body = bodyOf(t);
  if (body) {
    for (const line of body.split("\n")) {
      lines.push(`   ${line}`);
    }
  }
  if (t.from) lines.push(`   from: ${t.from}`);
  return lines.join("\n");
}

function section(title: string, items: SnapshotTrace[]): string {
  const sorted = [...items].sort(sortNewestFirst);
  if (sorted.length === 0) {
    return `## ${title}\n(none)\n`;
  }
  const blocks = sorted.map((t, i) => formatTraceBlock(t, i + 1));
  return `## ${title}\n${blocks.join("\n\n")}\n`;
}

function formatConstitution(rules: ConstitutionRule[]): string {
  const blocks = rules.map(
    (r) => `${r.n}. ${r.title}\n   ${r.body}`,
  );
  return `## Constitution (DRIVER MODE · ${rules.length} rules)\n${blocks.join("\n\n")}\n`;
}

/** Authenticated plain-text pull. Not a live feed for in-car Grok. */
export function formatSnapshotText(
  traces: SnapshotTrace[],
  constitutionRules: ConstitutionRule[],
  opts?: { ui?: string; generatedAt?: string },
): string {
  const groups = groupTraces(traces);
  const ui = opts?.ui || "";
  const generatedAt = opts?.generatedAt || new Date().toISOString();
  const header = [
    "# Drivr cabin glass snapshot",
    ui ? `ui: ${ui}` : null,
    `generated: ${generatedAt}`,
    "read: authenticated pull only. This file does not make in-car Grok aware.",
    `traces: ${traces.length} (capture ${groups.capture.length}, research ${groups.research.length}, fleet ${groups.fleet.length})`,
    "",
  ]
    .filter((x) => x != null)
    .join("\n");

  return (
    header +
    formatConstitution(constitutionRules) +
    "\n" +
    formatNestedKind("To-dos", traces, "todo") +
    "\n" +
    formatNestedKind("Ideas", traces, "idea") +
    "\n" +
    formatNestedKind("Notes", traces, "note") +
    "\n" +
    section("Research", groups.research) +
    "\n" +
    section("Fleet (live bot activity)", groups.fleet)
  );
}

function isDrivr(t: SnapshotTrace): boolean {
  return String(t.bot || "").toLowerCase() === "drivr";
}

function formatBullet(t: SnapshotTrace, depth: number): string {
  const pad = "  ".repeat(depth);
  const status = t.status ? ` (${t.status})` : "";
  const lines = [`${pad}- ${t.summary}${status}`];
  const body = bodyOf(t);
  if (body) {
    for (const line of body.split("\n")) lines.push(`${pad}  ${line}`);
  }
  return lines.join("\n");
}

/** Newest item is the face bullet. Older items of the same kind nest under it. */
function formatNestedKind(title: string, traces: SnapshotTrace[], kind: "todo" | "idea" | "note"): string {
  const items = traces.filter((t) => isDrivr(t) && String(t.kind || "").toLowerCase() === kind);
  const sorted = [...items].sort(sortNewestFirst);
  if (sorted.length === 0) return `## ${title}\n(none)\n`;
  const [face, ...older] = sorted;
  const lines = [`## ${title}`, formatBullet(face, 0)];
  for (const item of older) lines.push(formatBullet(item, 1));
  return lines.join("\n") + "\n";
}

export type SnapshotJson = {
  ui: string;
  generatedAt: string;
  constitution: ConstitutionRule[];
  capture: SnapshotTrace[];
  research: SnapshotTrace[];
  fleet: SnapshotTrace[];
  traces: SnapshotTrace[];
};

export function formatSnapshotJson(
  traces: SnapshotTrace[],
  constitutionRules: ConstitutionRule[],
  opts?: { ui?: string; generatedAt?: string },
): SnapshotJson {
  const groups = groupTraces(traces);
  return {
    ui: opts?.ui || "",
    generatedAt: opts?.generatedAt || new Date().toISOString(),
    constitution: constitutionRules,
    capture: [...groups.capture].sort(sortNewestFirst),
    research: [...groups.research].sort(sortNewestFirst),
    fleet: [...groups.fleet].sort(sortNewestFirst),
    traces,
  };
}

/** True when client asked for JSON (Accept or ?format=json). */
export function wantsSnapshotJson(request: Request, url: URL): boolean {
  const fmt = (url.searchParams.get("format") || "").toLowerCase();
  if (fmt === "json") return true;
  const accept = (request.headers.get("Accept") || "").toLowerCase();
  // Prefer json when explicitly listed before text/plain, or sole preference.
  if (accept.includes("application/json") && !accept.includes("text/plain")) return true;
  if (accept.includes("application/json") && accept.indexOf("application/json") < accept.indexOf("text/plain")) {
    return true;
  }
  // Common curl -H 'Accept: application/json'
  if (/^\s*application\/json\b/.test(accept)) return true;
  return false;
}
