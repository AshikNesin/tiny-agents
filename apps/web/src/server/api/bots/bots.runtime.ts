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
  createBrowserToolkit,
  createChromiumTransport,
  createRemoteCdpTransport,
  createMemoryCapability,
  createMemoryHostKeyStore,
  createRoutinesToolkit,
  createSandboxToolkit,
  createSkillsCapability,
  createTasksToolkit,
  createTodayCapability,
  createTranscriber,
  createVaultToolkit,
  createVisionToolkit,
  createWebToolkit,
  secretRedactor,
  WaitTracker,
  type BotMessagingStore,
  type Capability,
  type HostKeyStore,
} from "@tiny-agents/agent";
import type { Context as PiContext, ToolCall } from "@earendil-works/pi-ai";
import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  TEST_MODEL,
} from "@tiny-agents/agent/testing";
import { GATEWAY_PROVIDER } from "@tiny-agents/agent";
import { createNamespaceKv } from "@groot/core/kv";
import { setScrubber } from "@groot/core/logger";
import { taskStore } from "../tasks/task.store";
import { skillStore } from "../skills/skills.store";
import { memoryStore } from "./memories.store";
import { createBotMessagingStore } from "./bots.messaging";
import { createVisionStore } from "../uploads/uploads.store";
import { createRoutineStore } from "../routines/routines.toolkit-store";
import { browserTargetForConversation } from "./browser.targets";
import { createVaultBroker } from "../vault/vault.broker";

type Env = Readonly<Record<string, string | undefined>>;

