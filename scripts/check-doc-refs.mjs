#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import micromatch from "micromatch";
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

const SYNCED_DOCS = ["docs/**", ".agents/skills/**"];
const SYNC_CONFIG = ".groot/boilerplate-sync.json";
const syncedFromGroot = (() => {
  if (!fileSet.has(SYNC_CONFIG) || !fileSet.has("package.json")) return () => false;
  const config = JSON.parse(read(SYNC_CONFIG));
  if (JSON.parse(read("package.json")).name === config.boilerplate?.name) return () => false;
  const exclusions = config.additional_exclusions ?? [];
  return (f) => micromatch.isMatch(f, SYNCED_DOCS) && !micromatch.isMatch(f, exclusions);
})();

const scanned = files.filter(
  (f) =>
    f.endsWith(".md") &&
    (["AGENTS.md", "CLAUDE.md", "GLOSSARY.md", "PRD.md", "README.md"].includes(f) ||
      f.startsWith("docs/") ||
      f.startsWith(".agents/skills/")) &&
    !syncedFromGroot(f),
);
const checksLinksOnly = (md) => md.startsWith("docs/adr/");

const EXT = /\.(tsx?|m?js|cjs|jsonc?|md|ya?ml|sql|sh|css|html|toml)$/;
const SKIP = /[*<>{}$|\s…]|\.\.\.|NNNN|slug|^https?:|^@|^-|^\.\w+$|:$/;
const KNOWN_ABSENT_PATHS = new Set([
  "result.json",
  "failure.aria.yml",
  "steps.md",
  "extract.json",
  ".claude.json",
  "sync-report.json",
  "users/validate.json",
  "compose.override.yml",
  "1password-credentials.json",
  "GLOSSARY-MAP.md",
  "API.md",
  "apps/web/drizzle/0001_add_posts.sql",
  "post.routes.ts",
  "migrate-layout.ts",
  ".vite-hooks/_",
  "GLOSSARY.md",
  "FRICTION.md",
  "data.html",
  "data.css",
  ".plan-state.json",
  ".cursor/skills/",
  "../visual-plan/references/canvas.md",
]);
const SYNC_DOC_ONLY_PATHS = new Set([
  "postcss.config.js",
  "wrangler.jsonc",
  ".groot/feature-request.md",
  ".groot/repo-drift.md",
  ".groot/needs-review/manifest.json",
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
  if (!token || SKIP.test(token) || KNOWN_ABSENT_PATHS.has(token)) return null;
  if (token.startsWith("/")) return null;
  if (SYNC_DOC_ONLY_PATHS.has(token) && describesSync(md)) return null;
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
  const file = decodeURI(target.replace(/#.*$/, ""));
  const resolved = path.posix.normalize(
    file.startsWith("/") ? file.slice(1) : path.posix.join(path.posix.dirname(md), file),
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
      const reportOnce = (problem) =>
        problem && problems.set(`${at} ${problem.target}`, { at, ...problem });
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        return;
      }
      if (!checksLinksOnly(md)) {
        const spans = inFence ? [line] : [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
        for (const span of spans) {
          missingScripts(span).forEach(reportOnce);
          if (!inFence) reportOnce(missingPath(span.trim(), md));
        }
      }
      if (!inFence)
        for (const m of line.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g))
          reportOnce(missingLink(m[1], md));
    });
}

function gitIgnored(paths) {
  let out = "";
  try {
    out = git(["check-ignore", "--no-index", "--stdin"], { input: paths.join("\n") });
  } catch (error) {
    out = error.stdout ?? "";
  }
  return new Set(out.split("\n").filter(Boolean));
}

const buildOutputs = gitIgnored([
  ...new Set([...problems.values()].flatMap((p) => p.anchors ?? [])),
]);
const isBuildOutput = (p) => (p.anchors ?? []).some((a) => buildOutputs.has(a));
const dangling = [...problems.values()].filter((p) => !isBuildOutput(p));

for (const p of dangling) {
  console.log(`${p.at}  missing ${p.kind} ${p.target}. Fix the path or delete the sentence.`);
}
console.log(`${dangling.length} dangling references in ${scanned.length} docs`);
process.exit(dangling.length > 0 ? 1 : 0);
