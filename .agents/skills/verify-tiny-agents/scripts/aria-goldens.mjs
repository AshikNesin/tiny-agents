#!/usr/bin/env node
/**
 * ARIA goldens (docs/rewrite/PLAN.md, Phase 0.6): the journeys' ARIA
 * snapshots from a frozen run (`ta-verify up --fixed-clock`) are the
 * browser-level baseline the rewrite must keep. Generated ids (cuid2, UUIDs,
 * 24-hex uploads) are numbered by first appearance per file, as the server's
 * golden traces do.
 *
 *   aria-goldens.mjs save  <evidence-run-dir> [journey...]   copy *.aria.yml into goldens/
 *   aria-goldens.mjs check <evidence-run-dir> [journey...]   compare; exit 1 on any difference
 *
 * With no journey names, every journey folder in the evidence run is used.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GOLDENS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "goldens");
const ID_PATTERNS = [
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g,
  /\bc[a-z0-9]{23,31}\b/g,
  /\b[0-9a-f]{24}\b/g,
];

function normalizeAria(text) {
  const ids = new Map();
  let out = text;
  for (const pattern of ID_PATTERNS) {
    out = out.replace(pattern, (id) => {
      if (!ids.has(id)) ids.set(id, `<id${ids.size + 1}>`);
      return ids.get(id);
    });
  }
  return out;
}

const [command, runDir, ...only] = process.argv.slice(2);
if (!["save", "check"].includes(command) || !runDir || !existsSync(runDir)) {
  console.error("usage: aria-goldens.mjs save|check <evidence-run-dir> [journey...]");
  process.exit(2);
}

const journeys = only.length
  ? only
  : readdirSync(runDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

let differences = 0;
let compared = 0;
for (const journey of journeys) {
  const from = path.join(runDir, journey);
  if (!existsSync(from)) {
    console.log(`MISSING ${journey}: no evidence`);
    differences++;
    continue;
  }
  const files = readdirSync(from).filter(
    (f) => f.endsWith(".aria.yml") && f !== "failure.aria.yml",
  );
  const goldenDir = path.join(GOLDENS, journey);
  if (command === "save") {
    mkdirSync(goldenDir, { recursive: true });
    for (const file of files) {
      writeFileSync(
        path.join(goldenDir, file),
        normalizeAria(readFileSync(path.join(from, file), "utf8")),
      );
    }
    console.log(`saved ${journey}: ${files.length} snapshots`);
    continue;
  }
  const expected = existsSync(goldenDir)
    ? readdirSync(goldenDir).filter((f) => f.endsWith(".aria.yml"))
    : [];
  for (const file of new Set([...files, ...expected])) {
    compared++;
    const golden = path.join(goldenDir, file);
    const actual = path.join(from, file);
    if (!existsSync(golden) || !existsSync(actual)) {
      console.log(`DIFF ${journey}/${file}: ${existsSync(golden) ? "not captured" : "no golden"}`);
      differences++;
      continue;
    }
    const want = readFileSync(golden, "utf8");
    const got = normalizeAria(readFileSync(actual, "utf8"));
    if (want !== got) {
      differences++;
      const a = want.split("\n");
      const b = got.split("\n");
      const at = a.findIndex((line, i) => line !== b[i]);
      console.log(
        `DIFF ${journey}/${file} at line ${at + 1}:\n  - ${a[at] ?? ""}\n  + ${b[at] ?? ""}`,
      );
    }
  }
}
if (command === "check") {
  console.log(`${compared - differences}/${compared} ARIA snapshots match`);
  process.exit(differences ? 1 : 0);
}