const unquote = (value: string | undefined) =>
  value
    ?.trim()
    .replace(/^(['"])([\s\S]*)\1$/, "$2")
    .trim() || undefined;

/**
 * Calls waiting on the owner's approval, shared by the runtime's approval
 * gate and the browser's credential requests (one count per conversation).
 */
const ownerWaits = new WaitTracker();

/** The built-in toolkits (issue #1 D15) and skills. Read env at boot, like the runtime does. */
export function builtinCapabilities(env: Env = process.env): Capability[] {
  // Every value the vault resolves is scrubbed from logs and error reports too.
  setScrubber((text) => secretRedactor.scrub(text));
  const vault = createVaultBroker(getAgentRuntime);
  return [
    createSkillsCapability(skillStore),
    createMemoryCapability(memoryStore),
    createTasksToolkit(taskStore),
    createRoutinesToolkit(createRoutineStore()),
    createWebToolkit({
      apiKey: unquote(env.TINYFISH_API_KEY),
      vault,
    }),
    // Vault (issue #56): handles only; sinks live in the browser and web toolkits.
    createVaultToolkit({ broker: vault }),
    createTodayCapability({ timeZone: unquote(env.TZ) }),
    // Default host is the verified MagicDNS name (issue #19 runbook); the
    // env var exists to override — e.g. the Tailscale IP if MagicDNS breaks.
    createSandboxToolkit({
      host: unquote(env.SANDBOX_HOST) ?? "tiny-agents-vm",
      port: env.SANDBOX_PORT ? Number(env.SANDBOX_PORT) : undefined,
      user: unquote(env.SANDBOX_USER),
      hostKeys: kvHostKeyStore(),
      // Vault secrets as env vars for one command, confined to their hosts;
      // with an allowlist, every command is confined to it (issue #56).
      vault,
      egressAllowlist: unquote(env.SANDBOX_EGRESS_ALLOWLIST),
    }),
    // Browser (issue #24): one Chrome per profile (shared by default, or the
    // bot's own), a tab per bot, lazy, idle-closed; on the sandbox VM the
    // owner also gets a VNC-streamed desktop.
    createBrowserToolkit({
      profilesDir: env.BROWSER_PROFILES_DIR ?? undefined,
      resolveTarget: browserTargetForConversation,
      idleMinutes: env.BROWSER_IDLE_MINUTES ? Number(env.BROWSER_IDLE_MINUTES) : undefined,
      scale: Number(env.BROWSER_SCALE) === 1 ? 1 : 2,
      allowedPrivateHosts: unquote(env.BROWSER_ALLOWED_PRIVATE_HOSTS) ?? undefined,
      transport: browserTransport(env),
      vault,
      ownerWaits,
    }),
  ];
}

/**
 * Browser transport for the deploy model: chromium runs on the sandbox VM
 * (SANDBOX_HOST over Tailscale SSH), not in this container. With
 * BROWSER_EXECUTABLE_PATH set we drive that local binary instead (dev on
 * the exe.dev VM); with neither, Playwright's bundled Chromium.
 */
function browserTransport(env: Env) {
  const executable = unquote(env.BROWSER_EXECUTABLE_PATH);
  if (executable) return createChromiumTransport({ executablePath: executable });
  const sandboxHost = unquote(env.SANDBOX_HOST);
  if (sandboxHost) {
    return createRemoteCdpTransport({
      host: sandboxHost,
      port: env.SANDBOX_PORT ? Number(env.SANDBOX_PORT) : undefined,
      user: unquote(env.SANDBOX_USER),
    });
  }
  return createChromiumTransport();
}

/**
 * The sandbox's TOFU host-key pins, one per host, persisted through the app's
 * KV (the `keyv` table) so a restart remembers what it trusted on first
 * connect. The memory fallback keeps tests key-free.
 */
function kvHostKeyStore(): HostKeyStore {
  try {
    const kv = createNamespaceKv("SANDBOX");
    return {
      async get(host) {
        return (await kv.get<string>(host)) ?? undefined;
      },
      async set(host, hash) {
        await kv.set(host, hash);
      },
    };
  } catch {
    return createMemoryHostKeyStore();
  }
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
  const instance = await AgentRuntime.open({
    ...options,
    approvalTracker: ownerWaits,
    capabilities: [...builtinCapabilities(options.env), ...(options.capabilities ?? [])],
  });
  return finishOpen(instance, options.env);
}

/**
 * The wiring every boot shares once the runtime is open, whichever models it
 * runs on. The messaging toolkit needs the runtime itself (it submits into
 * target conversations) and the vision side-call binds to the registry the
 * runtime opened with, so both install after open; bots select them by name
 * on their next configure.
 */
function finishOpen(instance: AgentRuntime, env: Env = process.env): AgentRuntime {
  instance.installCapability(botsCapability(instance));
  instance.installCapability(visionCapability(instance, instance.models, env));
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

/** A faux bot's ask_owner call on "/ask": a single-choice, a multiple-choice and an open question. */
const FAUX_ASK: ToolCall["arguments"] = {
  questions: [
    {
      question: "Which stack should the project use?",
      options: [
        { label: "React", description: "With Vite and Tailwind" },
        { label: "Svelte" },
        { label: "Plain HTML" },
      ],
    },
    {
      question: "Which extras do you want?",
      description: "Pick as many as you like.",
      options: [{ label: "Auth" }, { label: "Dark mode" }, { label: "Tests" }],
      multiple: true,
    },
    { question: "Anything else I should know?" },
  ],
};

/**
 * Faux-provider runtime for dev/E2E boots (TINY_AGENTS_FAUX=1): real durable
 * machinery, scripted replies, no network and no gateway keys.
 *
 * TINY_AGENTS_FAUX_TOKENS_PER_SECOND streams the scripted echoes at that many
 * tokens per second instead of instantly, giving e2e a real busy window to
 * steer or queue into. Unset (or non-numeric) streams instantly.
 *
 * A message starting with "/ask" makes the bot ask the owner sample questions
 * (ask_owner); the answers it gets back are echoed like any text.
 */
export async function openFauxAgentRuntime(
  storePath: string,
  handlers: Pick<Parameters<typeof AgentRuntime.open>[0], "onFatal" | "onReport"> = {},
  env: Env = process.env,
): Promise<AgentRuntime> {
  const { createModels } = await import("@earendil-works/pi-ai/models");
  const { fauxProvider } = await import("@earendil-works/pi-ai/providers/faux");

  const textOf = (message: PiContext["messages"][number]) =>
    typeof message.content === "string"
      ? message.content
      : message.content
          .filter((b) => b.type === "text")
          .map((b) => (b as { text: string }).text)
          .join("");
  const echo = (context: PiContext) => {
    const last = context.messages.at(-1);
    if (last?.role === "toolResult") return fauxAssistantMessage(fauxText(`Echo: ${textOf(last)}`));
    let text = "";
    for (let i = context.messages.length - 1; i >= 0; i--) {
      const message = context.messages[i];
      if (message.role !== "user") continue;
      text = textOf(message);
      break;
    }
    if (text.startsWith("/ask")) {
      const ask = fauxAssistantMessage(fauxToolCall("ask_owner", FAUX_ASK));
      return { ...ask, stopReason: "toolUse" as const };
    }
    return fauxAssistantMessage(fauxText(`Echo: ${text}`));
  };

  const models = createModels();
  const tokensPerSecond = Number(env.TINY_AGENTS_FAUX_TOKENS_PER_SECOND);
  const faux = fauxProvider({
    provider: "faux",
    models: [{ id: TEST_MODEL, name: "Test Model (faux)", reasoning: true }],
    ...(Number.isFinite(tokensPerSecond) && tokensPerSecond > 0 ? { tokensPerSecond } : {}),
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
    approvalTracker: ownerWaits,
    capabilities: builtinCapabilities(env),
    settings: { retry: { enabled: false } },
    // The .env allowlist names real gateway custom models that don't exist
    // in the faux registry — without this override /models returns an empty
    // catalog and e2e cannot create bots.
    env: { ...env, GATEWAY_MODEL_ALLOWLIST: "" },
  });
  return finishOpen(instance, env);
}
