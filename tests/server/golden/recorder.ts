import fs from "node:fs";
import path from "node:path";
import { getTableName, type Table } from "drizzle-orm";
import { expect, it } from "vite-plus/test";
import { api, type TestApp } from "../helpers";
import { db } from "../../../apps/web/src/server/db";

const TRACES = path.join(import.meta.dirname, "traces");

type TraceStep =
  | { http: string; method: string; path: string; status: number; body: unknown }
  | { sse: string; path: string; frames: unknown[] }
  | { db: string; tables: Record<string, unknown[]> }
  | { note: string; value: unknown };

interface RequestInit {
  method?: string;
  json?: unknown;
  token?: string;
  headers?: Record<string, string>;
}

export interface Recorder {
  // oxlint-disable-next-line typescript/no-explicit-any
  http(name: string, path: string, init?: RequestInit): Promise<any>;
  sse(
    name: string,
    path: string,
    done: (frames: unknown[]) => boolean,
    token?: string,
  ): Promise<unknown[]>;
  db(name: string, tables: Table[], omit?: string[]): Promise<void>;
  note(name: string, value: unknown): void;
}

const ID_PATTERNS = [
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g,
  /\bc[a-z0-9]{23,31}\b/g,
  /\b[0-9a-f]{24}\b/g,
  /\btool:\d+:[a-z0-9]+\b/g,
];

const TIMING_KEYS = new Set(["durationMs", "waitedMs"]);

const ENTRY_ID = /^e\d+$/;
const ENTRY_CURSOR = /\b(before=)(e\d+)\b/g;

function normalize(value: unknown): unknown {
  const ids = new Map<string, string>();
  const name = (id: string) => {
    if (!ids.has(id)) ids.set(id, `<id${ids.size + 1}>`);
    return ids.get(id)!;
  };
  const entries = new Map<string, string>();
  const entry = (id: string) => {
    if (!entries.has(id)) entries.set(id, `<e${entries.size + 1}>`);
    return entries.get(id)!;
  };
  const walk = (v: unknown): unknown => {
    if (v instanceof Date) return v.toISOString();
    if (typeof v === "string") {
      if (ENTRY_ID.test(v)) return entry(v);
      let out = v.replace(ENTRY_CURSOR, (_, prefix: string, id: string) => prefix + entry(id));
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

function tracePath(name: string): string {
  return path.join(TRACES, `${name}.json`);
}

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
