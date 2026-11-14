/**
 * Golden traces (rewrite plan, Phase 0): a flow drives the real app in
 * process, on the faux model and the frozen clock, and records what an
 * outside observer sees: each HTTP response, the SSE frames, and the app's
 * tables. The trace is normalized (generated ids, Dates) and compared with the
 * one committed under `traces/`. A rewrite PR must leave every trace as it is;
 * a signed-off behavior change updates only its own (`pnpm golden:update`).
 *
 * Determinism comes from the test setup: a fresh in-memory database per file,
 * `FIXED_NOW` (tests/test-clock.ts), the faux model, and flows that run their
 * steps in a fixed order. Each flow file runs on its own database, so integer
 * ids and conversation refs are stable too.
 */
import fs from "node:fs";
import path from "node:path";
import { getTableName, type Table } from "drizzle-orm";
import { expect, it } from "vite-plus/test";
import { api, type TestApp } from "../helpers";
import { db } from "../../../apps/web/src/server/db";

const TRACES = path.join(import.meta.dirname, "traces");

export type TraceStep =
  | { http: string; method: string; path: string; status: number; body: unknown }
  | { sse: string; path: string; frames: unknown[] }
  | { db: string; tables: Record<string, unknown[]> }
  | { note: string; value: unknown };

export interface RequestInit {
  method?: string;
  json?: unknown;
  token?: string;
  headers?: Record<string, string>;
}

export interface Recorder {
  /** One request through the app; records status and body, returns `data`. */
  // oxlint-disable-next-line typescript/no-explicit-any -- each route's data differs
  http(name: string, path: string, init?: RequestInit): Promise<any>;
  /** Open an SSE route, read frames until `done` holds (or 50 reads), close it, record them. */
  sse(
    name: string,
    path: string,
    done: (frames: unknown[]) => boolean,
    token?: string,
  ): Promise<unknown[]>;
  /** Record whole tables, minus `omit` columns (salted hashes, sealed blobs). */
  db(name: string, tables: Table[], omit?: string[]): Promise<void>;
  /** Record a value the flow computed (a runtime read, a queue). */
  note(name: string, value: unknown): void;
}

/** Ids the app generates (cuid2, UUIDs, faux tool calls) become `<id1>`, `<id2>`… by first appearance. */
const ID_PATTERNS = [
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g,
  /\bc[a-z0-9]{23,31}\b/g,
  // Upload ids: 24 random hex digits (a 64-digit sha256 stays as it is).
  /\b[0-9a-f]{24}\b/g,
  // The faux model's tool-call ids: `tool:<time>:<random>`.
  /\btool:\d+:[a-z0-9]+\b/g,
];

/**
 * Measured wall-clock spans (a tool call's run, an owner's wait): the field
 * stays, its number becomes `<ms>`, since the frozen Date doesn't freeze them.
 */
const TIMING_KEYS = new Set(["durationMs", "waitedMs"]);

export function normalize(value: unknown): unknown {
  const ids = new Map<string, string>();
  const name = (id: string) => {
    if (!ids.has(id)) ids.set(id, `<id${ids.size + 1}>`);
    return ids.get(id)!;
  };
  const walk = (v: unknown): unknown => {
    if (v instanceof Date) return v.toISOString();
    if (typeof v === "string") {
      let out = v;
      for (const pattern of ID_PATTERNS) out = out.replace(pattern, name);
      return out;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => [
          walk(k) as string,
          TIMING_KEYS.has(k) && typeof x === "number" ? "<ms>" : walk(x),
        ]),
      );
    }
    return v;
  };
  return walk(value);
}

function createRecorder(
  app: TestApp,
  defaultToken: () => string,
): {
  recorder: Recorder;
  steps: TraceStep[];
} {
  const steps: TraceStep[] = [];
  const recorder: Recorder = {
    async http(name, routePath, init = {}) {
      const method = init.method ?? "GET";
      const response = await api(app, routePath, {
        method,
        token: init.token ?? defaultToken(),
        ...(init.headers ? { headers: init.headers } : {}),
        ...(init.json !== undefined ? { json: init.json } : {}),
      });
      steps.push({
        http: name,
        method,
        path: routePath,
        status: response.status,
        body: response.body,
      });
      return response.body.data;
    },
    async sse(name, routePath, done, token) {
      const response = await app.request(routePath, {
        headers: { authorization: `Bearer ${token ?? defaultToken()}` },
      });
      const frames: unknown[] = [];
      const reader = response.body?.getReader();
      if (reader) {
        const decoder = new TextDecoder();
        let buffer = "";
        for (let reads = 0; reads < 50 && !done(frames); reads++) {
          const { value, done: ended } = await reader.read();
          if (ended) break;
          buffer += decoder.decode(value, { stream: true });
          let cut: number;
          while ((cut = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, cut);
            buffer = buffer.slice(cut + 1);
            if (!line.startsWith("data:")) continue;
            const frame = JSON.parse(line.slice(5));
            // Keep-alives say only that the stream is open.
            if ((frame as { type?: string }).type !== "ping") frames.push(frame);
          }
        }
        await reader.cancel();
      }
      steps.push({ sse: name, path: routePath, frames });
      return frames;
    },
    async db(name, tables, omit = []) {
      const out: Record<string, unknown[]> = {};
      for (const table of tables) {
        const rows = (await db.select().from(table as never)) as Record<string, unknown>[];
        out[getTableName(table)] = rows.map((row) =>
          Object.fromEntries(Object.entries(row).filter(([key]) => !omit.includes(key))),
        );
      }
      steps.push({ db: name, tables: out });
    },
    note(name, value) {
      steps.push({ note: name, value });
    },
  };
  return { recorder, steps };
}

/** `traces/<name>.json`, as the committed baseline holds it. */
function tracePath(name: string): string {
  return path.join(TRACES, `${name}.json`);
}

/**
 * Register one golden flow: run it, normalize the trace, and compare it with
 * the committed baseline. `GOLDEN_UPDATE=1` (`pnpm golden:update`) writes the
 * baseline instead; it is only for a new flow or a signed-off behavior change.
 */
export function goldenFlow(
  name: string,
  setup: { app: TestApp; token: () => string },
  run: (r: Recorder) => Promise<void>,
  timeout = 30_000,
): void {
  it(
    name,
    async () => {
      const { recorder, steps } = createRecorder(setup.app, setup.token);
      await run(recorder);
      const trace = normalize(steps);
      const file = tracePath(name);
      if (process.env.GOLDEN_UPDATE === "1") {
        fs.mkdirSync(TRACES, { recursive: true });
        fs.writeFileSync(file, `${JSON.stringify(trace, null, 2)}\n`);
        return;
      }
      if (!fs.existsSync(file)) {
        throw new Error(`No golden trace for "${name}". Record it with pnpm golden:update.`);
      }
      const expected = JSON.parse(fs.readFileSync(file, "utf8"));
      expect(trace, `golden trace ${path.relative(process.cwd(), file)}`).toEqual(expected);
    },
    timeout,
  );
}
