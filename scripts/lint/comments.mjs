import { readFileSync } from "node:fs";
import micromatch from "micromatch";

export const BASELINE_PATH = "scripts/lint/comment-baseline.json";

const COMMENT_FILES = /\.(?:[cm]?[jt]sx?|kts?|css)$/;

export const OUT_OF_SCOPE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/generated/**",
  "**/vendor/**",
  "apps/web/drizzle/**",
  ".agents/**",
  ".claude/**",
  ".groot/**",
  "mobile/.groot/**",
  "site/demos/kit/**",
  "site/assets/**",
  "scripts/demo/launch/assets/**",
  "scripts/demo/launch/snap/**",
];

const KEPT =
  /^[\s*!]*(?:eslint-|oxlint-|@ts-|biome-ignore|prettier-ignore|istanbul |c8 |v8 |@vite-ignore|webpack[A-Z]|[#@]__PURE__|[#@]__NO_SIDE_EFFECTS__|<reference |@jsx|@license|@preserve|SPDX-|Copyright |@vitest-environment|react-doctor-disable|@suppress|noinspection|ktlint-disable|detekt:|language=|@formatter:|@tailwind |stylelint-|gitleaks:allow|Adapted from |Ported from )/i;

export const isKeptComment = (value) => KEPT.test(value);

export const inScope = (file) =>
  COMMENT_FILES.test(file) && !micromatch.isMatch(file, OUT_OF_SCOPE);

export const isGenerated = (source) => /@generated|DO NOT EDIT/.test(source.slice(0, 400));

function scanCStyle(source, { lineComments, nestedBlocks, rawStrings }) {
  const found = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (rawStrings && source.startsWith('"""', i)) {
      const end = source.indexOf('"""', i + 3);
      i = end < 0 ? source.length : end + 3;
    } else if (ch === '"' || ch === "'") {
      i++;
      while (i < source.length && source[i] !== ch && source[i] !== "\n") {
        i += source[i] === "\\" ? 2 : 1;
      }
      i++;
    } else if (lineComments && ch === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      const stop = end < 0 ? source.length : end;
      found.push(source.slice(i + 2, stop));
      i = stop;
    } else if (ch === "/" && next === "*") {
      let depth = 1;
      let j = i + 2;
      while (j < source.length && depth > 0) {
        if (nestedBlocks && source.startsWith("/*", j)) {
          depth++;
          j += 2;
        } else if (source.startsWith("*/", j)) {
          depth--;
          j += 2;
        } else j++;
      }
      found.push(source.slice(i + 2, j - 2));
      i = j;
    } else i++;
  }
  return found;
}

let parseSync;

async function scriptComments(file, source) {
  parseSync ??= (await import("oxc-parser")).parseSync;
  return parseSync(file, source).comments.map((c) => c.value);
}

async function commentValues(file, source = readFileSync(file, "utf8")) {
  if (isGenerated(source)) return [];
  if (file.endsWith(".css")) {
    return scanCStyle(source, { lineComments: false, nestedBlocks: false, rawStrings: false });
  }
  if (/\.kts?$/.test(file)) {
    return scanCStyle(source, { lineComments: true, nestedBlocks: true, rawStrings: true });
  }
  return scriptComments(file, source);
}

export async function countComments(file, source) {
  return (await commentValues(file, source)).filter((value) => !isKeptComment(value)).length;
}

export function readBaseline(text = readFileSync(BASELINE_PATH, "utf8")) {
  return JSON.parse(text);
}
