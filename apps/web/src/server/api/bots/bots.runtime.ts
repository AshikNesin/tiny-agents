/**
 * The server's AgentRuntime singleton and its lifecycle.
 *
 * `apps/web/src/server/index.ts` opens the runtime at boot (before the HTTP
 * server accepts requests) and closes it in the graceful-shutdown hook. Route
 * modules read the instance through `getAgentRuntime()`; tests substitute a
 * fake via `setAgentRuntimeForTests()` instead of touching pi-durable.
 */
import { AgentRuntime } from "@tiny-agents/agent";
import type { Context as PiContext } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxText, TEST_MODEL } from "@tiny-agents/agent/testing";

let runtime: AgentRuntime | undefined;
let ready = false;

/** The open runtime. Throws when called before boot finished (or in tests without a fake). */
export function getAgentRuntime(): AgentRuntime {
  if (!runtime) {
    throw new Error("AgentRuntime is not open (server boot incomplete or test fake missing)");
  }
  return runtime;
}

/** True once boot finished and `close()` has not run since. */
export function agentRuntimeReady(): boolean {
  return ready;
}

/** Boot: open the runtime (exclusive store lock + Harness resume). */
export async function openAgentRuntime(
  options: Parameters<typeof AgentRuntime.open>[0],
): Promise<AgentRuntime> {
  const instance = await AgentRuntime.open(options);
  runtime = instance;
  ready = true;
  return instance;
}

/** Shutdown: close the runtime and release the store lock. */
export async function closeAgentRuntime(): Promise<void> {
  ready = false;
  const instance = runtime;
  runtime = undefined;
  await instance?.close();
}

/** Test seam: install a fake runtime without touching the real store. */
export function setAgentRuntimeForTests(fake: AgentRuntime): void {
  runtime = fake;
  ready = true;
}

/**
 * Faux-provider runtime for dev/E2E boots (TINY_AGENTS_FAUX=1): real durable
 * machinery, scripted replies, no network and no gateway keys.
 */
export async function openFauxAgentRuntime(storePath: string): Promise<AgentRuntime> {
  const { createModels } = await import("@earendil-works/pi-ai/models");
  const { fauxProvider } = await import("@earendil-works/pi-ai/providers/faux");

  const echo = (context: PiContext) => {
    let text = "";
    for (let i = context.messages.length - 1; i >= 0; i--) {
      const message = context.messages[i];
      if (message.role !== "user") continue;
      text =
        typeof message.content === "string"
          ? message.content
          : message.content
              .filter((b) => b.type === "text")
              .map((b) => (b as { text: string }).text)
              .join("");
      break;
    }
    return fauxAssistantMessage(fauxText(`Echo: ${text}`));
  };

  const models = createModels();
  const faux = fauxProvider({
    provider: "faux",
    models: [{ id: TEST_MODEL, name: "Test Model (faux)", reasoning: true }],
  });
  // The faux provider consumes one queued response per request; keep a deep
  // queue so long sessions never run dry.
  faux.setResponses(Array.from({ length: 1000 }, () => echo));
  models.setProvider(faux.provider);

  const instance = await AgentRuntime.open({
    storePath,
    models,
    provider: "faux",
    lockWaitMs: 5_000,
    settings: { retry: { enabled: false } },
    // The .env allowlist names real gateway custom models that don't exist
    // in the faux registry — without this override /models returns an empty
    // catalog and e2e cannot create bots.
    env: { ...process.env, GATEWAY_MODEL_ALLOWLIST: "" },
  });
  runtime = instance;
  ready = true;
  return instance;
}
