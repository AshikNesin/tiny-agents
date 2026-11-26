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
  "packages/ui/src/command-menu.tsx",
  "mobile/android/kit/**",
  "mobile/android/build-logic/**",
  "mobile/android/build.gradle.kts",
  "mobile/scripts/**",
  "scripts/demo/launch/assets/**",
  "scripts/demo/launch/snap/**",
];

const KEPT =
  /^[\s*!]*(?:eslint-|oxlint-|@ts-|biome-ignore|prettier-ignore|istanbul |c8 |v8 |@vite-ignore|webpack[A-Z]|[#@]__PURE__|[#@]__NO_SIDE_EFFECTS__|<reference |@jsx|@license|@preserve|SPDX-|Copyright |@vitest-environment|react-doctor-disable|@suppress|noinspection|ktlint-disable|detekt:|language=|@formatter:|@tailwind |stylelint-|gitleaks:allow|Adapted from |Ported from |@deprecated)/i;

const DIRECTIVE_REASON = /^[\s*]*(?:eslint|oxlint)-[\w-]+.*\s--\s/;

export const isKeptComment = (value) => KEPT.test(value) && !DIRECTIVE_REASON.test(value);

export const inScope = (file) =>
  COMMENT_FILES.test(file) && !micromatch.isMatch(file, OUT_OF_SCOPE);

export const isGenerated = (source) => /@generated|DO NOT EDIT/.test(source.slice(0, 400));

function scanCStyle(source, options) {
  const found = [];
  scanCode(source, options, 0, false, found);
  return found;
}

function skipString(source, options, i, quote, found) {
  const raw = quote === '"""';
  i += quote.length;
  while (i < source.length && !source.startsWith(quote, i)) {
    if (!raw && source[i] === "\n") return i;
    if (!raw && source[i] === "\\") i += 2;
    else if (options.templates && source.startsWith("${", i)) {
      i = scanCode(source, options, i + 2, true, found);
    } else i++;
  }
  return i + quote.length;
}

function scanCode(source, options, i, untilBrace, found) {
  let depth = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (options.rawStrings && source.startsWith('"""', i)) {
      i = skipString(source, options, i, '"""', found);
    } else if (ch === '"' || ch === "'") {
      i = skipString(source, options, i, ch, found);
    } else if (options.lineComments && ch === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      const stop = end < 0 ? source.length : end;
      found.push(source.slice(i + 2, stop));
      i = stop;
    } else if (ch === "/" && next === "*") {
      let nesting = 1;
      let j = i + 2;
      while (j < source.length && nesting > 0) {
        if (options.nestedBlocks && source.startsWith("/*", j)) {
          nesting++;
          j += 2;
        } else if (source.startsWith("*/", j)) {
          nesting--;
          j += 2;
        } else j++;
      }
      found.push(source.slice(i + 2, j - 2));
      i = j;
    } else if (untilBrace && ch === "{") {
      depth++;
      i++;
    } else if (untilBrace && ch === "}") {
      if (depth === 0) return i + 1;
      depth--;
      i++;
    } else i++;
  }
  return i;
}

let parseSync;

async function scriptComments(file, source) {
  parseSync ??= (await import("oxc-parser")).parseSync;
  return parseSync(file, source)
    .comments.filter((c) => !(c.start === 0 && source.startsWith("#!")))
    .map((c) => c.value);
}

async function commentValues(file, source = readFileSync(file, "utf8")) {
  if (isGenerated(source)) return [];
  if (file.endsWith(".css")) {
    return scanCStyle(source, { lineComments: false, nestedBlocks: false, rawStrings: false });
  }
  if (/\.kts?$/.test(file)) {
    return scanCStyle(source, {
      lineComments: true,
      nestedBlocks: true,
      rawStrings: true,
      templates: true,
    });
  }
  return scriptComments(file, source);
}

export async function countComments(file, source) {
  return (await commentValues(file, source)).filter((value) => !isKeptComment(value)).length;
}

export function readBaseline(text = readFileSync(BASELINE_PATH, "utf8")) {
  return JSON.parse(text);
}
