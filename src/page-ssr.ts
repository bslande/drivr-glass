/** Server-rendered cabin markup so a paired browser shows notes even if JS never runs. */

import type { BoardTask } from "./board-tasks";
import type { Trace } from "./sanitize";
import { GLASS_UI_VER } from "./ui-ver";

export const BOARD_DOING_MAX = 6;

export type GlassPageData = {
  traces: Trace[];
  tasks: BoardTask[];
  updatedAt: string;
  noJs: boolean;
  /** True when the Worker successfully read the store for this request. */
  ssr: boolean;
  sessionId: string;
};

export function emptyGlassPageData(sessionId: string, noJs = false): GlassPageData {
  return { traces: [], tasks: [], updatedAt: "", noJs, ssr: false, sessionId };
}

export function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** JSON for a <script type="application/json"> boot payload. */
export function escJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function noJsHref(sessionId: string): string {
  return `/s/${encodeURIComponent(sessionId)}?nojs=1`;
}

export function renderPageHeadExtras(data: GlassPageData): string {
  const parts: string[] = [];
  if (data.noJs) {
    parts.push('  <meta http-equiv="refresh" content="30" />');
  }
  if (data.sessionId) {
    parts.push(
      `  <noscript><meta http-equiv="refresh" content="30;url=${esc(noJsHref(data.sessionId))}" /></noscript>`,
    );
  } else {
    parts.push('  <noscript><meta http-equiv="refresh" content="30" /></noscript>');
  }
  return parts.join("\n");
}

export function bootJson(data: GlassPageData): string {
  return escJson({
    ui: GLASS_UI_VER,
    traces: data.traces,
    tasks: data.tasks,
    updatedAt: data.updatedAt,
    ssr: data.ssr,
  });
}

