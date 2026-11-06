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
  "apps/web/src/client/r4-fail.tsx": {
    source: `${SHELL_CN}\nexport const x = cn("a");\n`,
    rules: ["R4"],
    mentions: "@groot/ui/lib/utils",
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
  "apps/web/src/client/r5b-fail.tsx": {
    source: NESTED_SEPARATOR,
    rules: ["R5b"],
    mentions: "Make it a sibling of the items",
  },
  "packages/shell/src/r5b-mapped-fail.tsx": { source: MAPPED_NESTED_SEPARATOR, rules: ["R5b"] },
  "apps/web/src/client/r5b-pass.tsx": { source: SIBLING_SEPARATOR, rules: [] },
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
    const fired = texts.map((t) => /\b(R\d[ab]?): /.exec(t)?.[1]).toSorted();
    expect(fired, texts.join("\n")).toEqual(rules);
    if (mentions) expect(texts.join("\n")).toContain(mentions);
  });
});
