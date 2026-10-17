import "varlock/auto-load";
import { ENV } from "varlock/env";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { PrismaClient } from "../../generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { dbEngine, isPostgres } from "./engine";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const isDev = ENV.NODE_ENV === "development";

/**
 * Fail fast when the generated client's datasource provider does not match
 * the DATABASE_URL scheme. The generated client embeds its provider at
 * `pnpm prisma generate` time, so a sqlite client pointed at a postgres URL
 * (or the reverse) compiles and typechecks fine and only fails later, deep in
 * the first query — or worse, silently writes to the wrong engine. Boot is the
 * last place this can still be caught cheaply, so the error names both sides.
 *
 * The provider comes off the constructed instance's `_activeProvider`, which
 * the client assigns from its baked config before any connection work. That
 * reads the same value in dev and inside the production bundle, where a
 * filesystem path into the generated sources would not exist.
 */
function assertProviderMatchesUrl(provider: string, dbUrl: string): void {
  const urlProvider = dbUrl.trim().startsWith("postgres") ? "postgres" : "sqlite";
  // Prisma reports the postgres datasource as "postgresql"; the URL scheme
  // reads "postgres". Either spelling means the same engine.
  const clientProvider = provider === "postgresql" ? "postgres" : provider;
  if (clientProvider !== urlProvider) {
    throw new Error(
      `Prisma client provider mismatch: the generated client targets ${provider} but DATABASE_URL (${dbUrl}) selects ${urlProvider}. ` +
        `Regenerate the client for this engine with DATABASE_URL set to a ${urlProvider} URL, then run 'pnpm prisma generate'.`,
    );
  }
}

/**
 * Resolve the SQLite database file path from a `file:` URL or bare path.
 *
 * Accepts `:memory:`, an optional `file:` prefix, a relative path (resolved
 * against `process.cwd()`), or an absolute path. The parent directory is
 * created on demand so a fresh checkout just works. Only used when
 * DATABASE_URL with a file: scheme.
 */
export function resolveSqlitePath(url: string): string {
  if (url === ":memory:") return ":memory:";
  const stripped = url.replace(/^file:/, "");
  const abs = isAbsolute(stripped) ? stripped : resolve(process.cwd(), stripped);
  if (abs !== ":memory:") {
    mkdirSync(dirname(abs), { recursive: true });
  }
  return abs;
}

function createPrismaClient(): PrismaClient {
  const dbUrl = ENV.DATABASE_URL;
  if (!dbUrl) {
    throw new Error(
      "DATABASE_URL is not set. " +
        (isPostgres
          ? "PostgreSQL needs a connection URL (e.g. postgresql://user:pass@host:port/db)."
          : "SQLite needs a file path (e.g. file:./data/dev.db) or ':memory:'."),
    );
  }

  // The driver adapter is the only engine-specific piece. Both engines share
  // the same generated PrismaClient type (schemas use identical Json-typed
  // columns), so the rest of the app never branches on the engine. Both
  // adapter packages are always installed (dual-engine support); importing
  // them statically keeps the client construction synchronous.
  const adapter = isPostgres
    ? new PrismaPg(
        new pg.Pool({
          connectionString: dbUrl,
          max: isDev ? 5 : 10,
          idleTimeoutMillis: 30_000,
          connectionTimeoutMillis: 5_000,
        }),
      )
    : new PrismaBetterSqlite3({ url: resolveSqlitePath(dbUrl) });

  // The provider lives in the generated client's baked config. Prisma runs
  // the documented __internal.configOverride hook before its own adapter
  // validation, so asserting inside the hook both reads the provider in every
  // runtime space (dev source and production bundle alike, where no path into
  // the generated sources exists) and makes the boot error ours — naming both
  // providers — instead of Prisma's adapter incompatibility text. The
  // generated options type narrows __internal to never; the runtime accepts
  // the documented shape, so this one construction carries a precise cast.
  const providerAssertingOptions = {
    adapter,
    __internal: {
      configOverride: (config: { activeProvider?: string }) => {
        assertProviderMatchesUrl(config.activeProvider ?? "unknown", dbUrl);
        return config;
      },
    },
    // Only emit query events in development where the DB logger subscribes to them.
    // In production only capture errors/warnings to minimise overhead.
    log: isDev
      ? [
          { level: "query", emit: "event" },
          { level: "error", emit: "event" },
          { level: "warn", emit: "event" },
        ]
      : [
          { level: "error", emit: "event" },
          { level: "warn", emit: "event" },
        ],
  } as unknown as ConstructorParameters<typeof PrismaClient>[0];

  return new PrismaClient(providerAssertingOptions);
}

export const prisma = globalForPrisma.prisma || createPrismaClient();

if (ENV.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

process.on("beforeExit", async () => {
  await prisma.$disconnect();
});

export { dbEngine };
