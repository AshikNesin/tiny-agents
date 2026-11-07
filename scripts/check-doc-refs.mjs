#!/usr/bin/env node
/**
 * Fails when agent-facing markdown names a repo path that does not exist, links
 * to a missing file, or mentions a `pnpm <script>` that no package.json
 * defines. Agents copy what docs show, so a dangling reference is a wrong
 * instruction.
 *
 * Usage: node scripts/check-doc-refs.mjs [--ref <git-ref>]
 * With --ref, reads the tree at that commit instead of the working tree.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const git = (args, options = {}) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 28, ...options });
process.chdir(git(["rev-parse", "--show-toplevel"]).trim());

const refIndex = process.argv.indexOf("--ref");
const ref = refIndex === -1 ? null : process.argv[refIndex + 1];

const files = ref
  ? git(["ls-tree", "-r", "--name-only", ref]).split("\n").filter(Boolean)
  : git(["ls-files", "--cached"])
      .split("\n")
      .filter((f) => f && existsSync(f));
const read = (f) => (ref ? git(["show", `${ref}:${f}`]) : readFileSync(f, "utf8"));

const fileSet = new Set(files);
const dirSet = new Set(
  files.flatMap((f) =>
    f
      .split("/")
      .slice(0, -1)
      .map((_, i, parts) => parts.slice(0, i + 1).join("/")),
  ),
);
const basenames = new Set(files.map((f) => path.posix.basename(f)));
const topLevel = new Set(files.map((f) => f.split("/")[0]));
// Docs name modules the way imports do, without the extension.
const MODULE_SUFFIXES = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];
const exists = (p) =>
  MODULE_SUFFIXES.some((suffix) => fileSet.has(p + suffix)) || dirSet.has(p.replace(/\/$/, ""));
const existsUnderAnyDir = (tail) =>
  files.some((f) => MODULE_SUFFIXES.some((suffix) => f.endsWith(`/${tail}${suffix}`)));

const scripts = new Set(
  files
    .filter((f) => path.posix.basename(f) === "package.json")
    .flatMap((f) => Object.keys(JSON.parse(read(f)).scripts ?? {})),
);
const PNPM_BUILTINS = new Set(
  "install i add remove rm update up exec dlx run why list ls outdated audit store env create init rebuild prune link patch approve-builds publish pack -r -w --filter -F -C --dir".split(
    " ",
  ),
);
const isBin = (name) => existsSync(path.join("node_modules/.bin", name));

const scanned = files.filter(
  (f) =>
    f.endsWith(".md") &&
    (["AGENTS.md", "CLAUDE.md", "GLOSSARY.md", "PRD.md", "README.md"].includes(f) ||
      f.startsWith("docs/") ||
      f.startsWith(".agents/skills/")),
);
// ADRs are never edited after acceptance, so the files they name may since have
// moved. Only their links, which readers follow, must still resolve.
const isHistorical = (md) => md.startsWith("docs/adr/");

const EXT = /\.(tsx?|m?js|cjs|jsonc?|md|ya?ml|sql|sh|css|html|toml)$/;
const SKIP = /[*<>{}$|\s…]|\.\.\.|NNNN|slug|^https?:|^@|^-|^\.\w+$|:$/;
// Files docs name on purpose that are not in the tree: runtime outputs, files in
// other repos or on other machines, and worked examples.
const ALLOW = new Set([
  "result.json",
  "failure.aria.yml",
  "extract.json",
  ".claude.json",
  "1password-credentials.json",
  "sync-report.json",
  "users/validate.json",
  "compose.override.yml",
  "GLOSSARY-MAP.md",
  "API.md",
  "apps/web/drizzle/0001_add_posts.sql",
  "post.routes.ts",
  "migrate-layout.ts",
]);
// Paths groot sync classifies (.groot/lib/patterns.ts) that tiny-agents lacks.
// Only the docs about sync may name them.
const SYNC_PATTERNS = new Set([
  "postcss.config.js",
  "wrangler.jsonc",
  ".groot/feature-request.md",
  ".groot/repo-drift.md",
]);
const describesSync = (md) =>
  md.startsWith(".agents/skills/groot-sync/") || md === "docs/guides/sync.md";

const skillRoot = (md) => md.match(/^\.agents\/skills\/[^/]+/)?.[0];
const anchorsOf = (token, md) =>
  [
    token,
    path.posix.join(path.posix.dirname(md), token),
    skillRoot(md) && path.posix.join(skillRoot(md), token),
  ]
    .filter(Boolean)
    .map((p) => path.posix.normalize(p))
    .filter((p) => !p.startsWith("../"));

function missingPath(raw, md) {
  const token = raw.replace(/[#?].*$/, "").replace(/:\d+(-\d+)?$/, "");
  if (!token || SKIP.test(token) || ALLOW.has(token)) return null;
  if (SYNC_PATTERNS.has(token) && describesSync(md)) return null;
  const first = token.replace(/^\.\//, "").split("/")[0];
  const rooted = token.includes("/") && (token.startsWith(".") || topLevel.has(first));
  if (!rooted && !EXT.test(token)) return null;
  const anchors = anchorsOf(token, md);
  if (anchors.some(exists)) return null;
  if (!token.includes("/") && basenames.has(token)) return null;
  const tail = token.replace(/^(\.\.?\/)+/, "");
  if (token.includes("/") && !topLevel.has(first) && existsUnderAnyDir(tail)) return null;
  return { kind: "path", target: token, anchors };
}

const missingScripts = (span) =>
  [...span.matchAll(/(?:^|[\s;&(])pnpm\s+(?:run\s+)?([\w:.-]+)/g)]
    .map((m) => m[1])
    .filter((name) => !name.endsWith(":"))
    .filter((name) => !scripts.has(name) && !PNPM_BUILTINS.has(name) && !isBin(name))
    .map((name) => ({ kind: "script", target: `pnpm ${name}` }));

function missingLink(target, md) {
  if (/^(https?:|mailto:|#)/.test(target)) return null;
  const resolved = path.posix.normalize(
    path.posix.join(path.posix.dirname(md), decodeURI(target.replace(/#.*$/, ""))),
  );
  return exists(resolved) ? null : { kind: "link", target: resolved, anchors: [resolved] };
}

const problems = new Map();
for (const md of scanned) {
  let inFence = false;
  read(md)
    .split("\n")
    .forEach((line, i) => {
      const at = `${md}:${i + 1}`;
      // A backticked link such as [`a.md`](a.md) names its target twice; report it once.
      const report = (problem) =>
        problem && problems.set(`${at} ${problem.target}`, { at, ...problem });
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        return;
      }
      if (!isHistorical(md)) {
        const spans = inFence ? [line] : [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
        for (const span of spans) {
          missingScripts(span).forEach(report);
          if (!inFence) report(missingPath(span.trim(), md));
        }
      }
      if (!inFence)
        for (const m of line.matchAll(/\]\(([^)\s]+)\)/g)) report(missingLink(m[1], md));
    });
}

// A gitignored target is a build or runtime output (dist/, data/dev.db), not a dangling reference.
const anchors = [...new Set([...problems.values()].flatMap((p) => p.anchors ?? []))];
let ignoredOut = "";
try {
  ignoredOut = git(["check-ignore", "--no-index", "--stdin"], { input: anchors.join("\n") });
} catch (error) {
  ignoredOut = error.stdout ?? "";
}
const ignored = new Set(ignoredOut.split("\n").filter(Boolean));
const dangling = [...problems.values()].filter(
  (p) => !(p.anchors ?? []).some((a) => ignored.has(a)),
);

for (const p of dangling) {
  console.log(`${p.at}  missing ${p.kind} ${p.target}. Fix the path or delete the sentence.`);
}
console.log(`${dangling.length} dangling references in ${scanned.length} docs`);
process.exit(dangling.length > 0 ? 1 : 0);
