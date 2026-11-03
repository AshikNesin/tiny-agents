import { z } from "zod";
import { env } from "@groot/core/env";

/**
 * tiny-agents' own environment variables. Core's (DATABASE_URL, secrets,
 * passkeys, the gateway, Pushover, ...) are validated by `@groot/core/env`;
 * these are app-only and documented in `.env.example`. tiny-agents runs on
 * Node only, so they come straight from `process.env` (the Node entry loads
 * `.env` first). Toolkit settings that carry their own defaults (sandbox,
 * browser, vision) are read where they are used.
 */
const appEnvSchema = z.object({
  /** Directory production keeps SQLite state in (`/data` by default). Docker mounts a volume here. */
  DATA_DIR: z.string().optional(),
  /** pi-durable agent store: a plain path or a `file:` URL. Default: see `agentDbPath()`. */
  AGENT_DB_PATH: z.string().optional(),
  /** Model for memory capture side-calls (issue #22); unset = the bot's own model. */
  MEMORY_CAPTURE_MODEL: z.string().optional(),
  /** Model for past-chat titles (issue #101); unset = the titler's default. */
  CHAT_TITLE_MODEL: z.string().optional(),
  /** 1Password Connect (issue #56). Without a host the vault uses the local backend only. */
  OP_CONNECT_HOST: z.string().optional(),
  OP_CONNECT_VAULT_ID: z.string().optional(),
  OP_CONNECT_TOKEN: z.string().optional(),
  OP_CONNECT_ADMIN_TOKEN: z.string().optional(),
  /** "1" boots the faux agent runtime (no network, no keys): dev and e2e only. */
  TINY_AGENTS_FAUX: z.string().optional(),
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
