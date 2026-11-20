#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";
import { load as loadYaml } from "js-yaml";
import { mergeBase } from "./lib/merge-base.mjs";

const RELEASE_BOTS = ["github-actions[bot]", "renovate[bot]"];
const BOT_EMAIL_SUFFIX = "@users.noreply.github.com";

const MANAGED_PREFIXES = [
  "packages/*/src",
  "packages/*/vendor",
  "packages/*/package.json",
  "apps/web/drizzle",
  ".groot",
];

export function matchesManagedPrefix(file) {
  return MANAGED_PREFIXES.some((prefix) => {
    const pattern = "^" + prefix.split("*").map(escapeRegex).join("[^/]+") + "(/|$)";
    return new RegExp(pattern).test(file);
  });
}

export function isChildProject(rootDir) {
  const config = path.join(rootDir, ".groot", "boilerplate-sync.json");
  if (!existsSync(config)) return false;
  const boilerplate = JSON.parse(readFileSync(config, "utf8")).boilerplate?.name;
  return Boolean(boilerplate) && boilerplate !== readPackageName(rootDir);
}

const syncedFromBoilerplate = (file) => file.startsWith("packages/") || file.startsWith(".groot/");

export function pkgJsonChangeIsReleaseRelevant(beforeJson, afterJson) {
  let before;
  let after;
  try {
    before = JSON.parse(beforeJson);
    after = JSON.parse(afterJson);
  } catch {
    return true;
  }
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (key === "name" || key === "version" || key === "private") continue;
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) return true;
  }
  return false;
}

function isKitPackageJson(file) {
  return /^packages\/[^/]+\/package\.json$/.test(file);
}

function readPkgJsonAt(rootDir, file) {
  const absolute = path.join(rootDir, file);
  return existsSync(absolute) ? readFileSync(absolute, "utf8") : "";
}

function packageNameFor(file, rootDir) {
  if (file.startsWith("apps/web/drizzle") || file.startsWith(".groot/")) {
    return readPackageName(rootDir);
  }
  const scopeDir = file.split("/")[1];
  if (!scopeDir) return null;
  return readPackageName(path.join(rootDir, "packages", scopeDir));
}

function readPackageName(dir) {
  const pkgJson = path.join(dir, "package.json");
  if (!existsSync(pkgJson)) return null;
  return JSON.parse(readFileSync(pkgJson, "utf8")).name ?? null;
}

export function readWorkspacePackages(rootDir) {
  const workspaceFile = path.join(rootDir, "pnpm-workspace.yaml");
  const globs = existsSync(workspaceFile)
    ? (loadYaml(readFileSync(workspaceFile, "utf8"))?.packages ?? [])
    : [];
  const dirs = globs.flatMap((glob) => {
    const literal = glob.endsWith("/*") ? glob.slice(0, -2) : glob;
    if (literal.includes("*") || glob.startsWith("!")) {
      throw new Error(`changesets: unsupported pnpm-workspace.yaml glob "${glob}"`);
    }
    if (literal === glob) return [path.join(rootDir, glob)];
    const parent = path.join(rootDir, literal);
    if (!existsSync(parent)) return [];
    return readdirSync(parent, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(parent, d.name));
  });
  const rootName = readPackageName(rootDir);
  const others = dirs.map(readPackageName).filter((name) => name && name !== rootName);
  return [...(rootName ? [rootName] : []), ...new Set(others.sort())];
}

