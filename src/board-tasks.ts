import { clipText, looksSensitive, stripSensitive } from "./sanitize";

export const BOARD_COLUMNS = [
  "todo",
  "doing",
  "waiting",
  "waiting_richard",
  "done",
] as const;

export type BoardColumn = (typeof BOARD_COLUMNS)[number];

export type BoardTask = {
  id: string;
  title: string;
  bot: string;
  area?: string;
  date?: string;
  column: BoardColumn;
  source?: string;
};

export type TaskBoard = {
  updatedAt: string;
  tasks: BoardTask[];
};

export const MAX_TASKS = 80;
const MAX_ID = 64;
const MAX_TITLE = 200;
const MAX_BOT = 40;
const MAX_AREA = 40;
const MAX_DATE = 160;
const MAX_SOURCE = 40;
const MAX_IDEMPOTENCY = 80;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const COLUMN_SET = new Set<string>(BOARD_COLUMNS);

export type BoardSanitizeResult =
  | { ok: true; board: TaskBoard }
  | { ok: false; error: string };

function cleanLine(label: string, value: unknown, max: number, required: boolean): { ok: true; text?: string } | { ok: false; error: string } {
  if (value == null || value === "") {
    if (required) return { ok: false, error: `${label} is required` };
    return { ok: true, text: undefined };
  }
  if (typeof value !== "string") return { ok: false, error: `${label} must be a string` };
  if (looksSensitive(value)) return { ok: false, error: `${label} rejected: sensitive content` };
  const text = clipText(stripSensitive(value), max);
  if (required && !text) return { ok: false, error: `${label} is required` };
  return { ok: true, text: text || undefined };
}

export function sanitizeTaskBoard(raw: unknown): BoardSanitizeResult {
  if (raw == null || typeof raw !== "object") {
    return { ok: false, error: "body must be a JSON object" };
  }
  const body = raw as { updatedAt?: unknown; tasks?: unknown };
  if (!Array.isArray(body.tasks)) {
    return { ok: false, error: "tasks must be an array" };
  }
  if (body.tasks.length > MAX_TASKS) {
    return { ok: false, error: `too many tasks (max ${MAX_TASKS})` };
  }

  const tasks: BoardTask[] = [];
  const seen = new Set<string>();
  for (const item of body.tasks) {
    if (item == null || typeof item !== "object") {
      return { ok: false, error: "each task must be an object" };
    }
    const row = item as Record<string, unknown>;
    const idRes = cleanLine("id", row.id, MAX_ID, true);
    if (!idRes.ok) return idRes;
    const id = idRes.text!;
    if (!ID_RE.test(id)) return { ok: false, error: "id must be letters, numbers, underscores, or hyphens" };
    if (seen.has(id)) return { ok: false, error: `duplicate task id: ${id}` };
    seen.add(id);

    const titleRes = cleanLine("title", row.title, MAX_TITLE, true);
    if (!titleRes.ok) return titleRes;
    const botRes = cleanLine("bot", row.bot, MAX_BOT, true);
    if (!botRes.ok) return botRes;
    const areaRes = cleanLine("area", row.area, MAX_AREA, false);
    if (!areaRes.ok) return areaRes;
    const dateRes = cleanLine("date", row.date, MAX_DATE, false);
    if (!dateRes.ok) return dateRes;

    if (typeof row.column !== "string" || !COLUMN_SET.has(row.column)) {
      return { ok: false, error: "column must be todo, doing, waiting, waiting_richard, or done" };
    }

    const sourceRes = cleanLine("source", row.source, MAX_SOURCE, false);
    if (!sourceRes.ok) return sourceRes;

    const task: BoardTask = {
      id,
      title: titleRes.text!,
      bot: botRes.text!,
      column: row.column as BoardColumn,
    };
    if (areaRes.text) task.area = areaRes.text;
    if (dateRes.text) task.date = dateRes.text;
    if (sourceRes.text) task.source = sourceRes.text;
    tasks.push(task);
  }

  let updatedAt = new Date().toISOString();
  if (body.updatedAt != null && body.updatedAt !== "") {
    if (typeof body.updatedAt !== "string") return { ok: false, error: "updatedAt must be an ISO-8601 string" };
    const ts = Date.parse(body.updatedAt);
    if (!Number.isFinite(ts)) return { ok: false, error: "updatedAt must be an ISO-8601 string" };
    updatedAt = new Date(ts).toISOString();
  }

  return { ok: true, board: { updatedAt, tasks } };
}

export type TaskPatch = {
  id: string;
  source: string;
  idempotencyKey: string;
  title?: string;
  bot?: string;
  area?: string;
  date?: string;
  column?: BoardColumn;
};

export type PatchSanitizeResult =
  | { ok: true; patch: TaskPatch }
  | { ok: false; error: string };

/** Per-item upsert body. source and idempotencyKey are required. */
export function sanitizeTaskPatch(taskId: string, raw: unknown): PatchSanitizeResult {
  const idRes = cleanLine("id", taskId, MAX_ID, true);
  if (!idRes.ok) return idRes;
  const id = idRes.text!;
  if (!ID_RE.test(id)) return { ok: false, error: "id must be letters, numbers, underscores, or hyphens" };

  if (raw == null || typeof raw !== "object") {
    return { ok: false, error: "body must be a JSON object" };
  }
  const row = raw as Record<string, unknown>;
  const sourceRes = cleanLine("source", row.source, MAX_SOURCE, true);
  if (!sourceRes.ok) return sourceRes;
  const keyRes = cleanLine("idempotencyKey", row.idempotencyKey, MAX_IDEMPOTENCY, true);
  if (!keyRes.ok) return keyRes;
  if (!ID_RE.test(keyRes.text!)) {
    return { ok: false, error: "idempotencyKey must be letters, numbers, underscores, or hyphens" };
  }

  const titleRes = cleanLine("title", row.title, MAX_TITLE, false);
  if (!titleRes.ok) return titleRes;
  const botRes = cleanLine("bot", row.bot, MAX_BOT, false);
  if (!botRes.ok) return botRes;
  const areaRes = cleanLine("area", row.area, MAX_AREA, false);
  if (!areaRes.ok) return areaRes;
  const dateRes = cleanLine("date", row.date, MAX_DATE, false);
  if (!dateRes.ok) return dateRes;

  let column: BoardColumn | undefined;
  if (row.column != null && row.column !== "") {
    if (typeof row.column !== "string" || !COLUMN_SET.has(row.column)) {
      return { ok: false, error: "column must be todo, doing, waiting, waiting_richard, or done" };
    }
    column = row.column as BoardColumn;
  }

  const patch: TaskPatch = {
    id,
    source: sourceRes.text!,
    idempotencyKey: keyRes.text!,
  };
  if (titleRes.text) patch.title = titleRes.text;
  if (botRes.text) patch.bot = botRes.text;
  if (areaRes.text) patch.area = areaRes.text;
  if (dateRes.text) patch.date = dateRes.text;
  if (column) patch.column = column;
  return { ok: true, patch };
}
