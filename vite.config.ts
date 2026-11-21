import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { boundaryOverrides } from "./scripts/lint/boundaries";
import { DurationSequencer } from "./tests/sequencer";

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
    find: "@tiny-agents/agent/wire",
    replacement: path.resolve(packagesDir, "agent/src/wire.ts"),
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
    plugins: ["eslint", "typescript", "unicorn", "oxc", "react", "jsx-a11y", "import", "vitest"],
    categories: { correctness: "error", suspicious: "error", perf: "error" },
    rules: {
      "no-unused-vars": "error",
      eqeqeq: ["error", "smart"],
      "no-redeclare": "error",

      "react/react-in-jsx-scope": "off",
      "react/set-state-in-effect": "off",
      "react/exhaustive-effect-dependencies": "off",
      "react/immutability": "off",
      "react/refs": "off",
      "react/purity": "off",
      "react/globals": "off",
      "react/memo-dependencies": "off",
      "react/use-memo": "off",
      "react/no-array-index-key": "off",
      "react/no-unstable-nested-components": "off",
      "react/no-object-type-as-default-prop": "off",
      "react/jsx-no-constructed-context-values": "off",
      "react-hooks/exhaustive-deps": "off",
      "jsx-a11y/prefer-tag-over-role": "off",
      "jsx-a11y/no-redundant-roles": "off",
      "jsx-a11y/no-autofocus": "off",
      "no-await-in-loop": "off",
      "unicorn/consistent-function-scoping": "off",
      "unicorn/no-array-sort": "off",
      "unicorn/no-array-reverse": "off",
      "unicorn/no-useless-spread": "off",
      "unicorn/prefer-set-has": "off",
      "oxc/no-map-spread": "off",
      "no-shadow": "off",
      "no-underscore-dangle": "off",
      "no-new": "off",
      "unicorn/prefer-add-event-listener": "off",
      "import/no-unassigned-import": "off",
      "import/no-named-as-default-member": "off",
      "vitest/valid-expect": ["error", { maxArgs: 2 }],
      "vitest/require-mock-type-parameters": "off",
      "vitest/require-to-throw-message": "off",
      "vitest/prefer-snapshot-hint": "off",
      "vitest/no-conditional-expect": "off",
      "vitest/no-standalone-expect": "off",
      "vitest/valid-title": ["error", { allowArguments: true }],
      "vitest/expect-expect": [
        "error",
        {
          assertFunctionNames: [
            "expect",
            "expect*",
            "assert*",
            "pin",
            "until",
            "eventually",
            "closed",
            "awaiting*",
            "exact",
            "refused",
            "allowed",
            "uploadFile",
          ],
        },
      ],
    },
    overrides: [
      ...boundaryOverrides("./scripts/lint/repo-plugin.mjs"),
      {
        files: ["apps/**", "packages/**"],
        rules: { "vitest/no-commented-out-tests": "off" },
      },
      {
        files: [
          "apps/web/src/client/components/Attachments.tsx",
          "apps/web/src/client/components/ChatComposer.tsx",
          "apps/web/src/client/components/chat-message/ToolRow.tsx",
          "apps/web/src/client/components/fluid/ask-user-questions.tsx",
          "apps/web/src/client/components/ui/code-block.tsx",
          "apps/web/src/client/components/vault/PolicyForm.tsx",
          "apps/web/src/client/pages/code/CodeSettings.tsx",
          "apps/web/src/client/pages/code/Composer.tsx",
          "apps/web/src/client/pages/code/DiffWorkspace.tsx",
          "apps/web/src/client/pages/skills/Skills.tsx",
          "apps/web/src/client/pages/terminal/TerminalView.tsx",
          "packages/shell/src/pages/settings/SettingsSearch.tsx",
          "packages/ui/src/card.tsx",
          "packages/ui/src/command-menu.tsx",
          "packages/ui/src/input-group.tsx",
          "packages/ui/src/pagination.tsx",
          "packages/ui/vendor/fluid/scroll-area.tsx",
        ],
        rules: {
          "jsx-a11y/anchor-has-content": "off",
          "jsx-a11y/aria-role": "off",
          "jsx-a11y/click-events-have-key-events": "off",
          "jsx-a11y/control-has-associated-label": "off",
          "jsx-a11y/heading-has-content": "off",
          "jsx-a11y/interactive-supports-focus": "off",
          "jsx-a11y/label-has-associated-control": "off",
          "jsx-a11y/no-noninteractive-element-interactions": "off",
          "jsx-a11y/no-noninteractive-element-to-interactive-role": "off",
          "jsx-a11y/no-noninteractive-tabindex": "off",
          "jsx-a11y/no-static-element-interactions": "off",
        },
      },
    ],
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
    sequence: { shuffle: true, sequencer: DurationSequencer },
    include: ["../../tests/client/**/*.test.{ts,tsx}"],
    exclude: ["src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    setupFiles: ["../../tests/client/setup.ts"],
    alias: aliases,
  },
});
