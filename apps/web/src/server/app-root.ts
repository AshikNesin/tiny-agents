import { WaitTracker, type AgentRuntime, type BotMessagingStore } from "@tiny-agents/agent";
import type { BrowserSessions } from "@tiny-agents/sandbox/browser";
import type { ClaudeWorkerLocator } from "@tiny-agents/agent/claude-worker";
import type { HostKeyStore, SandboxConnection } from "@tiny-agents/sandbox";
import type { TerminalService } from "@tiny-agents/sandbox/terminal";
import type { ComputerSessions } from "@tiny-agents/sandbox/computer";
import type { UpdateStatus } from "../shared/local-updates";
import type { TurnBudget } from "./api/bots/bots.messaging";
import type { BotChatEvent } from "./api/bots/bots.events";
import type { SseStream } from "./api/bots/bots.sse";
import type { ChatTitler } from "./api/bots/chats.title";
import type { AppAuth } from "@tiny-agents/github";
import type { CodeGitHub } from "./api/code/code.github";
import type { CodeBranchNamer } from "./api/code/code.naming";
import type { CodeHub } from "./api/code/code.hub";
import type { CodeChanges } from "./api/code/code.changes";
import type { ConnectionManager } from "./api/connections/connections.manager";
import type { HeldLiveAccess } from "./api/people/live-access";
import type { VaultAlertSink } from "./api/vault/vault.alerts";
import type { BundledConnect } from "./api/vault/connect/bundled-connect";
import type { SupervisorChannel } from "./api/system/updates.service";
import type { VapidKeys } from "@groot/core/notification/webpush.crypto";

export interface App {
  runtime: AgentRuntime | undefined;
  runtimeReady: boolean;
  browserSessions?: BrowserSessions;
  computerSessions?: ComputerSessions | null;
  connectionManager?: ConnectionManager;
  codeHub?: CodeHub;
  codeChanges?: CodeChanges;
  codeGitHub?: CodeGitHub;
  codeGitHubApp?: { key: string; auth: AppAuth };
  chatTitler?: ChatTitler;
  codeBranchNamer?: CodeBranchNamer;
  codeNextPrompts?: Map<string, Promise<string | null>>;
  sandboxConnections: Map<string, SandboxConnection>;
  sandboxHostKeys?: HostKeyStore;
  claudeWorker?: { connection: SandboxConnection; locator: ClaudeWorkerLocator };
  terminalService?: TerminalService;
  ownerWaits: WaitTracker;
  botMessagingStores: WeakMap<AgentRuntime, BotMessagingStore>;
  turnBudgets: WeakMap<object, TurnBudget>;
  botViewers: Map<string, number>;
  botChatListeners: Map<string, Set<(event: BotChatEvent) => void>>;
  openSseStreams: Set<SseStream<never>>;
  backgroundBotReleases: Set<Promise<void>>;
  liveAccess: Set<HeldLiveAccess>;
  vaultStepUps: Map<string, { userId: number; expiresAt: number }>;
  vaultAlertSink?: VaultAlertSink;
  bundledConnect?: BundledConnect;
  submittingRequests: Set<number>;
  modelRuntime?: Pick<AgentRuntime, "applyModelConfig">;
  modelListeners: Set<() => void>;
  updatesChannel?: SupervisorChannel;
  updateStatus: UpdateStatus | null;
  updatesUnlisten: () => void;
  webPush: {
    keys?: VapidKeys;
    activeDevices: number;
  };
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
  webPush: { activeDevices: 0 },
};

export function app(): App {
  return current;
}

export function installAppForTests(services: Partial<App>): void {
  Object.assign(current, services);
}
