/**
 * McpManager (issue #1 M3): owns the live MCP client of every connection.
 *
 * - At boot each connection's capability is installed from its cached tool
 *   list right away (so interrupted calls can resume and bots keep their
 *   tools), then connected in the background — `/health` never waits on it.
 * - Calls wait briefly for a (re)connect; dropped connections reconnect with
 *   backoff.
 * - A tool-list change re-installs the capability and re-applies the
 *   configuration of the bots that use it (their permissions are per tool).
 * - A server that needs (re)authorization marks the connection
 *   "needs_auth" and withdraws its tools until the owner signs in (D11).
 */
import { prisma } from "@groot/core/database";
import { logger } from "@groot/core/logger";
import {
  connectMcp,
  createMcpCapability,
  createToolSearchCapability,
  MCP_DEFER_THRESHOLD,
  isUnauthorized,
  mcpAuth,
  type AgentRuntime,
  type McpConnection,
  type McpToolInfo,
  type McpTransportKind,
} from "@tiny-agents/agent";
import { reconfigure, connectionCapabilityId } from "../bots/bots.service";
import { connectionForState, createOAuthProvider, readOAuthState } from "./oauth";
import { decryptSecret, SecretsKeyMissingError } from "./secrets";

export type ConnectionStatus = "connecting" | "connected" | "error" | "needs_auth";

export interface ConnectionLiveState {
  status: ConnectionStatus;
  error?: string;
}

type ConnectionRow = NonNullable<Awaited<ReturnType<typeof prisma.connection.findUnique>>>;

type ManagedRuntime = Pick<AgentRuntime, "installCapability" | "uninstallCapability" | "configure">;

interface Live extends ConnectionLiveState {
  connection?: McpConnection;
  connecting?: Promise<void>;
  retry?: ReturnType<typeof setTimeout>;
  attempt: number;
  authorizationUrl?: string;
}

const MAX_BACKOFF_MS = 5 * 60_000;

export function parseTools(raw: string): McpToolInfo[] {
  try {
    const tools = JSON.parse(raw) as McpToolInfo[];
    return Array.isArray(tools) ? tools : [];
  } catch {
    return [];
  }
}

export class ConnectionManager {
  readonly #live = new Map<string, Live>();
  readonly #listeners = new Set<(id: string, state: ConnectionLiveState) => void>();
  #runtime: ManagedRuntime | undefined;
  #closed = false;

  /** Install cached capabilities and start connecting everything (non-blocking). */
  async start(runtime: ManagedRuntime): Promise<void> {
    this.#runtime = runtime;
    const rows = await prisma.connection.findMany();
    for (const row of rows) {
      const tools = parseTools(row.toolsCache);
      if (tools.length > 0) this.#install(row, tools);
      void this.connect(row.id);
    }
  }

  status(id: string): ConnectionLiveState {
    const live = this.#live.get(id);
    return live
      ? { status: live.status, ...(live.error ? { error: live.error } : {}) }
      : { status: "connecting" };
  }

  onChange(listener: (id: string, state: ConnectionLiveState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** (Re)connect a connection now; resolves once it is connected or has failed. */
  connect(id: string): Promise<void> {
    const live = this.#entry(id);
    if (live.connecting) return live.connecting;
    clearTimeout(live.retry);
    live.connecting = this.#connect(id, live).finally(() => {
      live.connecting = undefined;
    });
    return live.connecting;
  }

  async #connect(id: string, live: Live): Promise<void> {
    const row = await prisma.connection.findUnique({ where: { id } });
    if (!row || this.#closed) return;
    this.#set(id, { status: "connecting" });
    await live.connection?.close().catch(() => undefined);
    live.connection = undefined;
    try {
      const connection = await connectMcp({
        url: row.url,
        transport: row.transport as McpTransportKind,
        ...(await this.#auth(row, live)),
        onToolsChanged: (tools) => void this.#toolsChanged(id, tools),
        onClose: () => {
          if (live.connection !== connection || this.#closed) return;
          live.connection = undefined;
          this.#set(id, { status: "error", error: "Connection closed" });
          this.#scheduleRetry(id, live);
        },
      });
      live.connection = connection;
      live.attempt = 0;
      live.authorizationUrl = undefined;
      if (connection.transport !== row.transport) {
        await prisma.connection.update({
          where: { id },
          data: { transport: connection.transport },
        });
      }
      await this.#toolsChanged(id, connection.tools);
      this.#set(id, { status: "connected" });
    } catch (error) {
      if (error instanceof SecretsKeyMissingError) {
        this.#set(id, { status: "error", error: error.message });
        return;
      }
      if (row.authType === "oauth" && isUnauthorized(error)) {
        this.#withdraw(row.slug);
        this.#set(id, { status: "needs_auth", error: "Sign in to use this connection" });
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ connection: row.slug, error: message }, "MCP connection failed");
      this.#set(id, { status: "error", error: message });
      this.#scheduleRetry(id, live);
    }
  }

  async #auth(row: ConnectionRow, live: Live) {
    if (row.authType === "header" && row.headerName && row.secretEnc) {
      return { headers: { [row.headerName]: decryptSecret(row.secretEnc) } };
    }
    if (row.authType === "oauth") {
      // No tokens yet: connect without the provider so a 401 surfaces as
      // needs_auth instead of racing the sign-in's state/verifier pair.
      // (With tokens, the SDK refreshes them transparently.)
      if (!(await readOAuthState(row.id)).tokens) return {};
      return {
        authProvider: createOAuthProvider(row.id, (url) => {
          live.authorizationUrl = url.href;
        }),
      };
    }
    return {};
  }

