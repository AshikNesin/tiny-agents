import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { boundaryOverrides } from "../../../scripts/lint/boundaries";

const repoRoot = process.cwd();
const vitePlus = createRequire(path.join(repoRoot, "package.json")).resolve(
  "vite-plus/package.json",
);
const oxlint = path.join(
  path.dirname(createRequire(vitePlus).resolve("oxlint/package.json")),
  "bin",
  "oxlint",
);

const SHELL_CN = 'import { cn } from "@groot/shell/lib/utils";';

const NESTED_SEPARATOR = `
import { BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@groot/ui/breadcrumb";
export const Crumbs = ({ name }: { name: string }) => (
  <BreadcrumbList>
    <BreadcrumbItem>
      <BreadcrumbSeparator />
      <BreadcrumbPage>{name}</BreadcrumbPage>
    </BreadcrumbItem>
  </BreadcrumbList>
);
`;

const MAPPED_NESTED_SEPARATOR = `
import { BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@groot/ui/breadcrumb";
export const Crumbs = ({ names }: { names: string[] }) => (
  <BreadcrumbList>
    {names.map((name) => (
      <BreadcrumbItem key={name}>
        <BreadcrumbSeparator />
        <BreadcrumbPage>{name}</BreadcrumbPage>
      </BreadcrumbItem>
    ))}
  </BreadcrumbList>
);
`;

const SIBLING_SEPARATOR = `
import { BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@groot/ui/breadcrumb";
export const Crumbs = ({ name }: { name: string }) => (
  <BreadcrumbList>
    <BreadcrumbItem>Home</BreadcrumbItem>
    <BreadcrumbSeparator />
    <BreadcrumbItem>
      <BreadcrumbPage>{name}</BreadcrumbPage>
    </BreadcrumbItem>
  </BreadcrumbList>
);
`;

const LI_IN_BREADCRUMBS = `
import { Breadcrumbs } from "@groot/ui/breadcrumb";
export const Crumbs = () => (
  <Breadcrumbs page="B">
    <li>
      <a href="/a">A</a>
    </li>
  </Breadcrumbs>
);
`;

const MAPPED_LI_IN_BREADCRUMBS = `
import { Breadcrumbs } from "@groot/ui/breadcrumb";
export const Crumbs = ({ names }: { names: string[] }) => (
  <Breadcrumbs page="Here">
    <>
      {names.map((name) => (
        <li key={name}>
          <a href={name}>{name}</a>
        </li>
      ))}
    </>
  </Breadcrumbs>
);
`;

const BUTTONS_IN_BREADCRUMBS = `
import { Breadcrumbs } from "@groot/ui/breadcrumb";
export const Crumbs = ({ names, go }: { names: string[]; go: (n: string) => void }) => (
  <Breadcrumbs page={names.at(-1)}>
    <a href="/">Root</a>
    {names.slice(0, -1).map((name) => (
      <button key={name} type="button" onClick={() => go(name)}>
        {name}
      </button>
    ))}
  </Breadcrumbs>
);
`;

type Fixture = { source: string; rules: string[]; mentions?: string };

