import { builtinModules } from "node:module";
import { OUT_OF_SCOPE } from "./comments.mjs";

type Scope = "**" | `${string}/**`;

type ImportRestriction = {
  patterns?: { group?: string[]; regex?: string; importNames?: string[]; message: string }[];
  paths?: { name: string; importNames?: string[]; message: string }[];
};

type BoundaryRule = {
  id: string;
  except?: string[];
  enabled: boolean;
} & (
  | { kind: "import"; scope: Scope; restrict: ImportRestriction }
  | {
      kind: "plugin";
      scope: string;
      rule: `repo/${string}`;
      options?: Record<string, string | readonly string[]>;
    }
);

const R2_ALLOWED = ["async_hooks", "buffer"];
const bareBuiltins = [
  ...new Set(builtinModules.filter((m) => !m.startsWith("node:")).map((m) => m.split("/")[0])),
].filter((m) => !R2_ALLOWED.includes(m));

const R2_MESSAGE =
  "R2: packages/core/src stays runtime-neutral (AGENTS.md). Use Web APIs (crypto.subtle, fetch, TextEncoder), or move Node-only code to packages/core/src/database/node.ts, packages/core/src/storage/node.ts or apps/web/src/server/entry.node.ts.";

const DRIZZLE_DRIVERS = [
  "better-sqlite3",
  "bun-sqlite",
  "d1",
  "durable-sqlite",
  "libsql",
  "node-sqlite",
  "sqlite-proxy",
].join("|");

const JS_EXTENSION = "(\\.[cm]?[jt]sx?)?";
const DRIVER_SPECIFIER = `^(better-sqlite3|node:sqlite|@libsql/.*|drizzle-orm/(${DRIZZLE_DRIVERS}))(/|$)`;
const DRIVER_MESSAGE =
  "R8a: open no second database driver. Import `db` from apps/web/src/server/db in the app, or from @groot/core/database in a package; bootstrap() sets it.";
const DRIVER_HOMES = [
  "packages/core/src/database/node.ts",
  "packages/core/src/database/d1.ts",
  "apps/web/src/server/db/**",
  "apps/web/src/server/entry.worker.ts",
  "tests/**",
  "scripts/demo/launch/tools/**",
  "packages/agent/src/lock.ts",
];

const SERVER = "apps/web/src/server";
const R12_ALLOWED = [
  "crypto/secret-box.ts:derived",
  "api/vault/vault.service.ts:statusCache",
  "api/vault/vault.service.ts:appValues",
  "api/vault/vault.admin.service.ts:adminBackends",
  "api/vault/vault.admin.service.ts:candidatesCache",
  "api/vault/backends/index.ts:backends",
  "api/uploads/uploads.extraction.ts:cache",
  "api/uploads/uploads.prepare.ts:processor",
  "api/bots/sandbox-host.ts:keyFiles",
  "api/ws/upgrade.ts:upgradePatterns",
  "db/index.ts:connections",
  "api/uploads/uploads.extraction.ts:runner",
  "api/uploads/uploads.extraction.ts:jobs",
  "api/uploads/uploads.extraction.ts:cancelled",
  "api/uploads/uploads.extraction.ts:active",
  "api/uploads/uploads.extraction.ts:idle",
  "api/uploads/uploads.extraction.ts:markIdle",
  "entry.node.ts:captureException",
  "api/bots/rfb-view-only.ts:FORWARD",
  "api/bots/memories.store.ts:GENERIC_WORDS",
  "api/uploads/uploads.sniff.ts:TEXT_EXTENSIONS",
  "api/uploads/uploads.service.ts:ALLOWED_EXTENSIONS",
  "api/routines/routines.runs.ts:CREDENTIAL_TOOLS",
].map((entry) => `${SERVER}/${entry}`);

