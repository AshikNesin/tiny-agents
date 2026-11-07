#!/usr/bin/env tsx
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";

const SHARED = "tests/server/fixtures/until";
const LOCAL_POLLER = /^(?:export )?async function (until|waitUntil)\b[\s\S]*?^\}\n\n?/gm;
const HARNESS_IMPORT = /import \{([^}]*)\} from "\.\/engine-harness";/;
const FIRST_IMPORT = /^import [\s\S]*?from "[^"]+";\n/m;

function rewrite(file: string, source: string): string {
  let renamed = false;
  let out = source.replace(LOCAL_POLLER, (fn, name: string) => {
    if (!fn.includes("Date.now()")) return fn;
    renamed ||= name === "waitUntil";
    return "";
  });
  if (renamed) out = out.replaceAll(/\bwaitUntil\(/g, "until(");
  out = out.replace(HARNESS_IMPORT, (line, names: string) => {
    const all = names.split(",").map((n) => n.trim());
    if (!all.includes("until")) return line;
    const kept = all.filter((n) => n && n !== "until");
    return `import { ${kept.join(", ")} } from "./engine-harness";`;
  });
  const usesUntil = /\buntil\(/.test(out);
  const hasImport = /import \{[^}]*\buntil\b[^}]*\} from "[^"]*fixtures(\/until)?";/.test(out);
  if (out === source || !usesUntil || hasImport) return out;
  let path = relative(dirname(file), SHARED);
  if (!path.startsWith(".")) path = `./${path}`;
  return out.replace(FIRST_IMPORT, (first) => `${first}import { until } from "${path}";\n`);
}

const files =
  process.argv.length > 2
    ? process.argv.slice(2)
    : execFileSync("git", ["ls-files", "--", "tests/server/*.ts"], { encoding: "utf8" })
        .split("\n")
        .filter((f) => f && !f.endsWith("fixtures/until.ts"));

let changed = 0;
for (const file of files) {
  const before = readFileSync(file, "utf8");
  const after = rewrite(file, before);
  if (after === before) continue;
  writeFileSync(file, after);
  changed += 1;
  console.log(file);
}
console.log(`test-waits-use-until: ${changed} file(s) rewritten`);
