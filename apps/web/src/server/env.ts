import { z } from "zod";
import { env, envSchema } from "@groot/core/env";

/**
 * tiny-agents' own environment variables. Core's (DATABASE_URL, secrets,
 * passkeys, the gateway, Pushover, ...) are validated by `@groot/core/env`;
 * these are app-only and documented in `.env.example`. tiny-agents runs on
 * Node only, so they come straight from `process.env` (the Node entry loads
 * `.env` first). Models are not configured here: they are owner data in the
 * database (issue #179, Settings → Models).
 */
const appEnvSchema = z.object({
  /** Core's validator, so `sandboxHost()` can read the production default from one env. */
  NODE_ENV: envSchema.shape.NODE_ENV,
  SECRETS_KEY: z.string().optional(),
  /** Opens secrets written under the old key while `pnpm secrets:rotate` rewrites them. */
  SECRETS_KEY_PREVIOUS: z.string().optional(),
  SANDBOX_HOST: z.string().optional(),
  SANDBOX_PORT: z.string().optional(),
  SANDBOX_USER: z.string().optional(),
  SANDBOX_SSH_KEY: z.string().optional(),
  SANDBOX_SSH_KEY_FILE: z.string().optional(),
  SANDBOX_EGRESS_ALLOWLIST: z.string().optional(),
  BROWSER_EXECUTABLE_PATH: z.string().optional(),
  BROWSER_PROFILES_DIR: z.string().optional(),
  BROWSER_IDLE_MINUTES: z.string().optional(),
  BROWSER_SCALE: z.string().optional(),
  BROWSER_ALLOWED_PRIVATE_HOSTS: z.string().optional(),
  COMPUTER_DESKTOP_SIZE: z.string().optional(),
  COMPUTER_IDLE_MINUTES: z.string().optional(),
  COMPUTER_EXTRA_PACKAGES: z.string().optional(),
  TINYFISH_API_KEY: z.string().optional(),
  TZ: z.string().optional(),
  TINY_AGENTS_FAUX_TOKENS_PER_SECOND: z.string().optional(),
  /** Set by Vitest, which cannot load the .ts upload-extraction worker. */
  VITEST: z.string().optional(),
  /** Directory production keeps SQLite state in (`/data` by default). Docker mounts a volume here. */
  DATA_DIR: z.string().optional(),
  /** pi-durable agent store: a plain path or a `file:` URL. Default: see `agentDbPath()`. */
  AGENT_DB_PATH: z.string().optional(),
  /**
   * Shelley coding agent the Code page drives (e.g. `http://my-vm:9999` over
   * Tailscale). Unset = the Code page says it is not configured.
   */
  SHELLEY_URL: z.string().optional(),
  /** "1" boots the faux agent runtime (no network, no keys): dev and e2e only. */
  TINY_AGENTS_FAUX: z.string().optional(),
  /**
   * Sign-in attempts per IP per 15 minutes (default 20, `rateLimits.auth`).
   * Throwaway test servers raise it: e2e and verify runs sign in once per test.
   */
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().optional(),
});

export type AppEnv = z.infer<typeof appEnvSchema>;

/** The app's variables, empty strings treated as unset. Cheap; call where needed. */
export function appEnv(source: Record<string, string | undefined> = process.env): AppEnv {
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, value]) => typeof value === "string" && value !== ""),
  );
  return appEnvSchema.parse(cleaned);
}

/** The directory production keeps SQLite state in: `DATA_DIR`, or `/data`. */
export function productionDataDir(
  source: Record<string, string | undefined> = process.env,
): string {
  const raw = appEnv(source).DATA_DIR?.trim();
  if (raw) return raw;
  return "/data";
}

/**
 * The pi-durable agent store path. A plain path (not a `file:` URL): the store
 * owns the file and puts a `.lock` beside it. Production keeps it on the data
 * volume (see `productionDataDir()`) next to the app database.
 */
export function agentDbPath(source: Record<string, string | undefined> = process.env): string {
  const raw = appEnv(source).AGENT_DB_PATH?.trim();
  if (raw) return raw.startsWith("file:") ? raw.slice(5) : raw;
  if (env.NODE_ENV === "production") return `${productionDataDir(source)}/agent.db`;
  if (env.NODE_ENV === "test") return "./tmp/agent-test.db";
  return "./data/agent.db";
}

/** True when the faux agent runtime is requested (dev / e2e escape hatch). */
export function fauxMode(): boolean {
  return appEnv().TINY_AGENTS_FAUX === "1";
}
