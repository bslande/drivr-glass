import { DurableObject } from "cloudflare:workers";
import type { Trace } from "./sanitize";
import { GLASS_UI_VER } from "./ui-ver";
import { PAIR_MAX_PENDING, PAIR_MAX_POLLS } from "./pair";

const MAX_TRACES = 50;
const HEARTBEAT_MS = 25_000;

type SseClient = {
  writer: WritableStreamDefaultWriter<Uint8Array>;
  alive: boolean;
};

type TraceRow = {
  id: string;
  bot: string;
  summary: string;
  detail: string | null;
  from_bot: string | null;
  status: string | null;
  result: string | null;
  kind: string | null;
  ts: string;
};

/**
 * Single fleet TraceHub: stores recent activity traces and fans out SSE.
 * One DO for the fleet board (coordination atom = the screen).
 */
export class TraceHub extends DurableObject {
  private clients = new Set<SseClient>();
  private encoder = new TextEncoder();
  private schemaReady = false;

  private ensureSchema(): void {
    if (this.schemaReady) return;
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS traces (
        id TEXT PRIMARY KEY,
        bot TEXT NOT NULL,
        summary TEXT NOT NULL,
        detail TEXT,
        ts TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_traces_ts ON traces(ts DESC);
    `);
    for (const ddl of [
      `ALTER TABLE traces ADD COLUMN from_bot TEXT`,
      `ALTER TABLE traces ADD COLUMN status TEXT`,
      `ALTER TABLE traces ADD COLUMN result TEXT`,
      `ALTER TABLE traces ADD COLUMN kind TEXT`,
    ]) {
      try {
        this.ctx.storage.sql.exec(ddl);
      } catch {
        /* column exists */
      }
    }
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS pairings (
        id TEXT PRIMARY KEY,
        phrase TEXT NOT NULL,
        verifier_hash TEXT NOT NULL,
        exp INTEGER NOT NULL,
        state TEXT NOT NULL,
        polls INTEGER NOT NULL,
        created INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pairings_verifier ON pairings(verifier_hash);
    `);
    this.schemaReady = true;
  }

  private listTraces(): Trace[] {
    this.ensureSchema();
    const rows = this.ctx.storage.sql
      .exec<TraceRow>(
        `SELECT id, bot, summary, detail, from_bot, status, result, kind, ts FROM traces ORDER BY ts DESC LIMIT ?`,
        MAX_TRACES,
      )
      .toArray();
    return rows.map((r) => {
      const t: Trace = { id: r.id, bot: r.bot, summary: r.summary, ts: r.ts };
      if (r.detail) t.detail = r.detail;
      if (r.from_bot) t.from = r.from_bot;
      if (r.status) t.status = r.status;
      if (r.result) t.result = r.result;
      if (r.kind) t.kind = r.kind;
      return t;
    });
  }

  private persist(trace: Trace): void {
    this.ensureSchema();
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO traces (id, bot, summary, detail, from_bot, status, result, kind, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      trace.id,
      trace.bot,
      trace.summary,
      trace.detail ?? null,
      trace.from ?? null,
      trace.status ?? null,
      trace.result ?? null,
      trace.kind ?? null,
      trace.ts,
    );
    this.ctx.storage.sql.exec(
      `DELETE FROM traces WHERE id NOT IN (
         SELECT id FROM traces ORDER BY ts DESC LIMIT ?
       )`,
      MAX_TRACES,
    );
  }

  private sseFrame(event: string, data: unknown, id?: string): Uint8Array {
    const lines: string[] = [];
    if (id) lines.push(`id: ${id}`);
    lines.push(`event: ${event}`);
    const payload = JSON.stringify(data);
    for (const line of payload.split("\n")) {
      lines.push(`data: ${line}`);
    }
    lines.push("", "");
    return this.encoder.encode(lines.join("\n"));
  }

