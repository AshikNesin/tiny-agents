/**
 * Claude Code worker. Loopback only. Claude Code owns the subscription login.
 * This process does not read, store, or refresh it, and it does not set
 * ANTHROPIC_BASE_URL.
 */
import { assertNoOverrides } from "./guards";
import { requireSubscriptionLogin } from "./auth";
import { createClaudeWorkerServer } from "./server";
import { createSdkQueryFactory, type ClaudeSdkModule } from "./sdk";
import { timingsFromEnv } from "./protocol";

const token = process.env.CLAUDE_WORKER_TOKEN?.trim() ?? "";
const port = Number(process.env.CLAUDE_WORKER_PORT ?? "8765");

async function loadSdk(): Promise<ClaudeSdkModule> {
  const load = new Function("specifier", "return import(specifier)") as (
    specifier: string,
  ) => Promise<ClaudeSdkModule>;
  try {
    const sdk = await load("@anthropic-ai/claude-agent-sdk");
    if (typeof sdk.query !== "function" || typeof sdk.tool !== "function") {
      throw new Error("SDK module is missing query() or tool().");
    }
    return sdk;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      "Install @anthropic-ai/claude-agent-sdk on this machine (the worker VM), then start again. " +
        detail,
    );
  }
}

async function main(): Promise<void> {
  assertNoOverrides(process.env);
  await requireSubscriptionLogin(process.env);
  const sdk = await loadSdk();
  const server = await createClaudeWorkerServer({
    token,
    query: createSdkQueryFactory(sdk, process.env),
    authStatus: async () => {
      const report = await requireSubscriptionLogin(process.env);
      return {
        loggedIn: report.loggedIn,
        authMethod: report.authMethod,
        subscriptionType: report.plan,
      };
    },
    env: process.env,
    timings: timingsFromEnv(process.env),
    port: Number.isFinite(port) && port > 0 ? port : 8765,
  });
  console.log(
    `claude-worker listening on ${server.url} (loopback only; publish with tailscale serve)`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