function formatBoardUpdated(iso: string): string {
  if (!iso) return "";
  try {
    return "Updated " + new Date(iso).toLocaleString("en-US", {
      timeZone: "America/Chicago",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function boardMeta(t: BoardTask): string {
  const parts: string[] = [];
  if (t.bot) parts.push(t.bot);
  if (t.area) parts.push(t.area);
  if (t.date) parts.push(t.date);
  return parts.join(" · ");
}

function boardItemHtml(t: BoardTask): string {
  const meta = boardMeta(t);
  return (
    '<li class="board-item"><p class="board-item-title">' +
    esc(t.title || "") +
    "</p>" +
    (meta ? '<p class="board-item-meta">' + esc(meta) + "</p>" : "") +
    "</li>"
  );
}

export type BoardMarkup = {
  updated: string;
  emptyHidden: boolean;
  waitingHidden: boolean;
  doingHidden: boolean;
  waitingItems: string;
  doingItems: string;
  moreHidden: boolean;
  moreText: string;
  restHidden: boolean;
  restText: string;
};

export function renderBoardMarkup(tasks: BoardTask[], updatedAt: string): BoardMarkup {
  const waiting: BoardTask[] = [];
  const doing: BoardTask[] = [];
  let todo = 0;
  let waitingRichard = 0;
  for (const t of tasks) {
    if (!t) continue;
    if (t.column === "waiting") waiting.push(t);
    else if (t.column === "doing") doing.push(t);
    else if (t.column === "todo") todo += 1;
    else if (t.column === "waiting_richard") waitingRichard += 1;
  }
  const hasOpen = waiting.length || doing.length || todo || waitingRichard;
  const shown = doing.slice(0, BOARD_DOING_MAX);
  const bits: string[] = [];
  if (todo) bits.push(todo === 1 ? "1 to do" : todo + " to do");
  if (waitingRichard) {
    bits.push(waitingRichard === 1 ? "1 waiting on Richard" : waitingRichard + " waiting on Richard");
  }
  return {
    updated: formatBoardUpdated(updatedAt),
    emptyHidden: !!hasOpen,
    waitingHidden: waiting.length === 0,
    doingHidden: doing.length === 0,
    waitingItems: waiting.map(boardItemHtml).join(""),
    doingItems: shown.map(boardItemHtml).join(""),
    moreHidden: doing.length <= BOARD_DOING_MAX,
    moreText: doing.length > BOARD_DOING_MAX ? "+" + (doing.length - BOARD_DOING_MAX) + " more in progress" : "",
    restHidden: bits.length === 0,
    restText: bits.length ? "Also " + bits.join(" · ") : "",
  };
}

type CaptureItem = {
  key: string;
  summary: string;
  kind: string;
  done: boolean;
  detail: string;
  ts: string;
};

const CAPTURE_KINDS: Record<string, number> = { note: 1, todo: 1, idea: 1, capture: 1 };
const HB_RE = /^Watching named bots/i;

function captureKindOf(t: Trace): string {
  const kind = String(t.kind || "").toLowerCase();
  if (CAPTURE_KINDS[kind]) return kind === "capture" ? "note" : kind;
  return "note";
}

function bodyText(t: Trace): string {
  const r = String(t.result || "").trim();
  const d = String(t.detail || "").trim();
  if (r && d) {
    if (r === d) return r;
    if (r.includes(d)) return r;
    if (d.includes(r)) return d;
    return r + "\n\n" + d;
  }
  return r || d || "";
}

function captureIsDone(t: Trace): boolean {
  const status = String(t.status || "").toLowerCase();
  return status === "done" || status === "closed";
}

function rtrim(s: string): string {
  return s.replace(/\s+$/g, "");
}

function clipPlain(s: string, n: number): string {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  if (t.length > n) return rtrim(t.slice(0, n - 1)) + "…";
  return t;
}

function collectCaptureItems(traces: Trace[]): { open: CaptureItem[]; done: CaptureItem[] } {
  const sorted = traces.slice().sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
  const map: Record<string, Trace> = {};
  const order: string[] = [];
  for (const t of sorted) {
    const kind = String(t.kind || "").toLowerCase();
    if (!CAPTURE_KINDS[kind]) continue;
    const summary = String(t.summary || "").trim();
    if (!summary || HB_RE.test(summary)) continue;
    const key = summary.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 240);
    if (!key) continue;
    if (!map[key]) {
      map[key] = t;
      order.push(key);
    }
  }
  const open: CaptureItem[] = [];
  const done: CaptureItem[] = [];
  for (const key of order) {
    const t = map[key];
    const item: CaptureItem = {
      key,
      summary: String(t.summary || ""),
      kind: captureKindOf(t),
      done: captureIsDone(t),
      detail: bodyText(t),
      ts: t.ts,
    };
    if (item.done) done.push(item);
    else open.push(item);
  }
  open.sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
  done.sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
  return { open, done };
}

function formatCaptureTime(iso: string): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Denver",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso)) + " Denver";
  } catch {
    return iso;
  }
}

function captureItemHtml(it: CaptureItem): string {
  const body = clipPlain(it.detail || "", 280);
  const title = clipPlain(it.summary, 240);
  const bodyHtml =
    body && body !== title ? '<p class="cap-dense-body">' + esc(body) + "</p>" : "";
  return (
    '<li class="cap-ssr-item">' +
    '<span class="cap-kind">' + esc(it.kind) + "</span>" +
    '<p class="cap-title">' + esc(title) + "</p>" +
    bodyHtml +
    '<p class="cap-meta">' + esc(formatCaptureTime(it.ts)) + "</p>" +
    "</li>"
  );
}

export type CaptureMarkup = {
  emptyHidden: boolean;
  countHidden: boolean;
  countText: string;
  listHtml: string;
  doneHidden: boolean;
  doneSummary: string;
  doneHtml: string;
};

export function renderCaptureMarkup(traces: Trace[]): CaptureMarkup {
  const bag = collectCaptureItems(traces);
  const todos = bag.open.filter((it) => it.kind === "todo").length;
  const ideas = bag.open.filter((it) => it.kind === "idea").length;
  const notes = bag.open.filter((it) => it.kind === "note").length;
  const bits: string[] = [];
  if (todos) bits.push(todos + " todo" + (todos === 1 ? "" : "s"));
  if (ideas) bits.push(ideas + " idea" + (ideas === 1 ? "" : "s"));
  if (notes) bits.push(notes + " note" + (notes === 1 ? "" : "s"));
  return {
    emptyHidden: bag.open.length > 0,
    countHidden: bag.open.length === 0,
    countText: bits.join(" · "),
    listHtml: bag.open.map(captureItemHtml).join(""),
    doneHidden: bag.done.length === 0,
    doneSummary: bag.done.length ? "Done this drive · " + bag.done.length : "Done this drive",
    doneHtml: bag.done.map(captureItemHtml).join(""),
  };
}

export function attrHidden(hidden: boolean): string {
  return hidden ? " hidden" : "";
}