const BOUNDARY_RULES: BoundaryRule[] = [
  {
    id: "R1",
    kind: "import",
    scope: "packages/**",
    enabled: true,
    restrict: {
      patterns: [
        {
          regex: "(^|/)apps/|^@/|^@groot/web(/|$)",
          message:
            "R1: packages never import from apps/ (AGENTS.md). Move the code into a package, or have the app pass it in.",
        },
      ],
    },
  },
  {
    id: "R2",
    kind: "import",
    scope: "packages/core/src/**",
    except: ["packages/core/src/database/node.ts", "packages/core/src/storage/node.ts"],
    enabled: true,
    restrict: {
      patterns: [
        {
          group: ["node:*", "node:*/**", ...R2_ALLOWED.map((m) => `!node:${m}`)],
          message: R2_MESSAGE,
        },
        { regex: `^(${bareBuiltins.join("|")})(/|$)`, message: R2_MESSAGE },
      ],
    },
  },
  {
    id: "R3",
    kind: "plugin",
    scope: "**",
    rule: "repo/no-raw-env",
    except: [
      "packages/core/src/env.ts",
      "apps/web/src/server/env.ts",
      "scripts/**",
      "tests/**",
      ".agents/**",
      ".claude/**",
      ".groot/**",
      "**/*.config.ts",
      "**/*.config.*.ts",
      "apps/web/src/server/entry.node.ts",
      "apps/web/src/server/db/open.ts",
      "packages/claude-worker/src/bin.ts",
      "packages/claude-worker/src/coding-ops.ts",
    ],
    enabled: true,
  },
  {
    id: "R4",
    kind: "import",
    scope: "**",
    enabled: true,
    restrict: {
      paths: ["@groot/shell/lib/utils", "@groot/shell/lib/utils.ts"].map((name) => ({
        name,
        importNames: ["cn"],
        message:
          "R4: import cn from @groot/ui/lib/utils, its one source. `pnpm exec tsx scripts/codemods/cn-import-path.ts` rewrites every old import.",
      })),
    },
  },
  {
    id: "R5a",
    kind: "import",
    scope: "**",
    except: ["packages/ui/**"],
    enabled: true,
    restrict: {
      patterns: [
        {
          regex:
            "^@groot/ui(/(breadcrumb|index)(\\.tsx?)?)?$|(^|/)ui/src(/(breadcrumb|index)(\\.tsx?)?)?$",
          importNames: ["BreadcrumbItem", "BreadcrumbSeparator"],
          message:
            'R5a: render breadcrumbs with <Breadcrumbs page="Current">{links}</Breadcrumbs> from @groot/ui/breadcrumb, which places the list items and separators.',
        },
      ],
    },
  },
  {
    id: "R5b",
    kind: "plugin",
    scope: "**/*.tsx",
    rule: "repo/no-nested-breadcrumb-separator",
    enabled: true,
  },
  {
    id: "R5c",
    kind: "plugin",
    scope: "**/*.tsx",
    rule: "repo/breadcrumbs-children",
    enabled: true,
  },
  {
    id: "R6",
    kind: "plugin",
    scope: "packages/agent/src/**",
    rule: "repo/no-double-cast",
    except: ["**/*.test.ts", "packages/agent/src/testing*.ts"],
    enabled: true,
  },
  {
    id: "R6b",
    kind: "plugin",
    scope: "packages/agent/src/**",
    rule: "repo/no-never-cast",
    except: ["**/*.test.ts", "packages/agent/src/testing*.ts"],
    enabled: true,
  },
  {
    id: "R7",
    kind: "plugin",
    scope: "packages/*/src/**",
    rule: "repo/no-package-transaction",
    enabled: true,
  },
  {
    id: "R8a",
    kind: "import",
    scope: "**",
    except: DRIVER_HOMES,
    enabled: true,
    restrict: { patterns: [{ regex: DRIVER_SPECIFIER, message: DRIVER_MESSAGE }] },
  },
  {
    id: "R8a",
    kind: "plugin",
    scope: "**",
    rule: "repo/no-restricted-require",
    options: { regex: DRIVER_SPECIFIER, message: DRIVER_MESSAGE },
    except: DRIVER_HOMES,
    enabled: true,
  },
  {
    id: "R8b",
    kind: "import",
    scope: "**",
    except: ["packages/core/src/bootstrap.ts", "apps/web/src/server/db/index.ts"],
    enabled: true,
    restrict: {
      patterns: [
        {
          regex: `(^|/)database${JS_EXTENSION}(/index${JS_EXTENSION})?$`,
          importNames: ["setDb"],
          message:
            "R8b: only bootstrap() calls setDb. Import `db` from apps/web/src/server/db in the app, or from @groot/core/database in a package.",
        },
      ],
    },
  },
  {
    id: "R11",
    kind: "import",
    scope: "packages/models/**",
    enabled: true,
    restrict: {
      patterns: [
        {
          regex: "^@earendil-works/pi-durable(/|$)|^@tiny-agents/agent(/|$)|(^|/)agent/src(/|$)",
          message:
            "R11: @tiny-agents/models imports neither pi-durable nor @tiny-agents/agent (docs/rewrite/DECISIONS.md D7). Move the pi-durable-free code it needs into packages/models, or have the caller pass it in.",
        },
      ],
    },
  },
  {
    id: "R11",
    kind: "import",
    scope: "packages/github/**",
    enabled: true,
    restrict: {
      patterns: [
        {
          regex:
            "^@earendil-works/pi-durable(/|$)|^@tiny-agents/(agent|sandbox)(/|$)|(^|/)(agent|sandbox)/src(/|$)",
          message:
            "R11: @tiny-agents/github imports neither pi-durable, @tiny-agents/agent nor @tiny-agents/sandbox (issue #297, ADR 0022). Take an exec port from the caller instead.",
        },
      ],
    },
  },
  {
    id: "R11",
    kind: "import",
    scope: "packages/sandbox/**",
    enabled: true,
    restrict: {
      patterns: [
        {
          regex: "^@earendil-works/pi-durable(/|$)|^@tiny-agents/agent(/|$)|(^|/)agent/src(/|$)",
          message:
            "R11: @tiny-agents/sandbox imports neither pi-durable nor @tiny-agents/agent (docs/rewrite/DECISIONS.md D7). Move the pi-durable-free code it needs into packages/sandbox, or have the caller pass it in.",
        },
      ],
    },
  },
  ...[
    "apps/web/src/client/**",
    "packages/shell/src/**",
    "packages/jobs/src/client/**",
    "packages/ui/src/**",
  ].map((scope): BoundaryRule => ({
    id: "R10",
    kind: "plugin",
    scope,
    rule: "repo/no-em-dash-copy",
    enabled: true,
  })),
  {
    id: "R15",
    kind: "plugin",
    scope: "apps/web/src/client/**",
    rule: "repo/no-load-in-effect",
    except: [
      "apps/web/src/client/components/ChatHistoryMenu.tsx",
      "apps/web/src/client/components/ClaudePlanStatus.tsx",
      "apps/web/src/client/components/FilePreview.tsx",
      "apps/web/src/client/components/PeopleSettings.tsx",
      "apps/web/src/client/components/PhoneNotificationSettings.tsx",
      "apps/web/src/client/components/bot-dialog/use-bot-dialog-lists.ts",
      "apps/web/src/client/components/browser/VncView.tsx",
      "apps/web/src/client/components/chat-pane/live-views.tsx",
      "apps/web/src/client/lib/use-tool-labels.ts",
      "apps/web/src/client/pages/terminal/Terminal.tsx",
      "apps/web/src/client/store/use-updates.ts",
      "apps/web/src/client/lib/code/use-live-changes.ts",
      "apps/web/src/client/lib/code/use-thread.ts",
    ],
    enabled: true,
  },
  {
    id: "R9",
    kind: "plugin",
    scope: "**",
    rule: "repo/no-session-invalid",
    except: [
      "packages/core/src/session/index.ts",
      "packages/core/src/errors/index.ts",
      "packages/shell/src/lib/api.ts",
      "scripts/lint/repo-plugin.mjs",
      "tests/**",
    ],
    enabled: true,
  },
  {
    id: "R14",
    kind: "import",
    scope: "packages/git/**",
    enabled: true,
    restrict: {
      patterns: [
        {
          regex: "^[^.]",
          message:
            "R14: @tiny-agents/git imports nothing outside itself (ADR 0025). It serves every harness and is bundled into the Claude worker on the sandbox; take what it needs through its port.",
        },
      ],
    },
  },
  {
    id: "R14",
    kind: "import",
    scope: "apps/web/src/server/api/code/**",
    except: ["apps/web/src/server/api/code/code.registry.ts"],
    enabled: true,
    restrict: {
      patterns: [
        {
          regex: "^@tiny-agents/claude-worker(/|$)|(^|/)bots/claude-worker$",
          message:
            "R14: the app's Code layer serves every harness (ADR 0011, ADR 0025). Only code.registry.ts names the Claude worker; shared git and diff logic goes in @tiny-agents/git, harness-specific behaviour behind the HarnessInstance contract.",
        },
      ],
    },
  },
  {
    id: "R16",
    kind: "plugin",
    scope: "**",
    rule: "repo/no-comments",
    except: OUT_OF_SCOPE,
    enabled: true,
  },
  {
    id: "R13",
    kind: "plugin",
    scope: "apps/web/src/client/lib/*-api.ts",
    rule: "repo/no-api-type-exports",
    enabled: true,
  },
  {
    id: "R12",
    kind: "plugin",
    scope: `${SERVER}/**/*.ts`,
    rule: "repo/no-module-state",
    options: { allow: R12_ALLOWED },
    except: ["**/*.test.ts"],
    enabled: true,
  },
];

