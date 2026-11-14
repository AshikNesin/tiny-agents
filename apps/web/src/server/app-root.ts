import { WaitTracker, type AgentRuntime, type BotMessagingStore } from "@tiny-agents/agent";
import type { BrowserSessions } from "@tiny-agents/agent/browser";
import type { ClaudeWorkerLocator } from "@tiny-agents/agent/claude-worker";
import type { HostKeyStore, SandboxConnection } from "@tiny-agents/agent/sandbox";
import type { TerminalService } from "@tiny-agents/agent/terminal";
import type { ComputerSessions } from "@tiny-agents/agent/computer";
import type { UpdateStatus } from "../shared/local-updates";
import type { TurnBudget } from "./api/bots/bots.messaging";
import type { BotChatEvent } from "./api/bots/bots.events";
import type { SseStream } from "./api/bots/bots.sse";
import type { ChatTitler } from "./api/bots/chats.title";
import type { CodeHub } from "./api/code/code.hub";
import type { ConnectionManager } from "./api/connections/connections.manager";
import type { HeldLiveAccess } from "./api/people/live-access";
import type { VaultAlertSink } from "./api/vault/vault.alerts";
import type { SupervisorChannel } from "./api/system/updates.service";

/**
 * The composition root (docs/rewrite/DECISIONS.md, D8): the app's long-lived
 * services in one object, filled once by the entry at boot (`entry.node.ts`)
 * or by a test, and read through `app()`. Phase 1 of docs/rewrite/PLAN.md
 * moves each module-level singleton here, one kind at a time, so boot,
 * shutdown and test resets each touch one place.
 */
export interface App {
  /** The open agent runtime; undefined until boot opened it (or a test installed one). */
  runtime: AgentRuntime | undefined;
  /** Boot finished opening the runtime: `/ready` and the Code registry wait on it. */
  runtimeReady: boolean;
  /** The bots' browsers, made from the env on first use (`getBrowserSessions`). */
  browserSessions?: BrowserSessions;
  /** The bots' desktops: null when no sandbox VM is set up (`getComputerSessions`). */
  computerSessions?: ComputerSessions | null;
  /** MCP connections (`getConnectionManager`). */
  connectionManager?: ConnectionManager;
  /** The Code page's harnesses (`codeHub`); unset until boot, or with none configured. */
  codeHub?: CodeHub;
  /** Past-chat titles' side-caller (`setChatTitler`); unset in tests and faux mode. */
  chatTitler?: ChatTitler;
  /** The sandbox's SSH connections, one per endpoint (`sandboxConnection`, ADR 0013). */
  sandboxConnections: Map<string, SandboxConnection>;
  /** The sandbox's pinned host keys, kept in KV (`sandbox-host.ts`). */
  sandboxHostKeys?: HostKeyStore;
  /** The Claude worker on the sandbox, for the connection it was set up on (`claude-worker.ts`). */
  claudeWorker?: { connection: SandboxConnection; locator: ClaudeWorkerLocator };
  /** The terminal's tmux service (`getTerminalService`). */
  terminalService?: TerminalService;
  /** Calls waiting on the owner, shared by the approval gate and the browser and computer toolkits (`bots.runtime.ts`). */
  ownerWaits: WaitTracker;
  /** One bot messaging store per runtime, so a reopened runtime gets its own (`botsCapability`). */
  botMessagingStores: WeakMap<AgentRuntime, BotMessagingStore>;
  /** One bot-to-bot send budget per runtime (`turnBudgetOf`, bots.messaging.ts). */
  turnBudgets: WeakMap<object, TurnBudget>;
  /** Open chat streams per bot id (`watchBot`, bots.viewers.ts). */
  botViewers: Map<string, number>;
  /** Each bot's chat-event listeners (`onBotChatEvent`, bots.events.ts). */
  botChatListeners: Map<string, Set<(event: BotChatEvent) => void>>;
  /** Every SSE response still open, so shutdown can end them (`openSse`, bots.sse.ts). */
  openSseStreams: Set<SseStream<never>>;
  /** A deleted bot's releases still running in the background (`releaseBot`, bot-resources.ts). */
  backgroundBotReleases: Set<Promise<void>>;
  /** Live connections held under a grant, closed when it is revoked (`holdLiveAccess`). */
  liveAccess: Set<HeldLiveAccess>;
  /** The Vault's step-up tokens and whose they are (`issueStepUp`, vault.stepup.ts). */
  vaultStepUps: Map<string, { userId: number; expiresAt: number }>;
  /** Where vault alerts go (`setVaultAlertSink`); unset drops them. */
  vaultAlertSink?: VaultAlertSink;
  /** Credential requests a submit is filling right now (`submitRequest`, vault.requests.service.ts). */
  submittingRequests: Set<number>;
  /** The runtime `reloadModels` hands new model config to (`bindModelRuntime`). */
  modelRuntime?: Pick<AgentRuntime, "applyModelConfig">;
  /** Listeners for committed model changes (`onModelsChanged`). */
  modelListeners: Set<() => void>;
  /** The IPC channel to the `pnpm local` supervisor (`startUpdates`); unset when not supervised. */
  updatesChannel?: SupervisorChannel;
  /** The supervisor's last update status, null before it sent one (`updateView`). */
  updateStatus: UpdateStatus | null;
  /** Stops listening to the supervisor channel (`startUpdates`). */
  updatesUnlisten: () => void;
}

const current: App = {
  runtime: undefined,
  runtimeReady: false,
  sandboxConnections: new Map(),
  ownerWaits: new WaitTracker(),
  botMessagingStores: new WeakMap(),
  turnBudgets: new WeakMap(),
  botViewers: new Map(),
  botChatListeners: new Map(),
  openSseStreams: new Set(),
  backgroundBotReleases: new Set(),
  liveAccess: new Set(),
  vaultStepUps: new Map(),
  submittingRequests: new Set(),
  modelListeners: new Set(),
  updateStatus: null,
  updatesUnlisten: () => {},
};

/** The app's services, as boot (or a test) set them. */
export function app(): App {
  return current;
}

/** Test seam: install services (a fake runtime, say) without booting. */
export function installAppForTests(services: Partial<App>): void {
  Object.assign(current, services);
}
