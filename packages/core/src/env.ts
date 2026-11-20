import { z } from "zod";
import { PRIVATE_NETWORKS, proxyEntryProblem } from "./utils/client-address";

export const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal", "silent"] as const;

export const DEV_DEFAULTS = {
  JWT_SECRET_KEY: "dev-only-jwt-secret-change-me-before-you-ship-0000",
  ADMIN_AUTH_KEY: "dev-only-admin-key",
} as const;

export function defaultDatabaseUrl(nodeEnv?: string): string {
  return nodeEnv === "production" ? "file:/data/prod.db" : "file:./data/dev.db";
}

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().optional(),
  UPLOADS_DIR: z.string().optional(),
  PORT: z.coerce.number().int().positive().default(3000),
  JWT_SECRET_KEY: z.string().min(32, "must be at least 32 characters").optional(),
  ADMIN_AUTH_KEY: z.string().min(1).optional(),
  RP_NAME: z.string().default("Groot"),
  RP_ID: z.string().default("localhost"),
  ORIGIN: z.url().default("http://localhost:3000"),
  CORS_ALLOWED_ORIGINS: z.string().default(""),
  TRUSTED_PROXIES: z
    .string()
    .optional()
    .transform((list): string[] => {
      if (list === undefined) return [...PRIVATE_NETWORKS];
      if (list.trim().toLowerCase() === "none") return [];
      return list
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
    })
    .superRefine((entries, ctx) => {
      for (const entry of entries) {
        const message = proxyEntryProblem(entry);
        if (message !== undefined) ctx.addIssue({ code: "custom", message });
      }
    }),
  LOG_LEVEL: z.enum(LOG_LEVELS).optional(),
  SENTRY_DSN: z.string().optional(),
  SENTRY_RELEASE: z.string().optional(),
  CLOUDFLARE_API_KEY: z.string().optional(),
  CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
  CLOUDFLARE_GATEWAY_ID: z.string().optional(),
  DEFAULT_MODEL: z.string().optional(),
  PUSHOVER_USER_KEY: z.string().optional(),
  PUSHOVER_API_TOKEN: z.string().optional(),
});

type ParsedEnv = z.infer<typeof envSchema>;

export type Env = Omit<ParsedEnv, "DATABASE_URL" | "JWT_SECRET_KEY" | "ADMIN_AUTH_KEY"> & {
  DATABASE_URL: string;
  JWT_SECRET_KEY: string;
  ADMIN_AUTH_KEY: string;
};

export type EnvSource = Record<string, string | undefined>;

export function parseEnv(source: EnvSource): Env {
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string" && value !== "") cleaned[key] = value;
  }

  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment variables:\n${issues.join("\n")}`);
  }

  const parsed = result.data;
  const isProduction = parsed.NODE_ENV === "production";
  const missing: string[] = [];

  const secret = (key: keyof typeof DEV_DEFAULTS): string => {
    const value = parsed[key];
    if (value) return value;
    if (isProduction) {
      missing.push(key);
      return "";
    }
    return DEV_DEFAULTS[key];
  };

  const env: Env = {
    ...parsed,
    DATABASE_URL: parsed.DATABASE_URL ?? defaultDatabaseUrl(parsed.NODE_ENV),
    JWT_SECRET_KEY: secret("JWT_SECRET_KEY"),
    ADMIN_AUTH_KEY: secret("ADMIN_AUTH_KEY"),
  };

  if (isProduction) {
    if (!cleaned.ORIGIN) missing.push("ORIGIN");
    if (!cleaned.RP_ID) missing.push("RP_ID");
    if (missing.length > 0) {
      throw new Error(
        `Missing required environment variables in production: ${missing.join(", ")}`,
      );
    }
  }

  return env;
}

export let env: Env = parseEnv({});

export function loadEnv(source: EnvSource): Env {
  env = parseEnv(source);
  return env;
}
