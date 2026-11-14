#!/usr/bin/env tsx
/**
 * Fails when any tracked text file holds an em dash (U+2014), typed or
 * escaped (a JS unicode escape, or an HTML named or numeric entity): copy,
 * code, comments and docs use a colon, comma, period or parentheses instead.
 * Binary files are skipped.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

// Built from pieces so this file passes its own check.
const CODE = "2014";
const EM_DASH = new RegExp(
  [
    String.fromCodePoint(0x2014),
    `\\\\u${CODE}`,
    `\\\\u\\{${CODE}\\}`,
    `&${"m"}dash;`,
    `&#${8212};`,
    `&#x${CODE};`,
  ].join("|"),
  "i",
);

/** `path:line: text` for each line of `text` that holds an em dash. */
export function emDashProblems(file: string, text: string): string[] {
  if (text.includes("\0")) return [];
  return text
    .split("\n")
    .flatMap((line, i) =>
      EM_DASH.test(line) ? [`${file}:${i + 1}: ${line.trim().slice(0, 160)}`] : [],
    );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = execFileSync("git", [
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
  ])
    .toString()
    .split("\0")
    .filter(Boolean);
  const problems = files.flatMap((file) => {
    try {
      return emDashProblems(file, readFileSync(file, "utf8"));
    } catch {
      return []; // listed but gone from the working tree
    }
  });
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) {
    console.error(
      `\n${problems.length} line(s) hold an em dash. Use a colon, comma, period or parentheses instead.`,
    );
    process.exit(1);
  }
  console.log(`no em dash in ${files.length} files`);
}
