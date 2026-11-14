import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { LIST, oldModuleProblems, type OldModules } from "../../../scripts/check-old-modules";

/**
 * Old-modules gate (scripts/check-old-modules.ts), the rewrite's step 6.1:
 * the real retired-paths list passes on this repo, and each kind of entry
 * fails on a small fixture repo that brings its old module back.
 */

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "old-modules-"));
  roots.push(root);
  for (const [file, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), body);
  }
  return root;
}

const NEW = "packages/new/src/index.ts";
const base = { [NEW]: "export const fresh = 1;\n" };

describe("old-modules gate", () => {
  it("passes this repo's retired-paths list", () => {
    const list = JSON.parse(readFileSync(LIST, "utf8")) as OldModules;
    expect(oldModuleProblems(process.cwd(), list)).toEqual([]);
  }, 30_000);

  it("fails a retired path that exists, and every import of it", () => {
    const root = repo({
      ...base,
      "packages/old/package.json": JSON.stringify({
        name: "@x/old",
        exports: { "./gone": "./src/gone/index.ts" },
      }),
      "packages/old/src/gone/index.ts": "export const old = 1;\n",
      "apps/web/src/client/lib/a.ts":
        'import { old } from "@/../../../../packages/old/src/gone";\n',
      "apps/web/src/server/b.ts": 'export { old } from "@x/old/gone";\n',
      "tests/c.test.ts": 'const m = await import("../packages/old/src/gone/index.ts");\n',
      "tests/d.test.ts": 'import { fresh } from "../packages/new/src";\n',
    });
    const problems = oldModuleProblems(root, {
      paths: [{ path: "packages/old/src/gone", replacedBy: NEW }],
    });
    expect(problems).toEqual([
      `packages/old/src/gone is on the retired-paths list but exists. Delete it; ${NEW} replaced it.`,
      `apps/web/src/client/lib/a.ts imports "@/../../../../packages/old/src/gone", which is retired (packages/old/src/gone). Import ${NEW} instead.`,
      `apps/web/src/server/b.ts imports "@x/old/gone", which is retired (packages/old/src/gone). Import ${NEW} instead.`,
      `tests/c.test.ts imports "../packages/old/src/gone/index.ts", which is retired (packages/old/src/gone). Import ${NEW} instead.`,
    ]);
  });

  it("fails a retired symbol declared anywhere, but not one only named in a string", () => {
    const root = repo({
      ...base,
      "packages/a/src/x.ts": "export function withGatePlan() {}\n",
      "packages/a/src/y.ts": "interface O {\n  persistPath?: string;\n}\n",
      "tests/z.test.ts": 'const fixture = "export function withGatePlan() {}";\n',
    });
    const problems = oldModuleProblems(root, {
      symbols: [
        { symbol: "withGatePlan", replacedBy: NEW, step: "3.2" },
        { symbol: "persistPath", replacedBy: NEW, step: "2.4" },
      ],
    });
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/^packages\/a\/src\/x\.ts:1 declares withGatePlan, /);
    expect(problems[1]).toMatch(/^packages\/a\/src\/y\.ts:2 declares persistPath, /);
  });

  it("fails a module singleton declared again at the top of its file", () => {
    const root = repo({
      ...base,
      "apps/web/src/server/r.ts":
        "let runtime: unknown;\nexport function get() {\n  const ready = true;\n  return ready;\n}\n",
    });
    expect(
      oldModuleProblems(root, {
        moduleState: [
          { file: "apps/web/src/server/r.ts", names: ["runtime", "ready"], replacedBy: NEW },
        ],
      }),
    ).toEqual([
      `apps/web/src/server/r.ts:1 declares module-level runtime, a singleton the App root replaced (${NEW}). Keep it in ${NEW}.`,
    ]);
  });

  it("fails a single-module helper declared outside its module", () => {
    const root = repo({
      ...base,
      "packages/sandbox/src/shell.ts": "export function shQuote(v: string) { return v; }\n",
      "packages/agent/src/run.ts": "function shQuote(v: string) { return v; }\n",
      "tests/t.test.ts": "function shQuote(v: string) { return v; }\n",
    });
    expect(
      oldModuleProblems(root, {
        definedOnlyIn: [
          {
            symbols: ["shQuote"],
            file: "packages/sandbox/src/shell.ts",
            scope: "packages/**",
            replacedBy: NEW,
            step: "3.6",
          },
        ],
      }),
    ).toEqual([
      "packages/agent/src/run.ts:1 declares shQuote, which lives only in packages/sandbox/src/shell.ts since the rewrite (3.6). Import it from there.",
    ]);
  });

  it("fails a retired pattern in the files it covers, not in its exceptions", () => {
    const root = repo({
      ...base,
      "apps/web/src/client/lib/tasks-api.ts":
        "export interface Task {}\nexport const tasksApi = {};\n",
      "apps/web/src/client/lib/tasks.ts": "export interface Task {}\n",
      "apps/web/src/client/lib/kept-api.ts": "export type Kept = 1;\n",
    });
    expect(
      oldModuleProblems(root, {
        patterns: [
          {
            pattern: "^export (type|interface)\\b",
            flags: "m",
            files: ["apps/web/src/client/lib/*-api.ts"],
            except: ["apps/web/src/client/lib/kept-api.ts"],
            what: "a hand-copied wire type",
            replacedBy: NEW,
            step: "5.1",
          },
        ],
      }),
    ).toEqual([
      `apps/web/src/client/lib/tasks-api.ts:1 has a hand-copied wire type (\`export interface\`), retired in 5.1. Use ${NEW}.`,
    ]);
  });

  it("fails a narrowed module that grows back (D13)", () => {
    const root = repo({
      ...base,
      "apps/bots.service.ts": [
        'import { x } from "./chats.service";',
        "export function createBot() {}",
        "export async function sendMessage(rt: { submit(): void }) {",
        "  rt.submit();",
        "}",
      ].join("\n"),
      "apps/chats.service.ts": "export async function sendMessage() {}\nfunction local() {}\n",
      "packages/sessions.ts": "const t = setInterval(() => {}, 1000);\n",
    });
    const problems = oldModuleProblems(root, {
      narrowed: [
        {
          file: "apps/bots.service.ts",
          role: "CRUD only",
          noDeclarationsExportedBy: "apps/chats.service.ts",
          forbid: [
            { pattern: "\\.submit\\(", why: "a chat action" },
            { pattern: 'from "\\./chats\\.service"', why: "chat depends on bots" },
          ],
        },
        {
          file: "packages/sessions.ts",
          role: "a LiveSessions instance",
          require: [{ pattern: "\\bcreateLiveSessions[<(]", why: "it is one" }],
          forbid: [{ pattern: "\\bsetInterval\\b", why: "the sweep is LiveSessions'" }],
        },
        { file: "apps/gone.ts", role: "thin" },
      ],
    });
    expect(problems).toEqual([
      "apps/bots.service.ts:4 has `.submit(`, but it must stay CRUD only: a chat action.",
      'apps/bots.service.ts:1 has `from "./chats.service"`, but it must stay CRUD only: chat depends on bots.',
      "apps/bots.service.ts:3 declares sendMessage, a chat action apps/chats.service.ts owns; apps/bots.service.ts must stay CRUD only.",
      "packages/sessions.ts must stay a LiveSessions instance: it no longer matches /\\bcreateLiveSessions[<(]/ (it is one).",
      "packages/sessions.ts:1 has `setInterval`, but it must stay a LiveSessions instance: the sweep is LiveSessions'.",
      `apps/gone.ts is a narrowed module (thin) but does not exist. Update ${LIST} if it was renamed.`,
    ]);
  });

  it("fails an in-repo import of a deprecated re-export", () => {
    const root = repo({
      ...base,
      "packages/agent/package.json": JSON.stringify({ name: "@x/agent" }),
      "packages/agent/src/index.ts": [
        "export { live } from './live';",
        "export {",
        "  /** @deprecated Import from `@x/models`. */",
        "  oldName,",
        '} from "@x/models";',
        "export type {",
        "  /** @deprecated Import from `@x/models`. */",
        "  OldType,",
        '} from "@x/models";',
        "",
      ].join("\n"),
      "packages/agent/src/inside.ts": 'import { oldName } from "@x/agent";\n',
      "apps/web/a.ts": 'import { live, oldName } from "@x/agent";\n',
      "apps/web/b.ts": 'import type { OldType as T } from "@x/agent";\n',
      "apps/web/c.ts": 'import { x } from "@x/agent/sandbox";\n',
    });
    const problems = oldModuleProblems(root, {
      deprecated: {
        package: "@x/agent",
        root: "packages/agent/src/index.ts",
        subpaths: ["@x/agent/sandbox"],
      },
    });
    expect(problems).toEqual([
      'apps/web/a.ts:1 imports oldName from "@x/agent", a deprecated re-export. Import it from the package that owns it (@tiny-agents/models or @tiny-agents/sandbox).',
      'apps/web/b.ts:1 imports OldType from "@x/agent", a deprecated re-export. Import it from the package that owns it (@tiny-agents/models or @tiny-agents/sandbox).',
      'apps/web/c.ts:1 imports "@x/agent/sandbox", a deprecated re-export of @tiny-agents/sandbox. Import the package itself.',
    ]);
  });

  it("fails an entry whose replacement does not exist", () => {
    const root = repo(base);
    expect(
      oldModuleProblems(root, { symbols: [{ symbol: "gone", replacedBy: "packages/nowhere.ts" }] }),
    ).toEqual([
      `${LIST}: replacedBy "packages/nowhere.ts" does not exist. Point it at what replaced the old module.`,
    ]);
  });
});
