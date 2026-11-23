import { envFlagEnabled } from "./env";

export const FORBIDDEN_OVERRIDE_KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_FOUNDRY_API_KEY",
] as const;

const WORKER_ONLY_ENV_KEYS = ["CLAUDE_WORKER_TOKEN", "CLAUDE_WORKER_PORT"] as const;

export const FORBIDDEN_BACKEND_FLAGS = [
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
] as const;

export class OverrideRefusal extends Error {
  readonly keys: readonly string[];

  constructor(keys: readonly string[]) {
    super(
      `Claude Code worker refuses auth or backend overrides: ${keys.join(", ")}. ` +
        "Unset them. The worker does not relay Anthropic requests and does not read Claude credentials.",
    );
    this.name = "OverrideRefusal";
    this.keys = keys;
  }
}

export function conflictingOverrides(env: Readonly<Record<string, string | undefined>>): string[] {
  const conflicts: string[] = [];
  for (const key of FORBIDDEN_OVERRIDE_KEYS) {
    if (env[key]?.trim()) conflicts.push(key);
  }
  for (const key of FORBIDDEN_BACKEND_FLAGS) {
    if (envFlagEnabled(env[key])) conflicts.push(key);
  }
  return conflicts;
}

export function assertNoOverrides(env: Readonly<Record<string, string | undefined>>): void {
  const conflicts = conflictingOverrides(env);
  if (conflicts.length > 0) throw new OverrideRefusal(conflicts);
}

export function workerProcessEnv(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  assertNoOverrides(env);
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if ((FORBIDDEN_OVERRIDE_KEYS as readonly string[]).includes(key)) continue;
    if ((WORKER_ONLY_ENV_KEYS as readonly string[]).includes(key)) continue;
    output[key] = value;
  }
  delete output.ANTHROPIC_BASE_URL;
  delete output.ANTHROPIC_API_KEY;
  delete output.ANTHROPIC_AUTH_TOKEN;
  output.CLAUDE_CODE_MAX_RETRIES = "0";
  output.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
  output.DISABLE_TELEMETRY = "1";
  output.DISABLE_ERROR_REPORTING = "1";
  return output;
}