  private async broadcast(event: string, data: unknown, id?: string): Promise<void> {
    const frame = this.sseFrame(event, data, id);
    const dead: SseClient[] = [];
    for (const client of this.clients) {
      try {
        await client.writer.write(frame);
      } catch {
        client.alive = false;
        dead.push(client);
      }
    }
    for (const c of dead) {
      this.clients.delete(c);
      try {
        await c.writer.close();
      } catch {
        /* already closed */
      }
    }
  }

  /** Add a sanitized trace and fan out to SSE clients. */
  async addTrace(trace: Omit<Trace, "id"> & { id?: string }): Promise<Trace> {
    const full: Trace = {
      id: trace.id ?? crypto.randomUUID(),
      bot: trace.bot,
      summary: trace.summary,
      ts: trace.ts,
    };
    if (trace.detail) full.detail = trace.detail;
    if (trace.from) full.from = trace.from;
    if (trace.status) full.status = trace.status;
    if (trace.result) full.result = trace.result;
    if (trace.kind) full.kind = trace.kind;
    this.persist(full);
    await this.broadcast("trace", full, full.id);
    // Full snapshot after each push so clients that miss incremental `trace` (or wake mid-batch) catch up without a hard refresh.
    await this.broadcast("snapshot", { ui: GLASS_UI_VER, traces: this.listTraces() });
    console.log(JSON.stringify({ message: "trace_added", bot: full.bot, id: full.id }));
    return full;
  }

  async list(): Promise<Trace[]> {
    return this.listTraces();
  }

  /** Delete every stored trace and push an empty SSE snapshot to open clients. */
  async clearAll(): Promise<number> {
    this.ensureSchema();
    const before = this.ctx.storage.sql
      .exec<{ c: number }>(`SELECT COUNT(*) AS c FROM traces`)
      .toArray();
    const count = before[0]?.c ?? 0;
    this.ctx.storage.sql.exec(`DELETE FROM traces`);
    await this.broadcast("snapshot", { ui: GLASS_UI_VER, traces: [] });
    console.log(JSON.stringify({ message: "traces_cleared", deleted: count }));
    return count;
  }

  /** Drop expired rows. Returns false when too many live requests are already waiting. */
  private preparePairings(now: number): boolean {
    this.ensureSchema();
    this.ctx.storage.sql.exec(`DELETE FROM pairings WHERE exp < ?`, now);
    const rows = this.ctx.storage.sql
      .exec<{ c: number }>(`SELECT COUNT(*) AS c FROM pairings WHERE state = 'pending'`)
      .toArray();
    return (rows[0]?.c ?? 0) < PAIR_MAX_PENDING;
  }

  startPair(input: { id: string; phrase: string; verifierHash: string; exp: number; now: number }): { ok: true } | { ok: false; error: string } {
    if (!this.preparePairings(input.now)) return { ok: false, error: "busy" };
    try {
      this.ctx.storage.sql.exec(
        `INSERT INTO pairings (id, phrase, verifier_hash, exp, state, polls, created) VALUES (?, ?, ?, ?, 'pending', 0, ?)`,
        input.id,
        input.phrase,
        input.verifierHash,
        input.exp,
        input.now,
      );
    } catch {
      return { ok: false, error: "exists" };
    }
    return { ok: true };
  }

  lookupPair(id: string, now: number): { phrase: string; state: string; exp: number } | null {
    this.ensureSchema();
    const rows = this.ctx.storage.sql
      .exec<{ phrase: string; state: string; exp: number }>(
        `SELECT phrase, state, exp FROM pairings WHERE id = ?`,
        id,
      )
      .toArray();
    const row = rows[0];
    if (!row || row.exp < now || row.state !== "pending") return null;
    return row;
  }

  markPairApproved(id: string): boolean {
    this.ensureSchema();
    this.ctx.storage.sql.exec(
      `UPDATE pairings SET state = 'approved' WHERE id = ? AND state = 'pending'`,
      id,
    );
    const rows = this.ctx.storage.sql
      .exec<{ state: string }>(`SELECT state FROM pairings WHERE id = ?`, id)
      .toArray();
    return rows[0]?.state === "approved";
  }

