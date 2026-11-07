/**
 * The server's AgentRuntime singleton and its lifecycle.
 *
 * `apps/web/src/server/entry.node.ts` opens the runtime at boot (before the HTTP
 * server accepts requests) and closes it in the graceful-shutdown hook. Route
 * modules read the instance through `getAgentRuntime()`; tests substitute a
 * fake via `setAgentRuntimeForTests()` instead of touching pi-durable.
 */
import {
  AgentRuntime,
  createAttachmentsToolkit,
  createBotBuilderCapability,
  createBotsToolkit,
  createBrowserToolkit,
  createClassifier,
  createComputerToolkit,
  createMemoryCapability,
  createReviewer,
  createRoutinesToolkit,
  createSelfImproveCapability,
  createSandboxToolkit,
  createSkillsCapability,
  createCodeToolkit,
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
  type Reviewer,
  claudeCodeEngineEnabled,
} from "@tiny-agents/agent";
import type { Context as PiContext, ToolCall } from "@earendil-works/pi-ai";
import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  TEST_MODEL,
} from "@tiny-agents/agent/testing";
import { logger, setScrubber } from "@groot/core/logger";
import { taskStore } from "../tasks/task.store";
import { codeStore } from "../code/code.bots";
import { skillStore } from "../skills/skills.store";
import { memoryStore } from "./memories.store";
import { createBotMessagingStore } from "./bots.messaging";
import { createAttachmentStore, createVisionStore } from "../uploads/uploads.store";
import { createInstructionsStore } from "./self-improve.store";
import { createBotCreationStore } from "./bot-builder.store";
import { createRoutineStore } from "../routines/routines.toolkit-store";
import { browserTargetForConversation } from "./browser.targets";
import { createVaultBroker } from "../vault/vault.broker";
import { getBrowserSessions } from "./browser.sessions";
import {
  computerProfileForConversation,
  computerSetupHint,
  getComputerSessions,
} from "./computer.sessions";
import { sandboxConnection, unquoteEnv as unquote } from "./sandbox-host";
import { sharedClaudeWorkerLocator } from "./claude-worker";
import { missingToolkits } from "./bot-toolkits";
import { appEnv, type AppEnv } from "../../env";

type RuntimeOptions = Parameters<typeof AgentRuntime.open>[0];
type RuntimeEnv = NonNullable<RuntimeOptions["env"]>;

/**
 * Calls waiting on the owner's approval, shared by the runtime's approval
 * gate and the browser's credential requests (one count per conversation).
 */
const ownerWaits = new WaitTracker();

/**
 * The built-in toolkits whose stores are the app's own: no hosts, keys or
 * processes behind them. The server test runtime installs exactly these
 * (with `botsCapability`); `builtinCapabilities` adds the rest.
 */
export function appStoreCapabilities(env: AppEnv = appEnv()) {
  return {
    tasks: createTasksToolkit(taskStore),
    routines: createRoutinesToolkit(createRoutineStore()),
    skills: createSkillsCapability(skillStore),
    memory: createMemoryCapability(memoryStore),
    today: createTodayCapability({ timeZone: unquote(env.TZ) }),
  } satisfies Record<string, Capability>;
}

