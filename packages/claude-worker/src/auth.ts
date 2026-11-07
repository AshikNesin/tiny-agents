/**
 * `claude auth status` must show a subscription login. This runs the CLI and
 * reads only loggedIn / authMethod / subscriptionType. It does not open the
 * Keychain, the credentials file, or a token.
 */
import { spawn } from "node:child_process";
import { assertNoOverrides } from "./guards";

export const INSTALL_HINT =
  "Claude Code is not installed. Install it with `npm install -g @anthropic-ai/claude-code` " +
  "or set CLAUDE_CODE_COMMAND to the executable.";

export const LOGIN_HINT =
  "Claude Code is not signed in to a Claude subscription. Open Settings → Models → Claude plan and " +
  "choose Sign in (it runs `claude auth login` in a terminal tab), or run `claude auth login` " +
  "on the worker machine. tiny-agents never handles the login itself.";

export interface ClaudeAuthStatus {
  loggedIn: boolean;
  authMethod?: string;
  subscriptionType?: string;
}

export interface ClaudeStatusReport {
  available: boolean;
  loggedIn: boolean;
  subscription: boolean;
  authMethod?: string;
  plan?: string;
  detail?: string;
}

export class SubscriptionRequired extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "SubscriptionRequired";
  }
}

/** A subscription login: logged in, a plan name, and not an API-key method. */
export function isSubscriptionLogin(status: ClaudeAuthStatus): boolean {
  if (status.loggedIn !== true) return false;
  const plan = status.subscriptionType?.trim();
  if (!plan) return false;
  const method = status.authMethod?.trim().toLowerCase();
  if (method === "api_key" || method === "console" || method === "anthropic_api_key") return false;
  return true;
}

export function assertSubscriptionLogin(status: ClaudeAuthStatus): void {
  if (!isSubscriptionLogin(status)) {
    throw new SubscriptionRequired(LOGIN_HINT);
  }
}

/**
 * The checks before Claude Code starts for a session, under either protocol:
 * no backend override in `env`, and a subscription login.
 */
export async function assertSessionMayStart(
  env: Record<string, string | undefined>,
  authStatus: () => Promise<ClaudeAuthStatus>,
): Promise<void> {
  assertNoOverrides(env);
  assertSubscriptionLogin(await authStatus());
}

export type CommandRunner = (
  command: string,
  args: string[],
  env: Record<string, string | undefined>,
) => Promise<{ code: number; stdout: string; stderr: string }>;

export function parseAuthStatus(stdout: string): ClaudeAuthStatus {
  const trimmed = stdout.trim();
  if (!trimmed.startsWith("{")) return { loggedIn: false };
  try {
    const payload = JSON.parse(trimmed) as {
      loggedIn?: unknown;
      authMethod?: unknown;
      subscriptionType?: unknown;
    };
    return {
      loggedIn: payload.loggedIn === true,
      authMethod: typeof payload.authMethod === "string" ? payload.authMethod : undefined,
      subscriptionType:
        typeof payload.subscriptionType === "string" ? payload.subscriptionType : undefined,
    };
  } catch {
    return { loggedIn: false };
  }
}

const defaultRunner: CommandRunner = (command, args, env) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: Object.fromEntries(
        Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
      ),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout = (stdout + chunk).slice(-65_536);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-8_192);
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });

/** Run `claude auth status`. Missing binary is "not available", not a thrown error. */
export async function readClaudeAuth(
  env: Record<string, string | undefined>,
  run: CommandRunner = defaultRunner,
): Promise<ClaudeStatusReport> {
  const command = env.CLAUDE_CODE_COMMAND?.trim() || "claude";
  try {
    const result = await run(command, ["auth", "status"], env);
    if (result.code !== 0 && !result.stdout.trim().startsWith("{")) {
      return { available: true, loggedIn: false, subscription: false, detail: LOGIN_HINT };
    }
    const status = parseAuthStatus(result.stdout);
    const subscription = isSubscriptionLogin(status);
    return {
      available: true,
      loggedIn: status.loggedIn,
      subscription,
      authMethod: status.authMethod,
      plan: status.subscriptionType,
      detail: subscription ? undefined : LOGIN_HINT,
    };
  } catch (error) {
    const missing =
      error instanceof Error && "code" in error && (error as { code?: string }).code === "ENOENT";
    if (missing)
      return { available: false, loggedIn: false, subscription: false, detail: INSTALL_HINT };
    return { available: true, loggedIn: false, subscription: false, detail: LOGIN_HINT };
  }
}

export async function requireSubscriptionLogin(
  env: Record<string, string | undefined>,
  run?: CommandRunner,
): Promise<ClaudeStatusReport> {
  const report = await readClaudeAuth(env, run);
  if (!report.available) throw new SubscriptionRequired(report.detail ?? INSTALL_HINT);
  if (!report.subscription) throw new SubscriptionRequired(report.detail ?? LOGIN_HINT);
  return report;
}
