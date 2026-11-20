import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { boundaryOverrides } from "./scripts/lint/boundaries";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const clientSrc = path.resolve(rootDir, "apps/web/src/client");
const packagesDir = path.resolve(rootDir, "packages");
const pkgName = JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf-8")).name;

function getSentryRelease() {
  if (process.env.SENTRY_RELEASE) return process.env.SENTRY_RELEASE;
  const sourceVersion = process.env.SOURCE_COMMIT || process.env.SOURCE_VERSION;
  if (sourceVersion) return `${pkgName}@${sourceVersion.slice(0, 7)}`;
  try {
    const sha = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
    return `${pkgName}@${sha.slice(0, 7)}`;
  } catch {
    return undefined;
  }
}

const release = getSentryRelease();
const authToken = process.env.SENTRY_AUTH_TOKEN;

const aliases = [
  { find: "@groot/shell/index.css", replacement: path.resolve(packagesDir, "shell/src/index.css") },
  { find: "@groot/ui", replacement: path.resolve(packagesDir, "ui/src") },
  { find: "@groot/jobs/client", replacement: path.resolve(packagesDir, "jobs/src/client") },
  { find: "@groot/shell", replacement: path.resolve(packagesDir, "shell/src") },
  {
    find: "@tiny-agents/agent/peer-envelope",
    replacement: path.resolve(packagesDir, "agent/src/toolkits/peer-envelope.ts"),
  },
  {
    find: "@tiny-agents/code/contracts",
    replacement: path.resolve(packagesDir, "code/src/contracts/index.ts"),
  },
  { find: "@", replacement: clientSrc },
];

export default defineConfig({
  staged: {
    "*": "vp check --fix",
    "*.{ts,tsx,css}": "pnpm check:tokens",
  },

  root: "apps/web",
  plugins: [
    react(),
    tailwindcss(),
    ...(release && authToken && process.env.SENTRY_ORG
      ? [
          sentryVitePlugin({
            authToken,
            org: process.env.SENTRY_ORG,
            project: process.env.SENTRY_PROJECT || pkgName,
            release: { name: release },
            sourcemaps: {
              filesToDeleteAfterUpload: ["dist/client/assets/*.map"],
            },
          }),
        ]
      : []),
  ],
  resolve: {
    alias: aliases,
  },
  build: {
    outDir: path.resolve(rootDir, "dist/client"),
    emptyOutDir: false,
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes("node_modules/react/") ||
            id.includes("node_modules/react-dom/") ||
            id.includes("node_modules/react-router-dom/")
          ) {
            return "react-vendor";
          }
        },
      },
    },
  },
  server: {
    middlewareMode: true,
    allowedHosts: process.env.PORTLESS_URL
      ? true
      : process.env.VITE_HMR_URL
        ? [process.env.VITE_HMR_URL]
        : undefined,
    ws: process.env.VITE_HMR_URL
      ? {
          protocol: "wss",
          host: process.env.VITE_HMR_URL,
          clientPort: 443,
        }
      : process.env.PORTLESS_URL
        ? (() => {
            try {
              const url = new URL(process.env.PORTLESS_URL);
              return {
                protocol: url.protocol === "https:" ? "wss" : "ws",
                host: url.hostname,
                clientPort: url.port
                  ? parseInt(url.port, 10)
                  : url.protocol === "https:"
                    ? 443
                    : 80,
              };
            } catch {
              return undefined;
            }
          })()
        : undefined,
  },
  publicDir: "./public",

  lint: {
    ignorePatterns: [
      "dist/**",
      "node_modules/**",
      "mobile/**",
      ".agents/skills/stageshow/**",
      ".claude/skills/stageshow/**",
      "site/demos/kit/**",
      "site/assets/**",
      "scripts/demo/launch/assets/**",
      "scripts/demo/launch/snap/**",
    ],
    rules: { "no-unused-vars": "error" },
    overrides: boundaryOverrides("./scripts/lint/repo-plugin.mjs"),
  },

  fmt: {
    ignorePatterns: [
      "**/CHANGELOG.md",
      "mobile/**",
      ".agents/skills/stageshow/**",
      ".claude/skills/stageshow/**",
      "site/demos/kit/**",
      "site/assets/**",
      "scripts/demo/launch/assets/**",
      "scripts/demo/launch/snap/**",
    ],
    semi: true,
    singleQuote: false,
  },

  test: {
    clearMocks: false,
    include: ["../../tests/client/**/*.test.{ts,tsx}"],
    exclude: ["src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    setupFiles: ["../../tests/client/setup.ts"],
    alias: aliases,
  },
});
