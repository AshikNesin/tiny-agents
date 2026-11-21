import { z } from "zod";
import { env, envSchema } from "@groot/core/env";

const appEnvSchema = z.object({
  NODE_ENV: envSchema.shape.NODE_ENV,
  SECRETS_KEY: z.string().optional(),
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
  BROWSER_LOCALE: z.string().optional(),
  BROWSER_TIMEZONE: z.string().optional(),
  COMPUTER_DESKTOP_SIZE: z.string().optional(),
  COMPUTER_IDLE_MINUTES: z.string().optional(),
  COMPUTER_EXTRA_PACKAGES: z.string().optional(),
  TINYFISH_API_KEY: z.string().optional(),
  TZ: z.string().optional(),
  TINY_AGENTS_FAUX_TOKENS_PER_SECOND: z.string().optional(),
  DATA_DIR: z.string().optional(),
  AGENT_DB_PATH: z.string().optional(),
  OP_CONNECT_CREDENTIALS: z.string().optional(),
  OP_CONNECT_HOST: z.string().optional(),
  OP_CONNECT_VAULT_ID: z.string().optional(),
  OP_CONNECT_TOKEN: z.string().optional(),
  OP_CONNECT_ADMIN_TOKEN: z.string().optional(),
  SHELLEY_URL: z.string().optional(),
  TINY_AGENTS_FAUX: z.string().optional(),
  TINY_AGENTS_FIXED_NOW: z.string().optional(),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().optional(),
  ANDROID_APP_CERT_SHA256: z.string().optional(),
  ANDROID_APP_PACKAGE: z.string().optional(),
});

export type AppEnv = z.infer<typeof appEnvSchema>;

export function appEnv(source: Record<string, string | undefined> = process.env): AppEnv {
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, value]) => typeof value === "string" && value !== ""),
  );
  return appEnvSchema.parse(cleaned);
}

export function productionDataDir(
  source: Record<string, string | undefined> = process.env,
): string {
  const raw = appEnv(source).DATA_DIR?.trim();
  if (raw) return raw;
  return "/data";
}

export function agentDbPath(source: Record<string, string | undefined> = process.env): string {
  const raw = appEnv(source).AGENT_DB_PATH?.trim();
  if (raw) return raw.startsWith("file:") ? raw.slice(5) : raw;
  if (env.NODE_ENV === "production") return `${productionDataDir(source)}/agent.db`;
  if (env.NODE_ENV === "test") return "./tmp/agent-test.db";
  return "./data/agent.db";
}

export function fauxMode(): boolean {
  return appEnv().TINY_AGENTS_FAUX === "1";
}
