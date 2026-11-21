import esbuild from "esbuild";
import { sentryEsbuildPlugin } from "@sentry/esbuild-plugin";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

export const externalPackages = [
  "better-sqlite3",
  "vite",
  "vite-plus",
  "@vitejs/plugin-react",
  "lightningcss",
  "fsevents",
];

export function workerBuildOptions() {
  return {
    entryPoints: ["packages/claude-worker/src/bin.ts"],
    outfile: "dist/server/claude-worker.mjs",
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: ["@anthropic-ai/claude-agent-sdk", "ws", "zod"],
    logLevel: "info",
  };
}

export function esbuildOptions({ externals, plugins }) {
  return {
    entryPoints: {
      bundle: "apps/web/src/server/entry.node.ts",
      "uploads-extract-worker": "apps/web/src/server/api/uploads/uploads.extract.worker.ts",
    },
    outdir: "dist/server",
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    external: [...externals, ...externalPackages],
    plugins,
    alias: {
      "@groot/core": path.resolve(process.cwd(), "packages/core/src"),
      "@groot/jobs/server": path.resolve(process.cwd(), "packages/jobs/src/server"),
    },
    banner: {
      js: 'import { createRequire as __createRequire } from "node:module";const require = __createRequire(import.meta.url);',
    },
    sourcemap: true,
    tsconfig: "tsconfig.json",
    logLevel: "info",
    metafile: true,
  };
}

const pkg = JSON.parse(readFileSync("package.json", "utf-8"));

function getSentryRelease() {
  if (process.env.SENTRY_RELEASE) return process.env.SENTRY_RELEASE;
  const sourceVersion = process.env.SOURCE_COMMIT || process.env.SOURCE_VERSION;
  if (sourceVersion) return `${pkg.name}@${sourceVersion.slice(0, 7)}`;
  try {
    return `${pkg.name}@${execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim().slice(0, 7)}`;
  } catch {
    return undefined;
  }
}

async function build() {
  const externals = Object.keys(pkg.dependencies || {});
  const release = getSentryRelease();
  const authToken = process.env.SENTRY_AUTH_TOKEN;
  const plugins =
    release && authToken && process.env.SENTRY_ORG
      ? [
          sentryEsbuildPlugin({
            authToken,
            org: process.env.SENTRY_ORG,
            project: process.env.SENTRY_PROJECT || pkg.name,
            release: { name: release },
            sourcemaps: { filesToDeleteAfterUpload: ["dist/server/*.map"] },
          }),
        ]
      : [];

  const options = esbuildOptions({ externals, plugins });
  if (release) options.define = { "process.env.SENTRY_RELEASE": JSON.stringify(release) };
  const result = await esbuild.build(options);
  await esbuild.build(workerBuildOptions());

  await fs.mkdir("tmp", { recursive: true });
  await fs.writeFile("tmp/metafile.json", JSON.stringify(result.metafile));

  await fs.rm("dist/server/drizzle", { recursive: true, force: true });
  await fs.cp("apps/web/drizzle", "dist/server/drizzle", { recursive: true });
  console.log(
    "✓ Server bundle written to dist/server/bundle.js (+ claude-worker.mjs, drizzle migrations)",
  );
}

build().catch((error) => {
  console.error(error);
  process.exit(1);
});
