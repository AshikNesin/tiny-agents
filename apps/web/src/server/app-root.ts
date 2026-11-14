import type { AgentRuntime } from "@tiny-agents/agent";
import type { BrowserSessions } from "@tiny-agents/agent/browser";
import type { ClaudeWorkerLocator } from "@tiny-agents/agent/claude-worker";
import type { HostKeyStore, SandboxConnection } from "@tiny-agents/agent/sandbox";
import type { TerminalService } from "@tiny-agents/agent/terminal";
import type { ComputerSessions } from "@tiny-agents/agent/computer";
import type { ChatTitler } from "./api/bots/chats.title";
import type { CodeHub } from "./api/code/code.hub";
import type { ConnectionManager } from "./api/connections/connections.manager";

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
}

const current: App = { runtime: undefined, runtimeReady: false, sandboxConnections: new Map() };

/** The app's services, as boot (or a test) set them. */
export function app(): App {
  return current;
}

/** Test seam: install services (a fake runtime, say) without booting. */
export function installAppForTests(services: Partial<App>): void {
  Object.assign(current, services);
}
