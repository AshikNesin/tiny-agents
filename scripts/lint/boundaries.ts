import { builtinModules } from "node:module";

/**
 * The repo's dependency boundaries as one table. `boundaryOverrides()` turns
 * it into the oxlint overrides that the `lint` block of vite.config.ts uses.
 *
 * Oxlint does not merge two overrides that set the same rule on one file: the
 * later override replaces the earlier. So the generator gives every file
 * exactly one `no-restricted-imports` entry, holding every import row that
 * applies to it.
 */

/** `**` for the whole repo, or `<dir>/**` for one directory. */
type Scope = "**" | `${string}/**`;

type ImportRestriction = {
  patterns?: { group?: string[]; regex?: string; message: string }[];
  paths?: { name: string; importNames?: string[]; message: string }[];
};

type BoundaryRule = {
  id: string;
  /** Files inside the scope that the rule skips; an import rule takes paths or `<dir>/**`. */
  except?: string[];
  enabled: boolean;
} & (
  | { kind: "import"; scope: Scope; restrict: ImportRestriction }
  | { kind: "plugin"; scope: string; rule: `repo/${string}` }
);

const R2_ALLOWED = ["async_hooks", "buffer"];
const bareBuiltins = [
  ...new Set(builtinModules.filter((m) => !m.startsWith("node:")).map((m) => m.split("/")[0])),
].filter((m) => !R2_ALLOWED.includes(m));

const R2_MESSAGE =
  "R2: packages/core/src stays runtime-neutral (AGENTS.md). Use Web APIs (crypto.subtle, fetch, TextEncoder), or move Node-only code to packages/core/src/database/node.ts, packages/core/src/storage/node.ts or apps/web/src/server/entry.node.ts.";

export const BOUNDARY_RULES: BoundaryRule[] = [
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
        { group: ["node:*", ...R2_ALLOWED.map((m) => `!node:${m}`)], message: R2_MESSAGE },
        { regex: `^(${bareBuiltins.join("|")})(/|$)`, message: R2_MESSAGE },
      ],
    },
  },
  {
    id: "R3",
    kind: "plugin",
    scope: "**",
    rule: "repo/no-raw-env",
    enabled: false,
  },
  {
    id: "R4",
    kind: "import",
    scope: "**",
    enabled: true,
    restrict: {
      paths: [
        {
          name: "@groot/shell/lib/utils",
          importNames: ["cn"],
          message:
            "R4: import cn from @groot/ui/lib/utils, its one source. `pnpm exec tsx scripts/codemods/cn-import-path.ts` rewrites every old import.",
        },
      ],
    },
  },
  {
    id: "R5a",
    kind: "import",
    scope: "**",
    except: ["packages/ui/**"],
    enabled: false,
    restrict: {
      paths: [
        {
          name: "@groot/ui/breadcrumb",
          importNames: ["BreadcrumbSeparator"],
          message:
            "R5a: render breadcrumbs with <Breadcrumbs items={[...]} /> from @groot/ui/breadcrumb, which places the separators.",
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
];

/** True when `glob` (`**`, `<dir>/**` or a file path) covers every file in `zone`. */
const covers = (glob: string, zone: string) =>
  glob === "**" || glob === zone || (glob.endsWith("/**") && zone.startsWith(glob.slice(0, -2)));

const depth = (zone: string) => (zone === "**" ? 0 : zone.replace(/\/\*\*$/, "").split("/").length);

type Override = {
  files: string[];
  excludeFiles?: string[];
  jsPlugins?: string[];
  rules: Record<string, unknown>;
};

/**
 * Oxlint overrides for `rules`. Each import scope and each exception is a
 * zone. A zone's override holds the import rows that apply there, and zones
 * run general to specific, so the deepest zone matching a file wins.
 * `pluginPath` is where oxlint loads scripts/lint/repo-plugin.mjs from.
 */
export function boundaryOverrides(
  pluginPath: string,
  rules: BoundaryRule[] = BOUNDARY_RULES,
): Override[] {
  const enabled = rules.filter((r) => r.enabled);
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
      rules: { [r.rule]: "error" },
    }));

  return [...importOverrides, ...pluginOverrides];
}
