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
 * Goldens are stored as `<label>.aria`, not `.aria.yml`: the repo's formatter
 * re-indents YAML, and a golden must stay byte for byte what Playwright wrote.
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

/** Measured or per-run values: a tool call's duration, the run's port, a job's short id. */
const VOLATILE_VALUES = [
  [/ \d+(?:\.\d+)?(?:ms|s)(?=["'\s]|$)/gm, " <duration>"],
  [/(localhost|127\.0\.0\.1):\d+/g, "$1:<port>"],
  // A job's short id on the Jobs pages: six hex digits with a digit and a letter.
  [/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{6}\b/g, "<job>"],
  [/\(([0-9a-f]{6})\)/g, "(<job>)"],
];

function normalizeAria(text) {
  const ids = new Map();
  let out = text;
  for (const [pattern, replacement] of VOLATILE_VALUES) out = out.replace(pattern, replacement);
  for (const pattern of ID_PATTERNS) {
    out = out.replace(pattern, (id) => {
      if (!ids.has(id)) ids.set(id, `<id${ids.size + 1}>`);
      return ids.get(id);
    });
  }
  return out;
}

/**
 * Snapshots a frozen clock can't pin: taken while a reply streams or while a
 * badge races a refetch. `goldens/volatile.txt` lists them as
 * `journey/label` (a `#` starts a comment); `check` skips them.
 */
const VOLATILE_FILE = path.join(GOLDENS, "volatile.txt");
const volatile = new Set(
  existsSync(VOLATILE_FILE)
    ? readFileSync(VOLATILE_FILE, "utf8")
        .split("\n")
        .map((line) => line.replace(/#.*/, "").trim())
        .filter(Boolean)
    : [],
);

/** `added.aria.yml` (evidence) is kept as `added.aria` (golden). */
const goldenName = (file) => file.replace(/\.yml$/, "");

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
        path.join(goldenDir, goldenName(file)),
        normalizeAria(readFileSync(path.join(from, file), "utf8")),
      );
    }
    console.log(`saved ${journey}: ${files.length} snapshots`);
    continue;
  }
  const expected = existsSync(goldenDir)
    ? readdirSync(goldenDir)
        .filter((f) => f.endsWith(".aria"))
        .map((f) => `${f}.yml`)
    : [];
  for (const file of new Set([...files, ...expected])) {
    if (volatile.has(`${journey}/${goldenName(file).replace(/\.aria$/, "")}`)) continue;
    compared++;
    const golden = path.join(goldenDir, goldenName(file));
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