export function parseChangesetFrontmatter(body) {
  const match = /\s*---([^]*?)\r?\n\s*---(\s*(?:\n|$)[^]*)/.exec(body);
  if (!match) return [];
  let data;
  try {
    data = loadYaml(match[1]);
  } catch {
    return [];
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  return Object.entries(data);
}

export function parseChangesetReleases(body) {
  return parseChangesetFrontmatter(body)
    .filter(([, type]) => ["major", "minor", "patch"].includes(type))
    .map(([name]) => name);
}

export function isReleaseBotCommit(commit) {
  const { name, email } = commit;
  if (RELEASE_BOTS.includes(name)) return true;
  return (
    (name === "github-actions" || name === "renovate") &&
    typeof email === "string" &&
    email.endsWith(BOT_EMAIL_SUFFIX)
  );
}

export function collect(state) {
  const rootDir = state.rootDir ?? process.cwd();
  const entries = state.changedEntries ?? state.changedFiles.map((f) => ({ file: f }));
  const changedManagedFiles = [];
  const managedPackages = new Set();
  const child = isChildProject(rootDir);
  for (const entry of entries) {
    if (!matchesManagedPrefix(entry.file)) continue;
    if (child && syncedFromBoilerplate(entry.file)) continue;
    if (
      isKitPackageJson(entry.file) &&
      !pkgJsonChangeIsReleaseRelevant(
        entry.pkgJsonBefore ?? "",
        entry.pkgJsonAfter ?? readPkgJsonAt(rootDir, entry.file),
      )
    ) {
      continue;
    }
    changedManagedFiles.push(entry.file);
    const name = packageNameFor(entry.file, rootDir);
    if (name) managedPackages.add(name);
  }
  const coveredPackages = new Set();
  const unknownReleases = [];
  for (const entry of state.changesetFiles) {
    if (entry.added) {
      for (const name of parseChangesetReleases(entry.body)) coveredPackages.add(name);
    }
    for (const [name] of parseChangesetFrontmatter(entry.body)) {
      if (!state.workspacePackages.includes(name)) {
        unknownReleases.push(`.changeset/${entry.name} names unknown package "${name}"`);
      }
    }
  }
  return {
    managedPackages: [...managedPackages].sort(),
    coveredPackages: [...coveredPackages].sort(),
    reason: state.noReleaseReason ?? null,
    changedManagedFiles: changedManagedFiles.sort(),
    unknownReleases,
    workspacePackages: state.workspacePackages,
  };
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function git(args, root) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function markdownIn(root, files, dir) {
  return files
    .filter(
      (f) => path.posix.dirname(f) === dir && f.endsWith(".md") && existsSync(path.join(root, f)),
    )
    .sort()
    .map((f) => ({ name: path.basename(f), body: readFileSync(path.join(root, f), "utf8") }));
}

function listChangesetFiles(root, changedFiles, addedFiles) {
  const added = new Set(addedFiles);
  return markdownIn(root, changedFiles, ".changeset")
    .filter((f) => f.name !== "README.md")
    .map((f) => ({ ...f, added: added.has(`.changeset/${f.name}`) }));
}

function findNoReleaseReason(root, addedFiles) {
  const reason = markdownIn(root, addedFiles, ".no-release").find((f) => f.body.trim());
  if (!reason) return null;
  return `${reason.name}: ${reason.body.trim().split("\n")[0]}`;
}

function botOnlySurfaces(root, base, managedFiles) {
  const managed = new Set(managedFiles);
  const commits = git(["rev-list", `${base}..HEAD`], root)
    .split("\n")
    .filter(Boolean);
  return commits.every((sha) => {
    const touched = git(["diff-tree", "--no-commit-id", "--name-only", "-r", sha], root)
      .split("\n")
      .filter(Boolean);
    if (!touched.some((f) => managed.has(f))) return true;
    const [name, email] = git(["show", "-s", "--format=%an%n%ae", sha], root).split("\n");
    return isReleaseBotCommit({ name, email });
  });
}

export function evaluate(state) {
  if (state.unknownReleases.length > 0) {
    const packages = state.workspacePackages.join(", ");
    return {
      status: 1,
      unknown: state.unknownReleases,
      err:
        state.unknownReleases
          .map((line) => `changesets: ${line}; packages are: ${packages}\n`)
          .join("") +
        `  use "${state.workspacePackages[0]}" for apps/web/drizzle and .groot changes\n`,
    };
  }
  if (state.managedPackages.length === 0) {
    return {
      status: 0,
      out:
        "changesets: no managed package surface changed; nothing to cover\n" +
        `  managed: packages/*/src and packages/*/package.json (that package), apps/web/drizzle and .groot ("${state.workspacePackages[0] ?? "the root package"}")\n`,
    };
  }
  if (state.reason) {
    return {
      status: 0,
      out:
        `changesets: no-release reason accepted (${state.reason})\n` +
        `  changed managed surface: ${state.managedPackages.join(", ")}\n`,
    };
  }
  const missing = state.managedPackages.filter((p) => !state.coveredPackages.includes(p));
  if (missing.length === 0) {
    return {
      status: 0,
      out: `changesets: ${state.managedPackages.join(", ")} covered\n`,
    };
  }
  return {
    status: 1,
    missing,
    err:
      `changesets: missing changeset for ${missing.join(", ")}\n` +
      `  changed managed files:\n` +
      state.changedManagedFiles.map((f) => `    ${f}\n`).join("") +
      `  run pnpm changeset, or record the reviewed reason under .no-release/ for a docs-only or internal change\n`,
  };
}

function showBlob(root, revision, file) {
  try {
    return git(["show", `${revision}:${file}`], root);
  } catch {
    return "";
  }
}

export function run({ base, root }) {
  const repoRoot = root ?? process.cwd();
  const diffBase = mergeBase(base ?? "origin/main", repoRoot);
  const diffNames = (...args) =>
    git(["diff", "--name-only", ...args, `${diffBase}...HEAD`], repoRoot)
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  const changedFiles = diffNames();
  const addedFiles = diffNames("--diff-filter=A", "--find-renames");
  const changedEntries = changedFiles.map((file) => {
    if (!isKitPackageJson(file)) return { file };
    return {
      file,
      pkgJsonBefore: showBlob(repoRoot, diffBase, file),
      pkgJsonAfter: showBlob(repoRoot, "HEAD", file),
    };
  });
  const state = collect({
    rootDir: repoRoot,
    changedFiles,
    changedEntries,
    changesetFiles: listChangesetFiles(repoRoot, changedFiles, addedFiles),
    noReleaseReason: findNoReleaseReason(repoRoot, addedFiles),
    workspacePackages: readWorkspacePackages(repoRoot),
  });
  const verdict = evaluate(state);
  if (verdict.missing && botOnlySurfaces(repoRoot, diffBase, state.changedManagedFiles)) {
    return {
      status: 0,
      out:
        `changesets: skipping release-bot commits (exempt authors: ${RELEASE_BOTS.join(", ")})\n` +
        `  changed managed surface: ${state.managedPackages.join(", ")}\n`,
      state,
      base: diffBase,
    };
  }
  return { ...verdict, state, base: diffBase };
}

function flagValue(args, flag) {
  const i = args.indexOf(flag);
  return i === -1 ? null : args[i + 1];
}

function invokedAsCli() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (invokedAsCli()) {
  const result = run({
    base: flagValue(process.argv.slice(2), "--base"),
    root: flagValue(process.argv.slice(2), "--root"),
  });
  if (result.out) process.stdout.write(result.out);
  if (result.err) process.stderr.write(result.err);
  process.exitCode = result.status;
}
