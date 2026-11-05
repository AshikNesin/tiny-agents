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
import { codingLimitsFromEnv } from "./coding-protocol";
import type { CodingSdk } from "./coding-sdk";

const token = process.env.CLAUDE_WORKER_TOKEN?.trim() ?? "";
const port = Number(process.env.CLAUDE_WORKER_PORT ?? "8765");

type LoadedSdk = ClaudeSdkModule & Partial<Pick<CodingSdk, "getSessionMessages" | "forkSession">>;

async function loadSdk(): Promise<LoadedSdk> {
  try {
    // Optional: installed on the worker VM, not in CI. A missing package throws here.
    const sdk = await import("@anthropic-ai/claude-agent-sdk");
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
  // Listen even before Claude Code is signed in: the app sets the worker up
  // ahead of the login, and every session re-checks it before it starts.
  await requireSubscriptionLogin(process.env).catch((error: unknown) => {
    console.warn(error instanceof Error ? error.message : error);
  });
  const sdk = await loadSdk();
  const { getSessionMessages, forkSession } = sdk;
  // Coding mode (the Code page) also needs the session helpers.
  const coding: CodingSdk | undefined =
    typeof getSessionMessages === "function" && typeof forkSession === "function"
      ? {
          // The same `query()`, called with Claude Code's own tools and streaming input.
          query: sdk.query as unknown as CodingSdk["query"],
          getSessionMessages,
          forkSession,
        }
      : undefined;
  if (!coding) console.warn("This Agent SDK has no getSessionMessages/forkSession: coding is off.");
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
    ...(coding ? { coding: { sdk: coding, limits: codingLimitsFromEnv(process.env) } } : {}),
  });
  console.log(`claude-worker listening on ${server.url} (loopback only)`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
