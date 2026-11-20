#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";

const DEV_ONLY_DYNAMIC_IMPORTS = {
  "vite-plus": "dev-only dynamic import; the production path never loads it",
};

function rootPackageName(specifier) {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function isNodeBuiltin(specifier) {
  return specifier.startsWith("node:") || builtinModules.includes(specifier);
}

function exemptionFor(edge) {
  if (isNodeBuiltin(edge.path)) return "provided by the Node runtime";
  const name = rootPackageName(edge.path);
  if (edge.kind === "dynamic-import" && DEV_ONLY_DYNAMIC_IMPORTS[name]) {
    return DEV_ONLY_DYNAMIC_IMPORTS[name];
  }
  return null;
}

export function checkRuntimeClosure({ metafile, dependencies }) {
  const edges = Object.values(metafile.outputs).flatMap((output) =>
    (output.imports || []).filter((edge) => edge.external),
  );

  const failures = [];
  for (const edge of edges) {
    const exemption = exemptionFor(edge);
    if (exemption) {
      console.log(`EXEMPT ${edge.path} (${edge.kind}): ${exemption}`);
      continue;
    }
    const name = rootPackageName(edge.path);
    if (dependencies.has(name)) continue;
    failures.push(
      `RUNTIME_DEPENDENCY ${edge.path} (${edge.kind}) absent from root dependencies; ` +
        `declare it in the production owner or deploy that workspace's closure.`,
    );
  }

  return { edgeCount: edges.length, failures: [...new Set(failures)] };
}

async function main() {
  const metafilePath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(process.cwd(), "tmp", "metafile.json");

  const metafile = JSON.parse(readFileSync(metafilePath, "utf8"));
  const pkg = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
  const dependencies = new Set(Object.keys(pkg.dependencies || {}));

  const { edgeCount, failures } = checkRuntimeClosure({ metafile, dependencies });

  for (const failure of failures) console.error(failure);
  console.log(`checked ${edgeCount} emitted external edges; ${failures.length} ownership errors`);
  process.exitCode = failures.length ? 1 : 0;
}

const invokedDirectly =
  process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href;
if (invokedDirectly) {
  await main();
}
