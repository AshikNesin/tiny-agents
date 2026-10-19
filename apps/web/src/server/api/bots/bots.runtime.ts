/**
 * The server's AgentRuntime singleton and its lifecycle.
 *
 * `apps/web/src/server/index.ts` opens the runtime at boot (before the HTTP
 * server accepts requests) and closes it in the graceful-shutdown hook. Route
 * modules read the instance through `getAgentRuntime()`; tests substitute a
 * fake via `setAgentRuntimeForTests()` instead of touching pi-durable.
 */
import {
  AgentRuntime,
  createBotsToolkit,
  createSkillsCapability,
  createTasksToolkit,
  createTimeToolkit,
  createTranscriber,
  createVisionToolkit,
  createWebToolkit,
  type BotMessagingStore,
  type Capability,
} from "@tiny-agents/agent";
import type { Context as PiContext } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxText, TEST_MODEL } from "@tiny-agents/agent/testing";
import { GATEWAY_PROVIDER } from "@tiny-agents/agent";
import { taskStore } from "../tasks/task.store";
import { skillStore } from "../skills/skills.store";
import { createBotMessagingStore } from "./bots.messaging";
import { createVisionStore } from "../uploads/uploads.store";

type Env = Readonly<Record<string, string | undefined>>;

const unquote = (value: string | undefined) =>
  value
    ?.trim()
    .replace(/^(['"])([\s\S]*)\1$/, "$2")
    .trim() || undefined;

/** The built-in toolkits (issue #1 D15) and skills. Read env at boot, like the runtime does. */
export function builtinCapabilities(env: Env = process.env): Capability[] {
  return [
    createSkillsCapability(skillStore),
    createTasksToolkit(taskStore),
    createWebToolkit({
      accountId: unquote(env.CLOUDFLARE_ACCOUNT_ID),
      apiToken: unquote(env.CLOUDFLARE_API_KEY),
      gatewayId: unquote(env.CLOUDFLARE_GATEWAY_ID),
      apiBase: unquote(env.CLOUDFLARE_API_BASE_URL),
    }),
    createTimeToolkit({ timeZone: unquote(env.TZ) }),
  ];
}

/** Bot-to-bot messaging (issue #12). The store needs the live runtime for submits. */
export function botsCapability(rt: AgentRuntime): Capability {
  return createBotsToolkit(botMessagingStore(rt));
}

/** The vision side-call (issue #17): uploads bytes + a transcriber model. */
export function visionCapability(
  rt: AgentRuntime,
  models: Parameters<typeof createTranscriber>[0],
  env: Env = process.env,
): Capability {
  return createVisionToolkit(
    createVisionStore(rt),
    createTranscriber(models, { providerId: GATEWAY_PROVIDER, env }),
  );
}

/** One messaging store per process, rebuilt never (the runtime is a singleton too). */
let messagingStore: BotMessagingStore | undefined;
function botMessagingStore(rt: AgentRuntime): BotMessagingStore {
  return (messagingStore ??= createBotMessagingStore(rt));
}

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
  // The messaging toolkit needs the runtime itself (it submits into target
  // conversations), so capabilities resolve after open. installCapability
  // registers it; bots select it by name on their next configure.
  const instance = await AgentRuntime.open({
    ...options,
    capabilities: [...builtinCapabilities(options.env), ...(options.capabilities ?? [])],
  });
  instance.installCapability(botsCapability(instance));
  // The vision side-call binds to the registry the runtime opened with
  // (built internally when the caller passed none).
  instance.installCapability(visionCapability(instance, instance.models, options.env));
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
export async function openFauxAgentRuntime(
  storePath: string,
  handlers: Pick<Parameters<typeof AgentRuntime.open>[0], "onFatal" | "onReport"> = {},
): Promise<AgentRuntime> {
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
    ...handlers,
    storePath,
    models,
    provider: "faux",
    lockWaitMs: 5_000,
    capabilities: builtinCapabilities(),
    settings: { retry: { enabled: false } },
    // The .env allowlist names real gateway custom models that don't exist
    // in the faux registry — without this override /models returns an empty
    // catalog and e2e cannot create bots.
    env: { ...process.env, GATEWAY_MODEL_ALLOWLIST: "" },
  });
  instance.installCapability(botsCapability(instance));
  instance.installCapability(visionCapability(instance, models));
  runtime = instance;
  ready = true;
  return instance;
}