const FIXTURES: Record<string, Fixture> = {
  "packages/shell/src/r1-fail.ts": {
    source: 'export { db } from "../../../apps/web/src/server/db";\n',
    rules: ["R1"],
    mentions: "have the app pass it in",
  },
  "packages/jobs/src/r1-alias-fail.ts": {
    source: 'export { api } from "@/lib/api";\n',
    rules: ["R1"],
  },
  "packages/shell/src/r1-pass.ts": {
    source: 'export { cn } from "@groot/ui/lib/utils";\n',
    rules: [],
  },
  "apps/web/src/server/r1-app-pass.ts": {
    source: 'export { db } from "./db";\n',
    rules: [],
  },
  "packages/core/src/auth/r2-fail.ts": {
    source: 'export { readFileSync } from "node:fs";\n',
    rules: ["R2"],
    mentions: "Use Web APIs",
  },
  "packages/core/src/auth/r2-bare-fail.ts": {
    source: 'export { join } from "path";\n',
    rules: ["R2"],
  },
  "packages/core/src/auth/r2-subpath-fail.ts": {
    source: 'import { readFile } from "node:fs/promises";\nexport const x = readFile;\n',
    rules: ["R2"],
  },
  "packages/core/src/auth/r2-subpath-reexport-fail.ts": {
    source: 'export { join } from "node:path/posix";\n',
    rules: ["R2"],
  },
  "packages/core/src/auth/r2-allowed-pass.ts": {
    source:
      'export { AsyncLocalStorage } from "node:async_hooks";\nexport { Buffer } from "node:buffer";\n',
    rules: [],
  },
  "packages/core/src/database/node.ts": {
    source: 'export { readFileSync } from "node:fs";\n',
    rules: [],
  },
  "packages/core/src/auth/r2-file-gets-r1.ts": {
    source: 'export { db } from "../../../../apps/web/src/server/db";\n',
    rules: ["R1"],
  },
  "packages/core/src/storage/node.ts": {
    source: 'export { db } from "../../../../apps/web/src/server/db";\n',
    rules: ["R1"],
  },
  "apps/web/src/server/api/code/r3-default-param-fail.ts": {
    source:
      "type Env = Readonly<Record<string, string | undefined>>;\nexport function shelleyUrl(env: Env = process.env) {\n  return env.SHELLEY_URL;\n}\n",
    rules: ["R3"],
    mentions: "`appEnv()`",
  },
  "apps/web/src/server/r3-global-fail.ts": {
    source: "export const url = globalThis.process.env.SHELLEY_URL;\n",
    rules: ["R3"],
  },
  "packages/agent/src/r3-destructure-fail.ts": {
    source: "const { env } = process;\nexport const url = env.SHELLEY_URL;\n",
    rules: ["R3"],
    mentions: "add the key to that schema",
  },
  "packages/agent/src/r3-computed-fail.ts": {
    source: 'export const url = process["env"].SHELLEY_URL;\n',
    rules: ["R3"],
  },
  "packages/agent/src/r3-import-fail.ts": {
    source: 'import { env } from "node:process";\nexport const url = env.SHELLEY_URL;\n',
    rules: ["R3"],
  },
  "apps/web/src/server/r3-pass.ts": {
    source:
      'import { appEnv } from "./env";\nconst options = { env: {} };\nconst { env } = options;\nexport const url = appEnv().SHELLEY_URL ?? env;\n',
    rules: [],
  },
  "apps/web/src/server/env.ts": {
    source: "export const appEnv = (source = process.env) => source;\n",
    rules: [],
  },
  "apps/web/src/server/entry.node.ts": {
    source: 'export const isProduction = process.env.NODE_ENV === "production";\n',
    rules: [],
  },
  "packages/claude-worker/src/bin.ts": {
    source: "export const token = process.env.CLAUDE_WORKER_TOKEN;\n",
    rules: [],
  },
  "tests/server/r3-test-pass.ts": {
    source: 'process.env.NODE_ENV = "test";\n',
    rules: [],
  },
  "vitest.config.server.ts": {
    source: "delete process.env.OPENAI_API_KEY;\n",
    rules: [],
  },
  "apps/web/src/client/r4-fail.tsx": {
    source: `${SHELL_CN}\nexport const x = cn("a");\n`,
    rules: ["R4"],
    mentions: "@groot/ui/lib/utils",
  },
  "apps/web/src/client/r4-reexport-fail.ts": {
    source: 'export { cn } from "@groot/shell/lib/utils";\n',
    rules: ["R4"],
  },
  "apps/web/src/client/r4-ts-suffix-fail.tsx": {
    source: 'import { cn } from "@groot/shell/lib/utils.ts";\nexport const x = cn("a");\n',
    rules: ["R4"],
  },
  "packages/core/src/auth/r4-and-r2-fail.ts": {
    source: `${SHELL_CN}\nexport { readFileSync } from "node:fs";\nexport const x = cn("a");\n`,
    rules: ["R2", "R4"],
  },
  "apps/web/src/client/r4-pass.tsx": {
    source:
      'import { cn } from "@groot/ui/lib/utils";\nimport { formatBytes } from "@groot/shell/lib/utils";\nexport const x = cn(formatBytes(1));\n',
    rules: [],
  },
  "apps/web/src/client/r5a-separator-fail.tsx": {
    source:
      'import { BreadcrumbSeparator } from "@groot/ui/breadcrumb";\nexport const S = BreadcrumbSeparator;\n',
    rules: ["R5a"],
    mentions: "<Breadcrumbs",
  },
  "packages/jobs/src/client/r5a-barrel-item-fail.tsx": {
    source: 'import { BreadcrumbItem } from "@groot/ui";\nexport const I = BreadcrumbItem;\n',
    rules: ["R5a"],
  },
  "apps/web/src/client/r5a-pass.tsx": {
    source:
      'import { Link } from "react-router-dom";\nimport { Breadcrumbs } from "@groot/ui/breadcrumb";\nexport const C = () => (\n  <Breadcrumbs page="Job">\n    <Link to="/jobs">Jobs</Link>\n  </Breadcrumbs>\n);\n',
    rules: [],
  },
  "apps/web/src/client/r5a-tsx-suffix-fail.tsx": {
    source:
      'import { BreadcrumbSeparator } from "@groot/ui/breadcrumb.tsx";\nexport const S = BreadcrumbSeparator;\n',
    rules: ["R5a"],
  },
  "apps/web/src/client/r5a-index-fail.tsx": {
    source: 'import { BreadcrumbItem } from "@groot/ui/index";\nexport const I = BreadcrumbItem;\n',
    rules: ["R5a"],
  },
  "packages/shell/src/pages/r5a-relative-fail.tsx": {
    source:
      'import { BreadcrumbSeparator } from "../../../ui/src/breadcrumb";\nexport const S = BreadcrumbSeparator;\n',
    rules: ["R5a"],
  },
  "apps/web/src/client/r5c-li-fail.tsx": {
    source: LI_IN_BREADCRUMBS,
    rules: ["R5c"],
    mentions: "Pass the link or button itself",
  },
  "packages/shell/src/r5c-mapped-li-fail.tsx": { source: MAPPED_LI_IN_BREADCRUMBS, rules: ["R5c"] },
  "packages/shell/src/r5c-pass.tsx": { source: BUTTONS_IN_BREADCRUMBS, rules: [] },
  "apps/web/src/client/r5b-fail.tsx": {
    source: NESTED_SEPARATOR,
    rules: ["R5a", "R5a", "R5b"],
    mentions: "Make it a sibling of the items",
  },
  "packages/shell/src/r5b-mapped-fail.tsx": {
    source: MAPPED_NESTED_SEPARATOR,
    rules: ["R5a", "R5a", "R5b"],
  },
  "packages/ui/src/r5b-pass.tsx": { source: SIBLING_SEPARATOR, rules: [] },
  "packages/agent/src/toolkits/r6-fail.ts": {
    source:
      'import type { JsonObject } from "@earendil-works/pi-durable";\ninterface Foo { a: string }\nexport const f = (x: Foo) => x as unknown as JsonObject;\n',
    rules: ["R6"],
    mentions: "durable-json.ts",
  },
  "packages/agent/src/r6-any-paren-fail.ts": {
    source: "export const f = (x: string) => (x as any) as number;\n",
    rules: ["R6"],
  },
  "packages/agent/src/r6-angle-fail.ts": {
    source: "export const f = (x: string) => <number>(<unknown>x);\n",
    rules: ["R6"],
  },
  "packages/agent/src/r6-pass.ts": {
    source: "export const f = (x: unknown) => x as string;\n",
    rules: [],
  },
  "packages/agent/src/testing-r6.ts": {
    source: "export const f = (x: string) => x as unknown as number;\n",
    rules: [],
  },
  "packages/agent/src/gate-r6b-fail.ts": {
    source:
      "type Hooks = { plan(args: { id: string }): void };\nexport const run = (hooks: Hooks, args: unknown) => hooks.plan(args as never);\n",
    rules: ["R6b"],
    mentions: "durable-json.ts",
  },
  "packages/agent/src/toolkits/r6b-angle-fail.ts": {
    source: "export const f = (x: string) => <never>x;\n",
    rules: ["R6b"],
  },
  "packages/agent/src/r6b-pass.ts": {
    source:
      'export const block = { type: "image", data: "", mimeType: "image/jpeg" } as const;\nexport const id = (n: number) => n as number & { brand: true };\n',
    rules: [],
  },
  "packages/agent/src/testing-r6b.ts": {
    source: "export const f = (x: string) => x as never;\n",
    rules: [],
  },
  "packages/claude-worker/src/r6-elsewhere-pass.ts": {
    source: "export const f = (x: string) => x as unknown as number;\n",
    rules: [],
  },
  "packages/core/src/auth/r7-fail.ts": {
    source:
      'import { db } from "../database";\nexport const run = () => db.transaction((tx) => tx);\n',
    rules: ["R7"],
    mentions: "compare-and-set",
  },
  "packages/jobs/src/server/r7-computed-fail.ts": {
    source: 'export const run = (db: any) => db["transaction"](() => 1);\n',
    rules: ["R7"],
  },
  "apps/web/src/server/r7-app-pass.ts": {
    source: 'import { db } from "./db";\nexport const run = () => db.transaction(() => 1);\n',
    rules: [],
  },
  "apps/web/src/server/r8a-fail.ts": {
    source: 'import Database from "better-sqlite3";\nexport const d = new Database(":memory:");\n',
    rules: ["R8a"],
    mentions: "bootstrap() sets it",
  },
  "packages/jobs/src/server/r8a-drizzle-fail.ts": {
    source: 'export { drizzle } from "drizzle-orm/better-sqlite3";\n',
    rules: ["R8a"],
  },
  "apps/web/src/server/r8a-node-sqlite-fail.ts": {
    source: 'export { DatabaseSync } from "node:sqlite";\n',
    rules: ["R8a"],
  },
  "apps/web/src/server/db/r8a-pass.ts": {
    source: 'export { drizzle } from "drizzle-orm/better-sqlite3";\n',
    rules: [],
  },
  "packages/agent/src/lock.ts": {
    source: 'export { DatabaseSync } from "node:sqlite";\n',
    rules: [],
  },
  "apps/web/src/server/r8b-fail.ts": {
    source: 'import { setDb } from "@groot/core/database";\nexport const s = setDb;\n',
    rules: ["R8b"],
    mentions: "only bootstrap() calls setDb",
  },
  "packages/core/src/auth/r8b-relative-fail.ts": {
    source: 'export { setDb } from "../database";\n',
    rules: ["R8b"],
  },
  "packages/core/src/bootstrap.ts": {
    source: 'import { setDb } from "./database";\nexport const s = setDb;\n',
    rules: [],
  },
  "apps/web/src/server/r8b-pass.ts": {
    source: 'import { db } from "@groot/core/database";\nexport const d = db;\n',
    rules: [],
  },
};