/** The built-in toolkits (issue #1 D15) and skills. Read env at boot, like the runtime does. */
function builtinCapabilities(env: AppEnv = appEnv()): Capability[] {
  // Every value the vault resolves is scrubbed from logs and error reports too.
  setScrubber((text) => secretRedactor.scrub(text));
  const vault = createVaultBroker(getAgentRuntime);
  const own = appStoreCapabilities(env);
  return [
    own.skills,
    own.memory,
    // Self-improvement (issue #128): the bot edits its own system prompt;
    // `askOnly`, so every change waits for the owner in chat.
    createSelfImproveCapability(createInstructionsStore()),
    // Bot builder (issue #149): create a new bot when the owner asks;
    // `askOnly`, so every new bot waits for the owner in chat.
    createBotBuilderCapability(createBotCreationStore()),
    own.tasks,
    own.routines,
    createWebToolkit({
      apiKey: unquote(env.TINYFISH_API_KEY),
      vault,
    }),
    // Vault (issue #56): handles only; sinks live in the browser and web toolkits.
    createVaultToolkit({ broker: vault }),
    own.today,
    createSandboxToolkit({
      // The one sandbox connection every SSH user shares.
      connection: sandboxConnection(env),
      // Vault secrets as env vars for one command, confined to their hosts;
      // with an allowlist, every command is confined to it (issue #56).
      vault,
      egressAllowlist: unquote(env.SANDBOX_EGRESS_ALLOWLIST),
    }),
    // Attachments (issue #58): read, search and copy the files the owner
    // attached. The store resolves ids through the live runtime, scoped to
    // the asking conversation.
    createAttachmentsToolkit(
      createAttachmentStore({ attachmentIds: (id) => getAgentRuntime().attachmentIds(id) }),
      { sandbox: sandboxConnection(env) },
    ),
    // Browser (issue #24): one Chrome per profile (shared by default, or the
    // bot's own), a tab per bot, lazy, idle-closed; on the sandbox VM the
    // owner also gets a VNC-streamed desktop.
    createBrowserToolkit({
      // The same manager the routes, the VNC bridge and the credential
      // request submit act through (browser.sessions.ts).
      sessions: getBrowserSessions(env),
      resolveTarget: browserTargetForConversation,
      allowedPrivateHosts: unquote(env.BROWSER_ALLOWED_PRIVATE_HOSTS) ?? undefined,
      vault,
      ownerWaits,
    }),
    // Code (issue #143, ADR 0011): hand coding work to the owner's coding
    // agents (Shelley by default, Claude Code by name); finishes come back
    // into the chat. No tools without a configured harness.
    createCodeToolkit(
      env.SHELLEY_URL?.trim() || claudeCodeEngineEnabled(env)
        ? { store: codeStore }
        : {
            setupHint:
              "Set SHELLEY_URL, or turn on the Claude plan on the sandbox, to hand coding work to a coding agent.",
          },
    ),
    // Computer (issue #108): an XFCE desktop per browser profile on the
    // sandbox VM, seen with scrot and driven with xdotool. Without a VM it
    // offers no tools and the bot editor shows why.
    createComputerToolkit({
      sessions: getComputerSessions(env) ?? undefined,
      resolveProfile: computerProfileForConversation,
      setupHint: computerSetupHint(env),
      vault,
      ownerWaits,
    }),
  ];
}

/** Bot-to-bot messaging (issue #12). The store needs the live runtime for submits. */
export function botsCapability(rt: AgentRuntime): Capability {
  return createBotsToolkit(botMessagingStore(rt));
}

/** The vision side-call (issue #17): uploads bytes + a transcriber model. */
function visionCapability(
  rt: AgentRuntime,
  models: Parameters<typeof createTranscriber>[0],
  env: RuntimeEnv,
): Capability {
  return createVisionToolkit(
    createVisionStore(rt),
    createTranscriber(models, { providerId: rt.provider, env }),
  );
}

