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
  "packages/core/src/auth/r7-alias-fail.ts": {
    source:
      'import { db as appDb } from "@groot/core/database";\nconst handle = appDb;\nexport const run = () => handle.transaction(() => 1);\n',
    rules: ["R7"],
  },
  "packages/core/src/auth/r7-typed-fail.ts": {
    source:
      'import type { Database } from "../database";\nexport const run = (database: Database) => database.transaction(() => 1);\n',
    rules: ["R7"],
  },
  "packages/jobs/src/server/r7-typeof-fail.ts": {
    source:
      'import { db } from "@groot/core/database";\nexport const run = (handle: typeof db) => handle.transaction(() => 1);\n',
    rules: ["R7"],
  },
  "packages/jobs/src/server/r7-member-fail.ts": {
    source:
      "export const run = (ctx: { db: { transaction(f: () => void): void } }) => ctx.db.transaction(() => {});\n",
    rules: ["R7"],
  },
  "packages/core/src/auth/r7-getter-fail.ts": {
    source:
      'import { db } from "../database";\nconst getDb = () => db;\nexport const run = () => getDb().transaction(() => 1);\n',
    rules: ["R7"],
  },
  "packages/jobs/src/server/r7-getter-local-fail.ts": {
    source:
      'import { getDb } from "@groot/core/database";\nexport const run = () => {\n  const handle = getDb();\n  return handle.transaction(() => 1);\n};\n',
    rules: ["R7"],
  },
  "packages/core/src/auth/r7-assigned-fail.ts": {
    source:
      'import { db } from "../database";\nexport const run = () => {\n  let handle;\n  handle = db;\n  return handle.transaction(() => 1);\n};\n',
    rules: ["R7"],
  },
  "packages/jobs/src/server/r7-destructured-fail.ts": {
    source:
      "export const run = (deps: { db: any }) => {\n  const { db: handle } = deps;\n  return handle.transaction(() => 1);\n};\n",
    rules: ["R7"],
  },
  "packages/ui/src/r7-indexeddb-pass.ts": {
    source:
      'const getDatabase = (): IDBDatabase => indexedDB.open("app").result;\nexport const read = () => getDatabase().transaction("store");\nexport const viaLocal = () => {\n  const handle = getDatabase();\n  return handle.transaction("store");\n};\n',
    rules: [],
  },
  "packages/core/src/auth/r7-getter-function-fail.ts": {
    source:
      'import { db } from "../database";\nfunction database() {\n  return db;\n}\nexport const run = () => database().transaction(() => 1);\n',
    rules: ["R7"],
  },
  "packages/agent/src/r7-other-call-pass.ts": {
    source:
      'import { openStore } from "./store";\nexport const run = () => openStore().transaction(() => 1);\n',
    rules: [],
  },
  "packages/agent/src/r7-other-receiver-pass.ts": {
    source:
      "type Store = { transaction<T>(f: () => T): T };\nexport const run = (store: Store) => store.transaction(() => 1);\n",
    rules: [],
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
  "apps/web/src/server/r8a-require-fail.ts": {
    source: 'const Database = require("better-sqlite3");\nexport const d = Database;\n',
    rules: ["R8a"],
  },
  "apps/web/src/server/r8a-dynamic-fail.ts": {
    source: 'export const load = () => import("drizzle-orm/better-sqlite3");\n',
    rules: ["R8a"],
  },
  "apps/web/src/server/db/r8a-require-pass.ts": {
    source: 'const Database = require("better-sqlite3");\nexport const d = Database;\n',
    rules: [],
  },
  "packages/core/src/auth/r8b-index-js-fail.ts": {
    source: 'export { setDb } from "../database/index.js";\n',
    rules: ["R8b"],
  },
  "apps/web/src/server/db/r8b-fail.ts": {
    source: 'import { setDb } from "@groot/core/database";\nexport const s = setDb;\n',
    rules: ["R8b"],
  },
  "apps/web/src/server/db/index.ts": {
    source: 'import * as core from "@groot/core/database";\nexport const d = core.db;\n',
    rules: [],
  },
  "apps/web/src/server/api/vault/r9-fail.ts": {
    source:
      'import { sessionInvalid } from "@groot/core/utils/jwt.utils";\nexport const refuse = () => {\n  throw sessionInvalid("Wrong password");\n};\n',
    rules: ["R9", "R9"],
    mentions: "throw a plain Boom.unauthorized",
  },
  "packages/core/src/auth/r9-relative-fail.ts": {
    source: 'export { sessionInvalid } from "../utils/jwt.utils.js";\n',
    rules: ["R9"],
  },
  "packages/core/src/auth/r9-dynamic-import-fail.ts": {
    source:
      'export const refuse = async () => {\n  const jwt = await import("../utils/jwt.utils");\n  throw jwt.sessionInvalid("Wrong passkey");\n};\n',
    rules: ["R9"],
  },
  "apps/web/src/server/api/vault/r9-hand-built-fail.ts": {
    source:
      'import Boom from "@hapi/boom";\nimport { ErrorCode } from "@groot/core/errors";\nexport const refuse = () => {\n  throw Boom.unauthorized("Wrong password", undefined, ErrorCode.SESSION_INVALID.code);\n};\n',
    rules: ["R9"],
    mentions: "sets the SESSION_INVALID code",
  },
  "apps/web/src/server/api/vault/r9-literal-fail.ts": {
    source:
      'import Boom from "@hapi/boom";\nexport const refuse = () => {\n  throw Boom.unauthorized("Wrong password", undefined, "SESSION_INVALID");\n};\n',
    rules: ["R9"],
  },
  "apps/web/src/server/api/vault/r9-template-fail.ts": {
    source:
      'import Boom from "@hapi/boom";\nexport const refuse = () => {\n  throw Boom.unauthorized("Wrong password", undefined, `SESSION_INVALID`);\n};\n',
    rules: ["R9"],
  },
  "apps/web/src/server/api/vault/r9-concat-fail.ts": {
    source:
      'import Boom from "@hapi/boom";\nexport const refuse = () => {\n  throw Boom.unauthorized("Wrong password", undefined, "SESSION_" + "INVALID");\n};\n',
    rules: ["R9"],
    mentions: "throw a plain Boom.unauthorized",
  },
  "apps/web/src/server/api/vault/r9-template-piece-fail.ts": {
    source:
      'import Boom from "@hapi/boom";\nexport const refuse = () => {\n  throw Boom.unauthorized("Wrong password", undefined, `SESSION_${"INVALID"}`);\n};\n',
    rules: ["R9"],
  },
  "apps/web/src/server/api/vault/r9-const-piece-fail.ts": {
    source:
      'import Boom from "@hapi/boom";\nconst PREFIX = "SESSION_";\nexport const refuse = () => {\n  throw Boom.unauthorized("Wrong password", undefined, `${PREFIX}INVALID`);\n};\n',
    rules: ["R9"],
  },
  "packages/core/src/auth/r9-name-pieces-fail.ts": {
    source:
      'import * as jwt from "../utils/jwt.utils";\nexport const refuse = () => {\n  throw jwt["session" + "Invalid"]("Wrong passkey");\n};\n',
    rules: ["R9"],
  },
  "apps/web/src/server/api/vault/r9-pieces-pass.ts": {
    source:
      'const PREFIX = "SESSION_";\nexport const code = `${PREFIX}EXPIRED`;\nexport const label = (name: string) => "SESSION_" + name;\n',
    rules: [],
  },
  "apps/web/src/server/api/vault/r9-shadowed-pass.ts": {
    source:
      'export const a = () => {\n  const kind = "INVALID";\n  return kind;\n};\nexport const b = (kind: string) => "SESSION_" + kind;\n',
    rules: [],
  },
  "apps/web/src/server/api/vault/r9-shadowed-const-pass.ts": {
    source:
      'const A = "SESSION";\nexport const top = A;\nexport const code = () => {\n  const A = "OTHER";\n  return A + "_INVALID";\n};\n',
    rules: [],
  },
  "packages/core/src/session/index.ts": {
    source:
      'import Boom from "@hapi/boom";\nimport { ErrorCode } from "../errors";\nconst sessionInvalid = (m: string) => Boom.unauthorized(m, undefined, ErrorCode.SESSION_INVALID.code);\nexport const guard = () => {\n  throw sessionInvalid("No token provided");\n};\n',
    rules: [],
  },
  "packages/core/src/middlewares/jwt-auth.middleware.ts": {
    source:
      'import Boom from "@hapi/boom";\nexport const refuse = () => {\n  throw Boom.unauthorized("No token", undefined, "SESSION_INVALID");\n};\n',
    rules: ["R9"],
  },
  "packages/core/src/utils/jwt.utils.ts": {
    source:
      'import Boom from "@hapi/boom";\nimport { ErrorCode } from "../errors";\nexport const sessionInvalid = (m: string) => Boom.unauthorized(m, undefined, ErrorCode.SESSION_INVALID.code);\n',
    rules: ["R9", "R9"],
  },
  "apps/web/src/server/r9-pass.ts": {
    source:
      'import { requireSession, startSession } from "@groot/core/session";\nexport const g = [requireSession, startSession];\n',
    rules: [],
  },
  "apps/web/src/client/r15-effect-fail.tsx": {
    source:
      'import { useEffect, useState } from "react";\nimport { codeApi } from "./lib/code/api";\nexport function Diffs({ id }: { id: string }) {\n  const [files, setFiles] = useState<string[]>([]);\n  useEffect(() => {\n    void codeApi.files(id).then(setFiles);\n  }, [id]);\n  return files.length;\n}\n',
    rules: ["R15"],
    mentions: "useResource",
  },
  "apps/web/src/client/r15-callback-fail.tsx": {
    source:
      'import { useCallback, useEffect, useState } from "react";\nexport function List() {\n  const [rows, setRows] = useState<unknown>(null);\n  const load = useCallback(async () => {\n    const res = await fetch("/api/rows");\n    setRows(await res.json());\n  }, []);\n  useEffect(() => {\n    void load();\n  }, [load]);\n  return rows;\n}\n',
    rules: ["R15"],
  },
  "apps/web/src/client/r15-react-namespace-fail.tsx": {
    source:
      'import React from "react";\nimport { codeApi } from "./lib/code/api";\nexport function Usage({ id }: { id: string }) {\n  React.useEffect(() => {\n    void codeApi.usage(id);\n  }, [id]);\n  return null;\n}\n',
    rules: ["R15"],
  },
  "apps/web/src/client/r15-wrapped-loader-fail.tsx": {
    source:
      'import { useEffect, useState } from "react";\nimport { loadModels } from "./pages/code/controls";\nexport function Picker({ id }: { id: string }) {\n  const [models, setModels] = useState<string[]>([]);\n  useEffect(() => {\n    void loadModels(id).then(setModels);\n  }, [id]);\n  return models.length;\n}\n',
    rules: ["R15"],
  },
  "apps/web/src/client/r15-name-only-pass.tsx": {
    source:
      'import { useCallback, useEffect, useState } from "react";\nimport { codeApi } from "./lib/code/api";\nexport function Panel({ result }: { result: { load: number } }) {\n  const [, set] = useState({ load: 0 });\n  const load = useCallback(() => codeApi.list(), []);\n  useEffect(() => {\n    set({ load: result.load });\n  }, [result]);\n  return <button onClick={load}>Load</button>;\n}\n',
    rules: [],
  },
  "apps/web/src/client/r15-pass.tsx": {
    source:
      'import { useEffect } from "react";\nimport { useResource } from "./queries/resource";\nimport { codeApi } from "./lib/code/api";\nexport function Files({ id }: { id: string }) {\n  const files = useResource(["files", id], () => codeApi.files(id), "Could not read the files.");\n  const save = () => codeApi.save(id);\n  useEffect(() => {\n    document.title = id;\n  }, [id]);\n  return <button onClick={save}>{files.data?.length}</button>;\n}\n',
    rules: [],
  },
  "apps/web/src/client/r10-fail.tsx": {
    source:
      'export const a = "Saved \u2014 done";\nexport const b = (n: string) => `Hi ${n} \u2014 welcome`;\nexport const C = () => <p>Off \u2014 paused</p>;\n',
    rules: ["R10", "R10", "R10"],
    mentions: "\\u2014",
  },
  "packages/jobs/src/client/r10-fail.tsx": {
    source: 'export const empty = "\u2014";\n',
    rules: ["R10"],
  },
  "apps/web/src/client/r10-pass.tsx": {
    source:
      '// A comment may hold one \u2014 like this.\nexport const a = "Saved. Done";\nexport const quoted = "Window \\u2014 title";\n',
    rules: ["R16"],
  },
  "apps/web/src/server/r10-elsewhere-pass.ts": {
    source: 'export const toModel = "clicked \u2014 now on the page";\n',
    rules: [],
  },
  "apps/web/src/client/r18-fail.tsx": {
    source:
      'import { Slot } from "radix-ui";\nimport { Button } from "@base-ui/react/button";\nimport { Command } from "cmdk";\nexport const parts = [Slot, Button, Command];\n',
    rules: ["R18", "R18", "R18"],
    mentions: "add one there first",
  },
  "packages/shell/src/r18-fail.tsx": {
    source: 'import { Command } from "cmdk";\nexport const c = Command;\n',
    rules: ["R18"],
  },
  "apps/web/src/client/r18-shadcn-pass.tsx": {
    source:
      'import { MessageScroller } from "@shadcn/react/message-scroller";\nexport const m = MessageScroller;\n',
    rules: [],
  },
  "packages/ui/src/r18-pass.tsx": {
    source:
      'import { Slot } from "radix-ui";\nimport { Button } from "@base-ui/react/button";\nexport const parts = [Slot, Button];\n',
    rules: [],
  },
  "apps/web/src/client/r18-groot-ui-pass.tsx": {
    source: 'import { Button } from "@groot/ui/button";\nexport const b = Button;\n',
    rules: [],
  },
  "packages/agent/src/r17-catch-fail.ts": {
    source:
      "export class Runtime {\n  async dismiss(): Promise<void> {}\n  watch(): void {\n    void this.dismiss().catch(() => {});\n  }\n}\n",
    rules: ["R17"],
    mentions: "carries on as if the call worked",
  },
  "packages/sandbox/src/r17-then-default-fail.ts": {
    source:
      'import { lookup } from "node:dns/promises";\nexport const addresses = (host: string) =>\n  lookup(host, { all: true }).then(\n    (found) => found.map((a) => a.address),\n    () => [],\n  );\n',
    rules: ["R17"],
  },
  "scripts/r17-empty-catch-fail.mjs": {
    source:
      'import { statSync } from "node:fs";\nexport function exists(file) {\n  try {\n    statSync(file);\n    return true;\n  } catch {}\n  return false;\n}\n',
    rules: ["R17"],
  },
  "packages/sandbox/src/r17-pass.ts": {
    source:
      'const ignoreClosedSocket = (error: unknown) => {\n  if (!(error instanceof Error && error.message.includes("closed"))) throw error;\n};\nexport async function close(socket: { end(): Promise<void> }) {\n  await socket.end().catch(ignoreClosedSocket);\n  try {\n    await socket.end();\n  } catch (error) {\n    throw new Error("Could not close the socket.", { cause: error });\n  }\n  return socket.end().then(\n    () => true,\n    (error: unknown) => {\n      throw error;\n    },\n  );\n}\n',
    rules: [],
  },
  "apps/web/src/server/api/tasks/r19-query-fail.ts": {
    source:
      'import { eq } from "drizzle-orm";\nimport { db, tasks } from "../../db";\nexport async function createTask(sourceKey: string) {\n  const existing = await db.query.tasks.findFirst({ where: eq(tasks.sourceKey, sourceKey) });\n  if (existing) return existing;\n  const [row] = await db.insert(tasks).values({ sourceKey }).returning();\n  return row;\n}\n',
    rules: ["R19"],
    mentions: "onConflictDoNothing",
  },
  "packages/core/src/passkey/r19-select-fail.ts": {
    source:
      'import { eq } from "drizzle-orm";\nimport { db } from "../database";\nimport { passkeys } from "./schema";\nexport async function register(id: string) {\n  const [taken] = await db.select().from(passkeys).where(eq(passkeys.id, id));\n  if (taken) throw new Error("taken");\n  await db.insert(passkeys).values({ id });\n}\n',
    rules: ["R19"],
  },
  "apps/web/src/server/api/tasks/r19-returned-insert-fail.ts": {
    source:
      'import { eq } from "drizzle-orm";\nimport { db, tasks } from "../../db";\nexport async function createTask(sourceKey: string) {\n  const existing = await db.query.tasks.findFirst({ where: eq(tasks.sourceKey, sourceKey) });\n  if (existing) return existing;\n  return db.insert(tasks).values({ sourceKey }).returning();\n}\n',
    rules: ["R19"],
  },
  "apps/web/src/server/api/skills/r19-pass.ts": {
    source:
      'import { eq } from "drizzle-orm";\nimport { db, skills, users } from "../../db";\nexport async function save(name: string) {\n  const [row] = await db.insert(skills).values({ name }).onConflictDoNothing({ target: skills.name }).returning();\n  return row ?? (await db.query.skills.findFirst({ where: eq(skills.name, name) }));\n}\nexport async function addUser(email: string) {\n  await Promise.resolve();\n  return db.transaction((tx) => {\n    if (tx.select().from(users).where(eq(users.email, email)).get()) throw new Error("taken");\n    return tx.insert(users).values({ email }).returning().get();\n  });\n}\nexport async function touch(name: string) {\n  const found = await db.query.skills.findFirst({ where: eq(skills.name, name) });\n  await db.insert(users).values({ email: name });\n  return found;\n}\n',
    rules: [],
  },
  "apps/web/src/server/r8b-pass.ts": {
    source: 'import { db } from "@groot/core/database";\nexport const d = db;\n',
    rules: [],
  },
  "packages/models/src/r11-durable-fail.ts": {
    source:
      'import { defineTool } from "@earendil-works/pi-durable";\nexport const t = defineTool;\n',
    rules: ["R11"],
    mentions: "Move the pi-durable-free code it needs into packages/models",
  },
  "packages/models/src/r11-durable-subpath-fail.ts": {
    source: 'export { DEFAULT_IMAGE_LIMITS } from "@earendil-works/pi-durable/tools";\n',
    rules: ["R11"],
  },
  "packages/models/src/r11-agent-type-fail.ts": {
    source:
      'import type { AgentRuntime } from "@tiny-agents/agent";\nexport type R = AgentRuntime;\n',
    rules: ["R11"],
  },
  "packages/models/src/r11-agent-subpath-fail.ts": {
    source: 'export { createSandboxConnection } from "@tiny-agents/agent/sandbox";\n',
    rules: ["R11"],
  },
  "packages/models/src/r11-agent-relative-fail.ts": {
    source: 'import type { ChatState } from "../../agent/src/types";\nexport type S = ChatState;\n',
    rules: ["R11"],
  },
  "packages/models/src/r11-pass.ts": {
    source:
      'import type { Api, Model } from "@earendil-works/pi-ai";\nimport type { ClaudeCodeModel } from "@tiny-agents/claude-worker";\nexport type M = [Model<Api>, ClaudeCodeModel];\n',
    rules: [],
  },
  "packages/agent/src/r11-elsewhere-pass.ts": {
    source:
      'import { defineTool } from "@earendil-works/pi-durable";\nimport type { ModelCatalog } from "@tiny-agents/models";\nexport const t = defineTool;\nexport type C = ModelCatalog;\n',
    rules: [],
  },
  "packages/sandbox/src/r11-durable-fail.ts": {
    source:
      'import { defineTool } from "@earendil-works/pi-durable";\nexport const t = defineTool;\n',
    rules: ["R11"],
    mentions: "Move the pi-durable-free code it needs into packages/sandbox",
  },
  "packages/code/src/drivers/pi/r11-durable-fail.ts": {
    source:
      'import type { Conversation } from "@earendil-works/pi-durable";\nexport type C = Conversation;\n',
    rules: ["R11"],
    mentions: "The native driver takes the runtime through its port",
  },
  "packages/code/src/drivers/pi/r11-agent-fail.ts": {
    source:
      'import type { AgentRuntime } from "@tiny-agents/agent";\nexport type R = AgentRuntime;\n',
    rules: ["R11"],
  },
  "packages/code/src/drivers/pi/r11-pass.ts": {
    source:
      'import type { HarnessInstance } from "../../contracts";\nexport type H = HarnessInstance;\n',
    rules: [],
  },
  "packages/sandbox/src/r11-durable-subpath-fail.ts": {
    source: 'export { DEFAULT_IMAGE_LIMITS } from "@earendil-works/pi-durable/tools";\n',
    rules: ["R11"],
  },
  "packages/sandbox/src/r11-agent-type-fail.ts": {
    source:
      'import type { AgentRuntime } from "@tiny-agents/agent";\nexport type R = AgentRuntime;\n',
    rules: ["R11"],
  },
  "packages/sandbox/src/r11-agent-subpath-fail.ts": {
    source: 'export { createBrowserToolkit } from "@tiny-agents/agent/browser";\n',
    rules: ["R11"],
  },
  "packages/sandbox/src/subpaths/r11-agent-relative-fail.ts": {
    source:
      'import type { VaultBroker } from "../../../agent/src/vault";\nexport type V = VaultBroker;\n',
    rules: ["R11"],
  },
  "packages/sandbox/src/r11-pass.ts": {
    source:
      'import type { Client } from "ssh2";\nimport type { Page } from "playwright-core";\nimport { checkPublicUrl } from "./public-url";\nexport type C = [Client, Page];\nexport const check = checkPublicUrl;\n',
    rules: [],
  },
  "packages/agent/src/toolkits/r11-sandbox-elsewhere-pass.ts": {
    source:
      'import { defineTool } from "@earendil-works/pi-durable";\nimport type { SandboxConnection } from "@tiny-agents/sandbox";\nexport const t = defineTool;\nexport type C = SandboxConnection;\n',
    rules: [],
  },
  "apps/web/src/server/api/bots/r12-let-fail.ts": {
    source: "let count = 0;\nexport const bump = () => ++count;\n",
    rules: ["R12"],
    mentions: "apps/web/src/server/app-root.ts",
  },
  "apps/web/src/server/r12-export-let-fail.ts": {
    source: "export let current: string | undefined;\nexport let a = 1,\n  b = 2;\n",
    rules: ["R12", "R12", "R12"],
    mentions: "ReadonlySet<T>",
  },
  "apps/web/src/server/api/vault/r12-collections-fail.ts": {
    source:
      "const a = new Map<string, number>();\nexport const b = new Set<string>();\nconst c = new WeakMap<object, number>() as WeakMap<object, number>;\nconst d = (new WeakSet<object>());\nexport const all = [a, c, d];\n",
    rules: ["R12", "R12", "R12", "R12"],
  },
  "apps/web/src/server/api/r12-pass.ts": {
    source:
      "const LIMIT = 3;\nconst LIST = [1, 2];\nconst seen = [...new Set(LIST)];\nexport const counter = () => {\n  let n = 0;\n  const hits = new Map<number, number>();\n  return () => hits.set((n += LIMIT), seen.length);\n};\nfor (let i = 0; i < 1; i++) void i;\n",
    rules: [],
  },
  "apps/web/src/server/api/r12-readonly-pass.ts": {
    source:
      'const WORDS: ReadonlySet<string> = new Set(["a"]);\nconst BY_NAME: ReadonlyMap<string, number> = new Map([["a", 1]]);\nexport const has = (word: string) => WORDS.has(word) || BY_NAME.has(word);\n',
    rules: [],
  },
  "apps/web/src/client/lib/r13-declarations-api.ts": {
    source:
      "export interface Bot {\n  id: string;\n}\nexport type Bots = Bot[];\nexport const botsApi = { list: (): Bots => [] };\n",
    rules: ["R13", "R13"],
    mentions: "apps/web/src/shared/api/<area>.ts",
  },
  "apps/web/src/client/lib/r13-reexports-api.ts": {
    source:
      'import type { Task } from "../../shared/api/tasks";\nexport type { Task };\nexport { type Routine } from "../../shared/api/routines";\nexport type * from "../../shared/api/skills";\nexport const tasks = (): Task[] => [];\n',
    rules: ["R13", "R13", "R13"],
  },
  "apps/web/src/client/lib/r13-pass-api.ts": {
    source:
      'import { apiClient } from "@groot/shell/lib/api";\nimport type { Task } from "../../shared/api/tasks";\ninterface Local {\n  n: number;\n}\nconst local: Local = { n: 1 };\nexport const tasksApi = { list: () => apiClient.get<Task[]>("/tasks"), local };\nexport class StepUpRequiredError extends Error {}\nexport { local as defaults };\n',
    rules: [],
  },
  "apps/web/src/client/lib/r13-elsewhere-pass.ts": {
    source: "export interface Draft {\n  name: string;\n}\nexport type Drafts = Draft[];\n",
    rules: [],
  },
  "apps/web/src/shared/api/r13-shared-pass.ts": {
    source: "export interface Task {\n  id: string;\n}\nexport type { Task as Todo };\n",
    rules: [],
  },
  "apps/web/src/server/r16-fail.ts": {
    source: "// Adds one.\nexport const inc = (n: number) => n + 1; /* trailing */\n",
    rules: ["R16", "R16"],
    mentions: "ADR 0028",
  },
  "apps/web/src/server/r16-directives-pass.ts": {
    source:
      '// @ts-expect-error untyped\nimport legacy from "legacy";\n// oxlint-disable-next-line no-unused-vars\nconst unused = 1;\nexport const value = /* @__PURE__ */ legacy();\n',
    rules: [],
  },
  "apps/web/src/server/r16-directive-reason-fail.ts": {
    source:
      "// oxlint-disable-next-line no-unused-vars -- kept for the next release\nconst unused = 1;\nexport const value = 2;\n",
    rules: ["R16"],
  },
  "apps/web/src/client/r12-elsewhere-pass.ts": {
    source: "let open = false;\nexport const toggle = () => (open = !open);\n",
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
    const fired = texts.map((t) => /\b(R\d+[a-z]?): /.exec(t)?.[1]).toSorted();
    expect(fired, texts.join("\n")).toEqual(rules);
    if (mentions) expect(texts.join("\n")).toContain(mentions);
  });
});