type Diagnostic = { filename: string; message: string; help?: string };

let dir: string;
let findings: Map<string, string[]>;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "lint-boundaries-"));
  const config = {
    overrides: boundaryOverrides(path.join(repoRoot, "scripts/lint/repo-plugin.mjs")),
  };
  writeFileSync(path.join(dir, "boundaries.json"), JSON.stringify(config));
  for (const [file, { source }] of Object.entries(FIXTURES)) {
    mkdirSync(path.join(dir, path.dirname(file)), { recursive: true });
    writeFileSync(path.join(dir, file), source);
  }
  const run = spawnSync(oxlint, ["-c", "boundaries.json", "--format", "json", "."], {
    cwd: dir,
    encoding: "utf8",
  });
  const { diagnostics } = JSON.parse(run.stdout) as { diagnostics: Diagnostic[] };
  findings = new Map();
  for (const d of diagnostics) {
    findings.set(d.filename, [...(findings.get(d.filename) ?? []), `${d.message} ${d.help ?? ""}`]);
  }
}, 60_000);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("boundary lint rules", () => {
  it.each(Object.entries(FIXTURES))("%s", (file, { rules, mentions }) => {
    const texts = findings.get(file) ?? [];
    const fired = texts.map((t) => /\b(R\d[a-z]?): /.exec(t)?.[1]).toSorted();
    expect(fired, texts.join("\n")).toEqual(rules);
    if (mentions) expect(texts.join("\n")).toContain(mentions);
  });
});
