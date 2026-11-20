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
// App name used for Sentry release tags. Derived from package.json so child
// repos that use a different project don't need to fork this config.
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

// Shared @groot/* + @ aliases for both the build and the client test runner.
// Duplicated below they drift out of sync; a single source of truth prevents
// the test resolver from resolving a different module shape than the build.
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
  // Git hooks configuration
  staged: {
    "*": "vp check --fix",
    "*.{ts,tsx,css}": "pnpm check:tokens",
  },

  // Vite build configuration - build from apps/web
  root: "apps/web",
  plugins: [
    react(),
    // The Vite plugin, not @tailwindcss/postcss: under PostCSS, Vite rewrites
    // url()s after Tailwind has inlined @imports and lost their source files,
    // so @fontsource's relative ./files/*.woff2 never resolved and the fonts
    // 404'd to index.html in production.
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

  // Linting configuration
  lint: {
    // Vendored code is linted where it comes from: the Stageshow skill
    // (installed by `npx skills`), its kit copied into the site, and the
    // site's built demo bundle. `mobile/` is the Android app, a child of
    // groot-mobile-app with its own tooling and checks (`pnpm check` there);
    // its synced files must stay byte-for-byte what the boilerplate ships.
    ignorePatterns: [
      "dist/**",
      "node_modules/**",
      "mobile/**",
      ".agents/skills/stageshow/**",
      ".claude/skills/stageshow/**",
      "site/demos/kit/**",
      "site/assets/**",
      // Generated from the running app for the launch film (tools/snaplib.mjs).
      "scripts/demo/launch/assets/**",
      "scripts/demo/launch/snap/**",
    ],
    // Every category but pedantic, style and restriction, and every plugin
    // that applies to this stack, as errors. A rule turned off below says why.
    plugins: ["eslint", "typescript", "unicorn", "oxc", "react", "jsx-a11y", "import", "vitest"],
    categories: { correctness: "error", suspicious: "error", perf: "error" },
    rules: {
      "no-unused-vars": "error",
      // From pedantic: loose equality other than `== null` hides type bugs.
      eqeqeq: ["error", "smart"],
      "no-redeclare": "error",

      // Off, with the reason. The React JSX transform needs no React in scope.
      "react/react-in-jsx-scope": "off",
      // React Compiler-style rules (effects, memo, refs, purity, keys) run in
      // react-doctor (.github/workflows/react-doctor.yml), triaged there (#413).
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
      // ARIA roles on the matching tag are deliberate: role="list" on a list
      // styled without bullets keeps VoiceOver announcing it, and swapping a
      // role="status" or role="img" for its tag changes layout and styling.
      "jsx-a11y/prefer-tag-over-role": "off",
      "jsx-a11y/no-redundant-roles": "off",
      // Dialogs and the composer focus their first field on purpose.
      "jsx-a11y/no-autofocus": "off",
      // Awaits in a loop are deliberate here: ordered writes, polling, and
      // calls a remote end rate-limits.
      "no-await-in-loop": "off",
      // Closures over a component's or test's scope are the style, not a bug.
      "unicorn/consistent-function-scoping": "off",
      // The arrays sorted or reversed in place are fresh copies.
      "unicorn/no-array-sort": "off",
      "unicorn/no-array-reverse": "off",
      // Its "useless" spreads are copies taken before a loop that deletes
      // from the collection it walks.
      "unicorn/no-useless-spread": "off",
      // The arrays it would make Sets hold three to five constants.
      "unicorn/prefer-set-has": "off",
      // Copying objects in .map() is how this code stays immutable.
      "oxc/no-map-spread": "off",
      // Shadowing (`db`, `app`, `row`) is common and intended.
      "no-shadow": "off",
      // Drizzle and SDK fields use leading underscores.
      "no-underscore-dangle": "off",
      // `new URL(x)` validates its input.
      "no-new": "off",
      // A socket's handler has one owner: `ws.onmessage = …` is fine.
      "unicorn/prefer-add-event-listener": "off",
      // Side-effect imports (CSS, setup modules) and default-import members
      // (zod, dayjs) are the libraries' documented use.
      "import/no-unassigned-import": "off",
      "import/no-named-as-default-member": "off",
      // Vitest: `expect(value, message)` is Vitest's message argument; the mock's
      // type comes from what it mocks; throw messages and snapshot hints are
      // style.
      "vitest/valid-expect": ["error", { maxArgs: 2 }],
      "vitest/require-mock-type-parameters": "off",
      "vitest/require-to-throw-message": "off",
      "vitest/prefer-snapshot-hint": "off",
      // Table-driven tests assert per case under a condition, and setup hooks
      // and helpers check their own preconditions. expect-expect still makes
      // every test assert.
      "vitest/no-conditional-expect": "off",
      "vitest/no-standalone-expect": "off",
      // Shared suites (golden flows, conformance) take their titles as values.
      "vitest/valid-title": ["error", { allowArguments: true }],
      // Helpers that assert: pinned snapshots, expectX/assertX, the waits that
      // throw on timeout (until, eventually, closed, awaiting*), and the
      // drift and SSRF helpers that compare or expect inside.
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
      // Vitest rules read source comments too: `fit()` (xterm's) reads as a
      // focused test.
      {
        files: ["apps/**", "packages/**"],
        rules: { "vitest/no-commented-out-tests": "off" },
      },
      // Keyboard and label gaps that predate these rules, one file each, so
      // only a new one fails. Fix a file's sites, then delete it here.
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

  // Formatting configuration
  fmt: {
    // CHANGELOG.md files are auto-generated by changesets (`changeset version`).
    // Changesets emits a blank line between a header and its following list
    // (## @groot/core\n\n- item), but Oxfmt (Prettier-compatible) collapses it
    // (## @groot/core\n- item). Excluding them avoids a format-check failure on
    // every "chore: version packages" merge — the release workflow commits the
    // raw changeset output with VITE_GIT_HOOKS=0, so the pre-commit formatter
    // never gets a chance to normalize them.
    // `mobile/` is formatted by its own boilerplate's rules (see `lint` above).
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

  // Test configuration - client tests only
  // Server tests run from vitest.config.server.ts
  test: {
    // A new random order of files and tests every run; the seed is printed at
    // the top. Rerun one order with --sequence.seed=<seed>.
    sequence: { shuffle: true, sequencer: DurationSequencer },
    include: ["../../tests/client/**/*.test.{ts,tsx}"],
    exclude: ["src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    setupFiles: ["../../tests/client/setup.ts"],
    alias: aliases,
  },
});
