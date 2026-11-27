#!/usr/bin/env tsx
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { parseSync } from "oxc-parser";

const ROOTS = [
  "apps/web/src",
  "packages/agent",
  "packages/claude-worker",
  "packages/code",
  "packages/git",
  "packages/github",
  "packages/models",
  "packages/sandbox",
  "packages/std",
];
const SKIP = /(^|\/)(vendor|dist|node_modules)\/|\.test\.tsx?$|\.d\.ts$/;
const MIN_LENGTH = 90;

export interface FunctionSite {
  file: string;
  name: string;
  line: number;
}

function functionsOf(file: string, text: string): { key: string; site: FunctionSite }[] {
  const { program } = parseSync(file, text);
  const found: { key: string; site: FunctionSite }[] = [];
  const add = (name: string, shape: { start: number; end: number }) => {
    const body = text.slice(shape.start, shape.end).replace(/\s+/g, " ");
    if (body.length < MIN_LENGTH) return;
    const line = text.slice(0, shape.start).split("\n").length;
    found.push({ key: `${name}:${body}`, site: { file, name, line } });
  };
  for (const statement of program.body) {
    const node = statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
    if (node?.type === "FunctionDeclaration" && node.id && node.body) {
      add(node.id.name, node);
      continue;
    }
    if (node?.type !== "VariableDeclaration") continue;
    for (const declaration of node.declarations) {
      const init = declaration.init;
      if (declaration.id.type !== "Identifier" || !init) continue;
      if (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression") {
        add(declaration.id.name, init);
      }
    }
  }
  return found;
}

const signature = (text: string) =>
  text
    .replace(/^(async )?function \w+/, "$1")
    .replace(/=>|[{}();]|\breturn\b/g, "")
    .replace(/\s+/g, "");

export function duplicateFunctions(files: ReadonlyMap<string, string>): FunctionSite[][] {
  const groups = new Map<string, FunctionSite[]>();
  for (const [file, text] of files) {
    for (const { key, site } of functionsOf(file, text)) {
      const at = key.indexOf(":");
      const normal = `${key.slice(0, at)}:${signature(key.slice(at + 1))}`;
      groups.set(normal, [...(groups.get(normal) ?? []), site]);
    }
  }
  return [...groups.values()].filter((sites) => new Set(sites.map((site) => site.file)).size > 1);
}

function main(): void {
  const listed = execFileSync("git", ["ls-files", ...ROOTS], { encoding: "utf8" })
    .split("\n")
    .filter((file) => /\.tsx?$/.test(file) && !SKIP.test(file));
  const files = new Map(listed.map((file) => [file, readFileSync(file, "utf8")]));
  const duplicates = duplicateFunctions(files);
  if (duplicates.length === 0) {
    console.log(`✓ No function is written twice (${files.size} files).`);
    return;
  }
  for (const sites of duplicates) {
    console.error(
      `${sites[0]!.name}() is written ${sites.length} times with the same body. Keep one, export it, and import it in the others (a helper every package needs goes in packages/std):`,
    );
    for (const site of sites) console.error(`  ${site.file}:${site.line}`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