/** One messaging store per runtime: a reopened runtime (tests, a restart in-process) gets its own. */
const messagingStores = new WeakMap<AgentRuntime, BotMessagingStore>();
function botMessagingStore(rt: AgentRuntime): BotMessagingStore {
  let store = messagingStores.get(rt);
  if (!store) {
    store = createBotMessagingStore(rt);
    messagingStores.set(rt, store);
  }
  return store;
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

/**
 * Auto-review's reviewer (issue #65): TypeSafe's Jev on Workers AI through the AI
 * Gateway unless CLASSIFIER_MODEL names another classifier. Without the
 * gateway settings bots that turn auto-review on keep every approval card.
 */
function autoReviewer(env: RuntimeEnv): Reviewer | undefined {
  const classifier = createClassifier(env);
  if (!classifier) return undefined;
  return createReviewer(classifier, {
    // Scores and outcome only: never the call's arguments.
    // A failed review is a card the owner did not need: warn so it is noticed.
    onReview: ({ tool, verdict, durationMs }) =>
      verdict.error
        ? logger.warn({ tool, ...verdict, durationMs }, "Auto-review failed; asking the owner")
        : logger.info({ tool, ...verdict, durationMs }, "Auto-review"),
  });
}

/** Boot: open the runtime (exclusive store lock + Harness resume). */
export async function openAgentRuntime(
  options: RuntimeOptions & { env: RuntimeEnv },
): Promise<AgentRuntime> {
  const appVars = appEnv(options.env);
  const instance = await AgentRuntime.open({
    ...options,
    approvalTracker: ownerWaits,
    reviewer: options.reviewer ?? autoReviewer(options.env),
    capabilities: [...builtinCapabilities(appVars), ...(options.capabilities ?? [])],
    claudeWorker: options.claudeWorker ?? sharedClaudeWorkerLocator(appVars),
  });
  // With the Claude plan engine on, install and start its worker on the
  // sandbox now, so the first turn doesn't wait on it.
  instance.prepareClaudeCode();
  return finishOpen(instance, options.env);
}

/**
 * The wiring every boot shares once the runtime is open, whichever models it
 * runs on. The messaging toolkit needs the runtime itself (it submits into
 * target conversations) and the vision side-call binds to the registry the
 * runtime opened with, so both install after open; bots select them by name
 * on their next configure.
 */
function finishOpen(instance: AgentRuntime, env: RuntimeEnv): AgentRuntime {
  instance.installCapability(botsCapability(instance));
  instance.installCapability(visionCapability(instance, instance.models, env));
  // A selected id the runtime lacks is silently ignored at configure: say so.
  const missing = missingToolkits(instance.listCapabilities().map((c) => c.id));
  if (missing.length > 0) {
    logger.warn({ missing }, "Bots select toolkits the runtime has not installed");
  }
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
 * (ask_owner); the answers it gets back are echoed like any text. "/browse N"
 * reads the browser page N times (browser_snapshot), one tool round each.
 * "/improve" proposes appending a line to the bot's own instructions
 * (update_instructions), so e2e can drive the self-improvement approval.
 * "/newbot NAME" asks to create a bot named NAME (create_bot), so e2e can
 * drive the bot-builder approval.
 */
export async function openFauxAgentRuntime(
  storePath: string,
  options: Pick<RuntimeOptions, "onFatal" | "onReport"> & { env: RuntimeEnv },
): Promise<AgentRuntime> {
  const { env, ...handlers } = options;
  const appVars = appEnv(env);
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
    let text = "";
    let toolResults = 0;
    for (let i = context.messages.length - 1; i >= 0; i--) {
      const message = context.messages[i];
      if (message.role === "toolResult") toolResults++;
      if (message.role !== "user") continue;
      text = textOf(message);
      break;
    }
    // "/browse N" reads the page N times, one tool round each, then answers.
    const browse = /^\/browse(?:\s+(\d+))?/.exec(text);
    if (browse && toolResults < Math.min(Number(browse[1] ?? 1), 10)) {
      const call = fauxAssistantMessage(fauxToolCall("browser_snapshot", {}));
      return { ...call, stopReason: "toolUse" as const };
    }
    if (last?.role === "toolResult") return fauxAssistantMessage(fauxText(`Echo: ${textOf(last)}`));
    if (text.startsWith("/ask")) {
      const ask = fauxAssistantMessage(fauxToolCall("ask_owner", FAUX_ASK));
      return { ...ask, stopReason: "toolUse" as const };
    }
    // "/code [cwd=PATH] task" hands the task to the default coding agent
    // (issue #143), one tool round, so e2e can drive a hand-off and its finish.
    const code = /^\/code\s+(?:cwd=(\S+)\s+)?([\s\S]+)/.exec(text);
    if (code && toolResults === 0) {
      const call = fauxAssistantMessage(
        fauxToolCall("code_start", { task: code[2], ...(code[1] ? { cwd: code[1] } : {}) }),
      );
      return { ...call, stopReason: "toolUse" as const };
    }
    // "/improve" proposes appending a line to the bot's own instructions,
    // one tool round, so e2e can drive the self-improvement approval flow.
    // "/improve long" appends a paragraph, so the approval card's Read more
    // (the payload folds past 120 chars) can also be driven e2e.
    const improve = /^\/improve(?:\s+(long))?/.exec(text);
    if (improve && toolResults === 0) {
      const append = improve[1]
        ? "Self-improvement e2e: a deliberately long change so the approval " +
          "card folds it behind Read more.\n" +
          "The owner must be able to read the whole proposal before " +
          "approving it — a 60-character slice of a 700-word rewrite is " +
          "rubber-stamping.\n" +
          "This line exists only to push the payload over the fold threshold."
        : "Self-improvement e2e: append this line.";
      const call = fauxAssistantMessage(
        fauxToolCall("update_instructions", {
          append,
        }),
      );
      return { ...call, stopReason: "toolUse" as const };
    }
    const newBot = /^\/newbot\s+(.+)/.exec(text);
    if (newBot && toolResults === 0) {
      const call = fauxAssistantMessage(
        fauxToolCall("create_bot", {
          name: newBot[1],
          description: "Made by the bot-builder e2e",
          instructions: "You help the owner with the bot-builder e2e.",
        }),
      );
      return { ...call, stopReason: "toolUse" as const };
    }
    return fauxAssistantMessage(fauxText(`Echo: ${text}`));
  };

  const models = createModels();
  const tokensPerSecond = Number(appVars.TINY_AGENTS_FAUX_TOKENS_PER_SECOND);
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
    capabilities: builtinCapabilities(appVars),
    settings: { retry: { enabled: false } },
    // The .env allowlist names real gateway custom models that don't exist
    // in the faux registry — without this override /models returns an empty
    // catalog and e2e cannot create bots.
    env: { ...env, GATEWAY_MODEL_ALLOWLIST: "" },
  });
  return finishOpen(instance, env);
}