  #scheduleRetry(id: string, live: Live): void {
    if (this.#closed) return;
    live.attempt += 1;
    const delay = Math.min(MAX_BACKOFF_MS, 2_000 * 2 ** (live.attempt - 1));
    clearTimeout(live.retry);
    live.retry = setTimeout(() => void this.connect(id), delay);
    live.retry.unref?.();
  }

  /** Persist a new tool list, re-install the capability and re-apply affected bots. */
  async #toolsChanged(id: string, tools: McpToolInfo[]): Promise<void> {
    const row = await prisma.connection.findUnique({ where: { id } });
    if (!row) return;
    const changed = JSON.stringify(parseTools(row.toolsCache)) !== JSON.stringify(tools);
    if (changed) {
      await prisma.connection.update({
        where: { id },
        data: { toolsCache: JSON.stringify(tools) },
      });
    }
    this.#install(row, tools);
    if (changed) await this.reconfigureBots(id);
  }

  #install(row: ConnectionRow, tools: McpToolInfo[]): void {
    this.#runtime?.installCapability(
      createMcpCapability({
        slug: row.slug,
        name: row.name,
        url: row.url,
        tools,
        call: (tool, args, signal) => this.call(row.id, tool, args, signal),
      }),
    );
    // A server with many tools defers them; the model finds them via tool_search.
    if (tools.length > MCP_DEFER_THRESHOLD) {
      this.#runtime?.installCapability(createToolSearchCapability());
    }
  }

  #withdraw(slug: string): void {
    this.#runtime?.uninstallCapability(connectionCapabilityId(slug));
  }

  /** Re-apply the configuration of every bot using the connection. */
  async reconfigureBots(id: string): Promise<void> {
    const links = await prisma.botConnection.findMany({ where: { connectionId: id } });
    for (const link of links) {
      try {
        if (this.#runtime) await reconfigure(link.botId, this.#runtime);
      } catch (error) {
        logger.warn({ error, botId: link.botId }, "Failed to re-apply bot capabilities");
      }
    }
  }

  /** Call a tool, waiting briefly for a (re)connect. */
  async call(id: string, tool: string, args: Record<string, unknown>, signal?: AbortSignal) {
    let live = this.#entry(id);
    if (!live.connection) {
      await Promise.race([this.connect(id), new Promise((r) => setTimeout(r, 30_000))]);
      live = this.#entry(id);
    }
    if (!live.connection) {
      throw new Error(live.error ?? "The connection is not available right now");
    }
    return live.connection.call(tool, args, signal);
  }

  /** Start an OAuth sign-in; returns the consent URL to open. */
  async authorize(id: string): Promise<string | undefined> {
    const row = await prisma.connection.findUnique({ where: { id } });
    if (!row || row.authType !== "oauth") return undefined;
    const live = this.#entry(id);
    live.authorizationUrl = undefined;
    const provider = createOAuthProvider(id, (url) => {
      live.authorizationUrl = url.href;
    });
    const result = await mcpAuth(provider, { serverUrl: row.url });
    if (result === "AUTHORIZED") {
      await this.connect(id);
      return undefined;
    }
    return live.authorizationUrl;
  }

  /** The OAuth callback: exchange the code, then connect. Returns the connection id. */
  async finishAuthorization(state: string, code: string): Promise<string> {
    const id = await connectionForState(state);
    if (!id) throw new Error("Unknown or expired sign-in");
    const row = await prisma.connection.findUniqueOrThrow({ where: { id } });
    const provider = createOAuthProvider(id, () => undefined);
    await mcpAuth(provider, { serverUrl: row.url, authorizationCode: code });
    await this.connect(id);
    return id;
  }

  async hasTokens(id: string): Promise<boolean> {
    return Boolean((await readOAuthState(id)).tokens);
  }

  /** Close and forget a connection (removed by the owner). */
  async remove(id: string, slug: string): Promise<void> {
    const live = this.#live.get(id);
    this.#live.delete(id);
    clearTimeout(live?.retry);
    await live?.connection?.close().catch(() => undefined);
    this.#withdraw(slug);
  }

  async close(): Promise<void> {
    this.#closed = true;
    await Promise.allSettled(
      [...this.#live.values()].map(async (live) => {
        clearTimeout(live.retry);
        await live.connection?.close();
      }),
    );
    this.#live.clear();
  }

  #entry(id: string): Live {
    let live = this.#live.get(id);
    if (!live) {
      live = { status: "connecting", attempt: 0 };
      this.#live.set(id, live);
    }
    return live;
  }

  #set(id: string, state: ConnectionLiveState): void {
    const live = this.#entry(id);
    live.status = state.status;
    live.error = state.error;
    for (const listener of this.#listeners) {
      try {
        listener(id, state);
      } catch {
        // listeners must not break connections
      }
    }
  }
}

let manager: ConnectionManager | undefined;

export function getConnectionManager(): ConnectionManager {
  manager ??= new ConnectionManager();
  return manager;
}

/** Test seam. */
export function setConnectionManagerForTests(instance: ConnectionManager | undefined): void {
  manager = instance;
}