  /**
   * Poll is only meaningful for the browser whose verifier hash matches one row.
   * Approving does not hand the read cookie to the caller of markPairApproved.
   */
  pollPair(verifierHash: string, now: number): { state: "pending" | "ready" | "expired" | "unknown" } {
    this.ensureSchema();
    const rows = this.ctx.storage.sql
      .exec<{ id: string; exp: number; state: string; polls: number }>(
        `SELECT id, exp, state, polls FROM pairings WHERE verifier_hash = ?`,
        verifierHash,
      )
      .toArray();
    const row = rows[0];
    if (!row) return { state: "unknown" };
    if (row.exp < now || row.polls >= PAIR_MAX_POLLS || row.state === "consumed") {
      this.ctx.storage.sql.exec(`DELETE FROM pairings WHERE id = ?`, row.id);
      return { state: "expired" };
    }
    const polls = row.polls + 1;
    if (row.state === "approved") {
      this.ctx.storage.sql.exec(`UPDATE pairings SET state = 'consumed', polls = ? WHERE id = ?`, polls, row.id);
      return { state: "ready" };
    }
    this.ctx.storage.sql.exec(`UPDATE pairings SET polls = ? WHERE id = ?`, polls, row.id);
    if (polls >= PAIR_MAX_POLLS) {
      this.ctx.storage.sql.exec(`DELETE FROM pairings WHERE id = ?`, row.id);
      return { state: "expired" };
    }
    return { state: "pending" };
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/events" && request.method === "GET") {
      return this.openSse(request.signal, request.headers.get("x-glass-once") === "1");
    }

    if (path === "/push" && request.method === "POST") {
      let body: (Omit<Trace, "id"> & { id?: string }) | { clear?: boolean };
      try {
        body = (await request.json()) as (Omit<Trace, "id"> & { id?: string }) | { clear?: boolean };
      } catch {
        return Response.json({ ok: false, error: "invalid JSON" }, { status: 400 });
      }
      if (body && typeof body === "object" && "clear" in body && body.clear === true) {
        const deleted = await this.clearAll();
        return Response.json({ ok: true, deleted }, { status: 200 });
      }
      const saved = await this.addTrace(body as Omit<Trace, "id"> & { id?: string });
      return Response.json({ ok: true, trace: saved }, { status: 201 });
    }

    if (path === "/clear" && request.method === "POST") {
      const deleted = await this.clearAll();
      return Response.json({ ok: true, deleted }, { status: 200 });
    }

    if (path === "/list" && request.method === "GET") {
      return Response.json(
        { ui: GLASS_UI_VER, traces: this.listTraces() },
        { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
      );
    }

    return new Response("Not found", { status: 404 });
  }

  private openSse(signal: AbortSignal, once: boolean): Response {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const client: SseClient = { writer, alive: true };
    this.clients.add(client);
    const stop = () => {
      client.alive = false;
    };
    if (signal.aborted) stop();
    else signal.addEventListener("abort", stop, { once: true });

    const start = async () => {
      try {
        await writer.write(
          this.sseFrame("snapshot", { ui: GLASS_UI_VER, traces: this.listTraces() }),
        );
        // One-shot readers (tests, and any authorized client that asks) stop after the snapshot.
        // The browser EventSource does not send this header, so it keeps the heartbeat.
        if (once) {
          client.alive = false;
          return;
        }
        await scheduler.wait(0);
        while (client.alive) {
          await Promise.race([
            scheduler.wait(HEARTBEAT_MS),
            new Promise<void>((resolve) => {
              if (!client.alive || signal.aborted) {
                resolve();
                return;
              }
              signal.addEventListener("abort", () => resolve(), { once: true });
            }),
          ]);
          if (!client.alive || signal.aborted) {
            client.alive = false;
            break;
          }
          try {
            await writer.write(this.encoder.encode(": keepalive\n\n"));
          } catch {
            client.alive = false;
            break;
          }
        }
      } catch {
        client.alive = false;
      } finally {
        this.clients.delete(client);
        try {
          await writer.close();
        } catch {
          /* ignore */
        }
      }
    };

    void start();

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }
}
