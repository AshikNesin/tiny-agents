#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "@typescript/typescript6";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KIT_PROJECTS = [
  "tsconfig.json",
  "apps/web/tsconfig.json",
  "tests/e2e/tsconfig.json",
  "tests/kit-consumers/tsconfig.json",
];

function appProjects(): string[] {
  const manifest = path.join(repoRoot, "package.json");
  if (!fs.existsSync(manifest)) return [];
  const script: unknown = JSON.parse(fs.readFileSync(manifest, "utf8")).scripts?.["typecheck:app"];
  if (typeof script !== "string") return [];
  return [...script.matchAll(/(?:^|\s)(?:-p|--project)\s+(\S+)/g)].map(([, project]) => {
    const relative = project.replace(/^\.\//, "").replace(/\/$/, "");
    return relative.endsWith(".json") ? relative : `${relative}/tsconfig.json`;
  });
}

const CHECKED_PROJECTS = [...KIT_PROJECTS, ...appProjects()];
const SOURCE_EXTENSION = /\.(ts|tsx)$/;
const DECLARATION_EXTENSION = /\.d\.ts$/;

function toRepoRelative(absolutePath: string): string {
  return path.relative(repoRoot, absolutePath).split(path.sep).join("/");
}

function programFiles(configPath: string): Set<string> {
  const absolute = path.join(repoRoot, configPath);
  const read = ts.readConfigFile(absolute, ts.sys.readFile);
  if (read.error) {
    throw new Error(
      `${configPath}: ${ts.flattenDiagnosticMessageText(read.error.messageText, " ")}`,
    );
  }
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(absolute));
  if (parsed.errors.length > 0) {
    const messages = parsed.errors.map((error) =>
      ts.flattenDiagnosticMessageText(error.messageText, " "),
    );
    throw new Error(`${configPath}: ${messages.join("; ")}`);
  }
  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: { ...parsed.options, noEmit: true, skipLibCheck: true },
    projectReferences: parsed.projectReferences,
  });
  return new Set(program.getSourceFiles().map((file) => toRepoRelative(file.fileName)));
}

function sourceRoots(): string[] {
  const packages = fs
    .readdirSync(path.join(repoRoot, "packages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `packages/${entry.name}/src`)
    .filter((root) => fs.existsSync(path.join(repoRoot, root)));
  return ["apps/web/src", ...packages, "tests"];
}

function listSourceFiles(): { sources: string[]; declarations: string[] } {
  const sources: string[] = [];
  const declarations: string[] = [];
  for (const root of sourceRoots()) {
    const queue = [root];
    while (queue.length > 0) {
      const dir = queue.shift()!;
      for (const entry of fs.readdirSync(path.join(repoRoot, dir), { withFileTypes: true })) {
        const relative = `${dir}/${entry.name}`;
        if (entry.isDirectory()) queue.push(relative);
        else if (DECLARATION_EXTENSION.test(entry.name)) declarations.push(relative);
        else if (SOURCE_EXTENSION.test(entry.name)) sources.push(relative);
      }
    }
  }
  return { sources: sources.sort(), declarations: declarations.sort() };
}

function declarationDiagnostics(declarations: string[]): string[] {
  const failures: string[] = [];
  for (const configPath of CHECKED_PROJECTS) {
    const absolute = path.join(repoRoot, configPath);
    const read = ts.readConfigFile(absolute, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(absolute));
    const program = ts.createProgram({
      rootNames: declarations.map((file) => path.join(repoRoot, file)),
      options: { ...parsed.options, noEmit: true, skipLibCheck: false },
    });
    for (const file of declarations) {
      const source = program.getSourceFile(path.join(repoRoot, file));
      if (!source) {
        failures.push(`${file}: not loaded by the declarations pass`);
        continue;
      }
      const diagnostics = [
        ...program.getSyntacticDiagnostics(source),
        ...program.getSemanticDiagnostics(source),
      ];
      for (const diagnostic of diagnostics) {
        const line = source.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1;
        const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
        failures.push(`${file}:${line}: ${message}`);
      }
    }
    if (failures.length > 0) return failures;
  }
  return failures;
}

const checked = new Set<string>();
for (const project of CHECKED_PROJECTS) {
  for (const file of programFiles(project)) checked.add(file);
}

const { sources, declarations } = listSourceFiles();
const unowned = sources.filter((file) => !checked.has(file));
const brokenDeclarations = declarationDiagnostics(declarations);

console.log(
  `${sources.length - unowned.length}/${sources.length} source files covered by ${CHECKED_PROJECTS.length} typecheck projects (roots: ${sourceRoots().join(", ")})`,
);
if (unowned.length > 0) {
  for (const file of unowned) {
    console.error(`not covered by any checked typecheck project: ${file}`);
  }
  console.error(
    `Import each file from checked code, or add its directory to the "include" of one of: ${CHECKED_PROJECTS.join(", ")}.`,
  );
  process.exit(1);
}
if (brokenDeclarations.length > 0) {
  for (const failure of brokenDeclarations) {
    console.error(`declaration failed typecheck: ${failure}`);
  }
  process.exit(1);
}
