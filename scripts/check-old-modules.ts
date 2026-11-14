#!/usr/bin/env tsx
/**
 * Old-modules gate: the rewrite's retired-paths list (scripts/old-modules.json,
 * linked from docs/rewrite/PLAN.md) stays retired. It fails when
 *
 * - a retired path exists, or any source file imports it (relative, `@/` or
 *   a workspace package subpath);
 * - a retired symbol is declared or exported anywhere;
 * - a retired module singleton is declared again at the top of its file;
 * - a helper the rewrite made single is declared outside its one module;
 * - a retired pattern (the old transcript file, hand-copied wire types, a
 *   hand-rolled shell quote, a past chat's own fetching) matches;
 * - a narrowed module (docs/rewrite/DECISIONS.md D13) grows back: chat
 *   actions in bots.service.ts, manager logic in the session instances,
 *   state in the live-view wrappers;
 * - something in this repo imports a deprecated re-export of
 *   `@tiny-agents/agent`, kept only for outside importers until a major;
 * - an entry's `replacedBy` path does not exist.
 *
 * Usage: tsx scripts/check-old-modules.ts
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import micromatch from "micromatch";
// TypeScript 7 (the native compiler) ships no classic JS API; the TS 6 package
// keeps it for AST scripts like this one.
import ts from "@typescript/typescript6";

export const LIST = "scripts/old-modules.json";

interface Replaced {
  replacedBy: string;
  note?: string;
  step?: string;
}
interface Forbidden {
  pattern: string;
  why: string;
}
export interface OldModules {
  paths?: (Replaced & { path: string })[];
  symbols?: (Replaced & { symbol: string })[];
  moduleState?: (Replaced & { file: string; names: string[] })[];
  definedOnlyIn?: (Replaced & { symbols: string[]; file: string; scope: string })[];
  patterns?: (Replaced & {
    pattern: string;
    flags?: string;
    files: string[];
    except?: string[];
    what: string;
  })[];
  narrowed?: {
    file: string;
    role: string;
    noDeclarationsExportedBy?: string;
    require?: Forbidden[];
    forbid?: Forbidden[];
  }[];
  deprecated?: { package: string; root: string; subpaths: string[] };
}

const SCANNED_DIRS = ["apps", "packages", "tests", "scripts", "site"];
const SKIPPED_DIRS = new Set(["node_modules", "dist", "build", "coverage", ".vite", ".turbo"]);
const SOURCE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const EXTENSION = /\.(d\.ts|ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

function sourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    const abs = path.join(root, dir);
    if (!existsSync(abs)) return;
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const rel = path.posix.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) walk(rel);
      } else if (SOURCE.test(entry.name)) {
        out.push(rel);
      }
    }
  };
  for (const dir of SCANNED_DIRS) walk(dir);
  return out.sort();
}

function parse(root: string, file: string): ts.SourceFile {
  const kind = file.endsWith("x") ? ts.ScriptKind.TSX : undefined;
  return ts.createSourceFile(
    file,
    readFileSync(path.join(root, file), "utf8"),
    ts.ScriptTarget.Latest,
    false,
    kind,
  );
}

/** Every module specifier a file names: imports, re-exports, `import()`, `require()`, `vi.mock()`. */
function specifiersOf(source: ts.SourceFile): string[] {
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      out.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.arguments[0]) {
      const [first] = node.arguments;
      const callee = node.expression;
      const loads =
        callee.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(callee) && callee.text === "require") ||
        (ts.isPropertyAccessExpression(callee) &&
          ["mock", "doMock", "importActual", "importMock"].includes(callee.name.text));
      if (loads && ts.isStringLiteralLike(first)) out.push(first.text);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      out.push(node.argument.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

/** Workspace package names to their directory and `exports` map. */
function workspacePackages(
  root: string,
): Map<string, { dir: string; exports: Record<string, unknown> }> {
  const packages = new Map<string, { dir: string; exports: Record<string, unknown> }>();
  for (const parent of ["packages", "apps"]) {
    const abs = path.join(root, parent);
    if (!existsSync(abs)) continue;
    for (const name of readdirSync(abs)) {
      const manifest = path.join(abs, name, "package.json");
      if (!existsSync(manifest)) continue;
      const json = JSON.parse(readFileSync(manifest, "utf8")) as {
        name?: string;
        exports?: unknown;
      };
      if (!json.name) continue;
      const exports =
        typeof json.exports === "string"
          ? { ".": json.exports }
          : ((json.exports as Record<string, unknown> | undefined) ?? {});
      packages.set(json.name, { dir: `${parent}/${name}`, exports });
    }
  }
  return packages;
}

function exportTarget(target: unknown): string | undefined {
  if (typeof target === "string") return target;
  if (target && typeof target === "object") {
    for (const key of ["import", "default", "types"]) {
      const found = exportTarget((target as Record<string, unknown>)[key]);
      if (found) return found;
    }
  }
  return undefined;
}

/** The repo path (extension dropped) a specifier names, or undefined for an outside module. */
function resolve(
  from: string,
  specifier: string,
  packages: ReturnType<typeof workspacePackages>,
): string | undefined {
  let target: string | undefined;
  if (specifier.startsWith(".")) {
    target = path.posix.join(path.posix.dirname(from), specifier);
  } else if (specifier.startsWith("@/")) {
    target = `apps/web/src/client/${specifier.slice(2)}`;
  } else {
    const scoped = specifier.startsWith("@");
    const parts = specifier.split("/");
    const name = parts.slice(0, scoped ? 2 : 1).join("/");
    const pkg = packages.get(name);
    if (!pkg) return undefined;
    const sub = parts.slice(scoped ? 2 : 1).join("/");
    const mapped = exportTarget(pkg.exports[sub ? `./${sub}` : "."]);
    target = path.posix.join(pkg.dir, mapped ?? sub);
  }
  return path.posix.normalize(target).replace(EXTENSION, "");
}

function hits(resolved: string, retired: string): boolean {
  const bare = retired.replace(/\/$/, "").replace(EXTENSION, "");
  return resolved === bare || resolved === `${bare}/index` || resolved.startsWith(`${bare}/`);
}

/** Names a node declares: functions, classes, types, variables, members and export names. */
function declaredNames(source: ts.SourceFile): Map<string, number> {
  const names = new Map<string, number>();
  const add = (name: ts.Node | undefined) => {
    if (
      name &&
      (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isPrivateIdentifier(name))
    ) {
      const text = name.text.replace(/^#/, "");
      if (!names.has(text))
        names.set(text, source.getLineAndCharacterOfPosition(name.getStart(source)).line + 1);
    }
  };
  const visit = (node: ts.Node) => {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isEnumDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isMethodSignature(node) ||
      ts.isPropertyDeclaration(node) ||
      ts.isPropertySignature(node) ||
      ts.isPropertyAssignment(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isExportSpecifier(node)
    ) {
      add(node.name);
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      add(node.name);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

/** Names declared by the file's top-level statements (or the given ones of them). */
function topLevelNames(
  source: ts.SourceFile,
  statements: readonly ts.Statement[] = source.statements,
): Map<string, number> {
  const names = new Map<string, number>();
  const line = (node: ts.Node) =>
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  for (const statement of statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.set(declaration.name.text, line(declaration));
      }
    } else if (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
      statement.name
    ) {
      names.set(statement.name.text, line(statement));
    }
  }
  return names;
}

function isExported(statement: ts.Statement): boolean {
  return (
    ts.canHaveModifiers(statement) &&
    (ts.getModifiers(statement) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  );
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

/** Names `packages/agent/src/index.ts` re-exports under a `@deprecated` tag. */
function deprecatedNames(rootText: string): Set<string> {
  return new Set(
    [...rootText.matchAll(/\/\*\*[^*]*@deprecated[^*]*\*\/\s*(?:type\s+)?(\w+)/g)].map((m) => m[1]),
  );
}

export function oldModuleProblems(root: string, list: OldModules): string[] {
  const problems: string[] = [];
  const files = sourceFiles(root);
  const packages = workspacePackages(root);
  const sources = new Map<string, ts.SourceFile>();
  const sourceOf = (file: string) => {
    let source = sources.get(file);
    if (!source) {
      source = parse(root, file);
      sources.set(file, source);
    }
    return source;
  };
  const texts = new Map<string, string>();
  const text = (file: string) => {
    let body = texts.get(file);
    if (body === undefined) {
      body = readFileSync(path.join(root, file), "utf8");
      texts.set(file, body);
    }
    return body;
  };
  // Parsing every file is the slow part, so a file is parsed only when its
  // text names something the check looks for.
  const mentions = (file: string, needles: readonly string[]) =>
    needles.some((needle) => text(file).includes(needle));
  const exists = (file: string) => existsSync(path.join(root, file));

  const entries: Replaced[] = [
    ...(list.paths ?? []),
    ...(list.symbols ?? []),
    ...(list.moduleState ?? []),
    ...(list.definedOnlyIn ?? []),
    ...(list.patterns ?? []),
  ];
  for (const entry of entries) {
    if (!exists(entry.replacedBy)) {
      problems.push(
        `${LIST}: replacedBy "${entry.replacedBy}" does not exist. Point it at what replaced the old module.`,
      );
    }
  }

  // Retired paths: gone, and nothing imports them.
  for (const { path: retired, replacedBy } of list.paths ?? []) {
    if (exists(retired)) {
      problems.push(
        `${retired} is on the retired-paths list but exists. Delete it; ${replacedBy} replaced it.`,
      );
    }
  }
  const retiredPaths = (list.paths ?? []).map((entry) => entry.path);
  // A specifier names a retired path by its last segment, or by a package
  // export key that maps into it.
  const pathNeedles = [
    ...retiredPaths.map((retired) =>
      path.posix.basename(retired.replace(/\/$/, "")).replace(EXTENSION, ""),
    ),
    ...[...packages.values()].flatMap(({ dir, exports }) =>
      Object.entries(exports)
        .filter(([, target]) => {
          const file = exportTarget(target);
          if (!file) return false;
          const resolved = path.posix.join(dir, file).replace(EXTENSION, "");
          return retiredPaths.some((retired) => hits(resolved, retired));
        })
        .map(([key]) => path.posix.basename(key)),
    ),
  ];
  for (const file of files) {
    if (retiredPaths.length === 0) break;
    if (!mentions(file, pathNeedles)) continue;
    for (const specifier of specifiersOf(sourceOf(file))) {
      const resolved = resolve(file, specifier, packages);
      if (!resolved) continue;
      const retired = retiredPaths.find((candidate) => hits(resolved, candidate));
      if (retired) {
        const by = list.paths!.find((entry) => entry.path === retired)!.replacedBy;
        problems.push(
          `${file} imports "${specifier}", which is retired (${retired}). Import ${by} instead.`,
        );
      }
    }
  }

  // Retired symbols: declared nowhere.
  const symbols = new Map((list.symbols ?? []).map((entry) => [entry.symbol, entry]));
  if (symbols.size > 0) {
    for (const file of files) {
      if (!mentions(file, [...symbols.keys()])) continue;
      for (const [name, line] of declaredNames(sourceOf(file))) {
        const entry = symbols.get(name);
        if (entry) {
          problems.push(
            `${file}:${line} declares ${name}, which the rewrite retired (${entry.step}). ${entry.note ?? ""} See ${entry.replacedBy}.`.replace(
              /\s+See/,
              " See",
            ),
          );
        }
      }
    }
  }

  // Retired module singletons: not declared again at the top of their file.
  for (const entry of list.moduleState ?? []) {
    if (!exists(entry.file)) continue;
    const declared = topLevelNames(sourceOf(entry.file));
    for (const name of entry.names) {
      const line = declared.get(name);
      if (line !== undefined) {
        problems.push(
          `${entry.file}:${line} declares module-level ${name}, a singleton the App root replaced (${entry.note ?? entry.replacedBy}). Keep it in ${entry.replacedBy}.`,
        );
      }
    }
  }

  // Helpers made single: declared only in their one module.
  for (const entry of list.definedOnlyIn ?? []) {
    const wanted = new Set(entry.symbols);
    for (const file of files) {
      if (file === entry.file || !micromatch.isMatch(file, entry.scope)) continue;
      if (!mentions(file, entry.symbols)) continue;
      for (const [name, line] of topLevelNames(sourceOf(file))) {
        if (wanted.has(name)) {
          problems.push(
            `${file}:${line} declares ${name}, which lives only in ${entry.file} since the rewrite (${entry.step}). Import it from there.`,
          );
        }
      }
    }
  }

  // Retired patterns.
  for (const entry of list.patterns ?? []) {
    const regex = new RegExp(entry.pattern, `g${entry.flags ?? ""}`);
    for (const file of files) {
      if (!micromatch.isMatch(file, entry.files) || micromatch.isMatch(file, entry.except ?? []))
        continue;
      const body = text(file);
      for (const match of body.matchAll(regex)) {
        problems.push(
          `${file}:${lineOf(body, match.index)} has ${entry.what} (\`${match[0]}\`), retired in ${entry.step}. Use ${entry.replacedBy}.`,
        );
      }
    }
  }

  // Narrowed modules (D13) stay narrow.
  for (const entry of list.narrowed ?? []) {
    if (!exists(entry.file)) {
      problems.push(
        `${entry.file} is a narrowed module (${entry.role}) but does not exist. Update ${LIST} if it was renamed.`,
      );
      continue;
    }
    const body = text(entry.file);
    for (const { pattern, why } of entry.require ?? []) {
      if (!new RegExp(pattern).test(body)) {
        problems.push(
          `${entry.file} must stay ${entry.role}: it no longer matches /${pattern}/ (${why}).`,
        );
      }
    }
    for (const { pattern, why } of entry.forbid ?? []) {
      for (const match of body.matchAll(new RegExp(pattern, "g"))) {
        problems.push(
          `${entry.file}:${lineOf(body, match.index)} has \`${match[0]}\`, but it must stay ${entry.role}: ${why}.`,
        );
      }
    }
    if (entry.noDeclarationsExportedBy) {
      const other = sourceOf(entry.noDeclarationsExportedBy);
      const exported = new Set(topLevelNames(other, other.statements.filter(isExported)).keys());
      for (const [name, line] of topLevelNames(sourceOf(entry.file))) {
        if (exported.has(name)) {
          problems.push(
            `${entry.file}:${line} declares ${name}, a chat action ${entry.noDeclarationsExportedBy} owns; ${entry.file} must stay ${entry.role}.`,
          );
        }
      }
    }
  }

  // Deprecated re-exports: kept for outside importers, used by nobody here.
  if (list.deprecated) {
    const { package: name, root: rootFile, subpaths } = list.deprecated;
    const names = deprecatedNames(text(rootFile));
    const own = `${path.posix.dirname(path.posix.dirname(rootFile))}/`;
    for (const file of files) {
      if (file.startsWith(own) || !mentions(file, [name])) continue;
      const source = sourceOf(file);
      const visit = (node: ts.Node) => {
        if (
          (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
          node.moduleSpecifier &&
          ts.isStringLiteral(node.moduleSpecifier)
        ) {
          const specifier = node.moduleSpecifier.text;
          const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
          if (subpaths.includes(specifier)) {
            problems.push(
              `${file}:${line} imports "${specifier}", a deprecated re-export of @tiny-agents/sandbox. Import the package itself.`,
            );
          } else if (specifier === name) {
            const elements = ts.isImportDeclaration(node)
              ? node.importClause?.namedBindings &&
                ts.isNamedImports(node.importClause.namedBindings)
                ? node.importClause.namedBindings.elements
                : []
              : node.exportClause && ts.isNamedExports(node.exportClause)
                ? node.exportClause.elements
                : [];
            for (const element of elements) {
              const imported = (element.propertyName ?? element.name).text;
              if (names.has(imported)) {
                problems.push(
                  `${file}:${line} imports ${imported} from "${name}", a deprecated re-export. Import it from the package that owns it (@tiny-agents/models or @tiny-agents/sandbox).`,
                );
              }
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }

  return problems;
}

/** What the list holds, for the summary line. */
function countOf(list: OldModules): string {
  return [
    `${list.paths?.length ?? 0} retired paths`,
    `${list.symbols?.length ?? 0} symbols`,
    `${(list.moduleState ?? []).reduce((n, entry) => n + entry.names.length, 0)} module singletons`,
    `${list.definedOnlyIn?.length ?? 0} single-module helpers`,
    `${list.patterns?.length ?? 0} patterns`,
    `${list.narrowed?.length ?? 0} narrowed modules`,
  ].join(", ");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const list = JSON.parse(readFileSync(path.join(root, LIST), "utf8")) as OldModules;
  const problems = oldModuleProblems(root, list);
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) {
    console.error(`\n${problems.length} old-module problem(s). The list is ${LIST}.`);
    process.exit(1);
  }
  console.log(`old modules: none back (${countOf(list)}).`);
}