export const enforcedRuleIds = new Set(BOUNDARY_RULES.filter((r) => r.enabled).map((r) => r.id));

const covers = (glob: string, zone: string) =>
  glob === "**" || glob === zone || (glob.endsWith("/**") && zone.startsWith(glob.slice(0, -2)));

const depth = (zone: string) => (zone === "**" ? 0 : zone.replace(/\/\*\*$/, "").split("/").length);

type Override = {
  files: string[];
  excludeFiles?: string[];
  jsPlugins?: string[];
  rules: Record<string, unknown>;
};

export function boundaryOverrides(pluginPath: string): Override[] {
  const enabled = BOUNDARY_RULES.filter((r) => r.enabled);
  const importRules = enabled.filter((r) => r.kind === "import");
  const zones = [...new Set(importRules.flatMap((r) => [r.scope, ...(r.except ?? [])]))];
  for (const zone of zones) {
    if (zone.replace(/^\*\*$|\/\*\*$/, "").includes("*")) {
      throw new Error(`Import boundary zone "${zone}" must be "**", "<dir>/**" or a file path.`);
    }
  }

  const importOverrides = zones
    .toSorted((a, b) => depth(a) - depth(b))
    .map((zone): Override => {
      const applying = importRules.filter(
        (r) => covers(r.scope, zone) && !r.except?.some((e) => covers(e, zone)),
      );
      const patterns = applying.flatMap((r) => r.restrict.patterns ?? []);
      const paths = applying.flatMap((r) => r.restrict.paths ?? []);
      return {
        files: [zone],
        rules: {
          "no-restricted-imports": applying.length
            ? ["error", { ...(patterns.length && { patterns }), ...(paths.length && { paths }) }]
            : "off",
        },
      };
    });

  const pluginOverrides = enabled
    .filter((r) => r.kind === "plugin")
    .map((r): Override => ({
      files: [r.scope],
      ...(r.except && { excludeFiles: r.except }),
      jsPlugins: [pluginPath],
      rules: { [r.rule]: r.options ? ["error", r.options] : "error" },
    }));

  return [...importOverrides, ...pluginOverrides];
}
