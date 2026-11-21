import { eq } from "drizzle-orm";
import { Boom } from "@groot/core/errors";
import { logger } from "@groot/core/logger";
import {
  connectMcp,
  createMcpCapability,
  isUnauthorized,
  mcpAuth,
  type AgentRuntime,
  type McpConnection,
  type McpToolInfo,
  type McpTransportKind,
} from "@tiny-agents/agent";
import { botConnections, connections, db, type Connection } from "../../db";
import { reconcileBotConversation } from "../bots/bots.conversation";
import { connectionCapabilityId, connectionTools, parseTools } from "../bots/bot-toolkits";
import { connectionForState, createOAuthProvider, readOAuthState } from "./oauth";
import { SecretLockedError } from "../../crypto/secret-box";
import { ownHeaderHandle } from "./connection-secrets";
import { resolveConnectionSecret } from "../vault/vault.service";
import { app } from "../../app-root";
import type { ConnectionStatus } from "../../../shared/api/connections";

export interface ConnectionLiveState {
  status: ConnectionStatus;
  error?: string;
}

type ConnectionRow = Connection;

const findConnection = (id: string) =>
  db.query.connections.findFirst({ where: eq(connections.id, id) });

type ManagedRuntime = Pick<
  AgentRuntime,
  "installCapability" | "uninstallCapability" | "configure" | "catalog"
>;

interface Live extends ConnectionLiveState {
  connection?: McpConnection;
  connecting?: Promise<void>;
  generation: number;
  retry?: ReturnType<typeof setTimeout>;
  attempt: number;
  authorizationUrl?: string;
}

const MAX_BACKOFF_MS = 5 * 60_000;
const CONNECT_WAIT_MS = 15_000;
const CALL_WAIT_MS = 30_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref?.());

export class ConnectionManager {
  readonly #live = new Map<string, Live>();
  readonly #listeners = new Set<(id: string, state: ConnectionLiveState) => void>();
  readonly #reconcilePending = new Set<string>();
  #reconcileFlush: Promise<void> | undefined;
  #runtime: ManagedRuntime | undefined;
  #closed = false;

  async start(runtime: ManagedRuntime): Promise<void> {
    this.#runtime = runtime;
    const rows = await db.select().from(connections);
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

  connect(id: string): Promise<void> {
    const live = this.#entry(id);
    return live.connecting ?? this.#begin(id, live);
  }

  async rowChanged(id: string, waitMs = CONNECT_WAIT_MS): Promise<void> {
    const live = this.#entry(id);
    await Promise.race([this.#begin(id, live), sleep(waitMs)]);
  }

  botsChanged(botIds: Iterable<string>): Promise<void> {
    return this.#reconcile(botIds);
  }

  #begin(id: string, live: Live): Promise<void> {
    live.generation += 1;
    const generation = live.generation;
    clearTimeout(live.retry);
    live.connecting = this.#connect(id, live, generation).finally(() => {
      if (live.generation === generation) live.connecting = undefined;
    });
    return live.connecting;
  }

  async #connect(id: string, live: Live, generation: number): Promise<void> {
    const stale = () =>
      this.#closed || live.generation !== generation || this.#live.get(id) !== live;
    const row = await findConnection(id);
    if (!row || stale()) return;
    this.#set(id, { status: "connecting" });
    const previous = live.connection;
    live.connection = undefined;
    await previous?.close().catch(() => undefined);
    if (stale()) return;
    let connection: McpConnection | undefined;
    try {
      const auth = await this.#auth(row, live);
      if (stale()) return;
      connection = await connectMcp({
        url: row.url,
        transport: row.transport as McpTransportKind,
        ...auth,
        onToolsChanged: (tools) => {
          if (live.connection === connection && !stale()) void this.#toolsChanged(id, tools);
        },
        onClose: () => {
          if (live.connection !== connection || stale()) return;
          live.connection = undefined;
          this.#set(id, { status: "error", error: "Connection closed" });
          this.#scheduleRetry(id, live);
        },
      });
      if (stale()) {
        await connection.close().catch(() => undefined);
        return;
      }
      live.connection = connection;
      live.attempt = 0;
      live.authorizationUrl = undefined;
      if (connection.transport !== row.transport) {
        await db
          .update(connections)
          .set({ transport: connection.transport })
          .where(eq(connections.id, id));
      }
      await this.#toolsChanged(id, connection.tools);
      if (stale()) return;
      this.#set(id, { status: "connected" });
    } catch (error) {
      if (stale()) return;
      if (error instanceof SecretLockedError) {
        if (row.authType === "oauth" && error.reason !== "no_key") {
          this.#withdraw(row.slug);
          this.#set(id, {
            status: "needs_auth",
            error: "The saved sign-in can't be read anymore. Sign in again.",
          });
          return;
        }
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
    const handle =
      row.authType !== "header"
        ? undefined
        : (row.secretRef ?? (row.secretItemId ? ownHeaderHandle(row.secretItemId) : undefined));
    if (row.authType === "header" && row.headerName && handle) {
      const host = row.secretRef ? undefined : new URL(row.url).hostname;
      return {
        headers: { [row.headerName]: await resolveConnectionSecret(handle, row.slug, host) },
      };
    }
    if (row.authType === "header" && row.secretEnc) {
      throw new SecretLockedError(
        "unreadable",
        "This connection's header value hasn't moved into the vault yet: check SECRETS_KEY and restart, or enter it again.",
      );
    }
    if (row.authType === "oauth") {
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
    if (this.#closed || this.#live.get(id) !== live) return;
    live.attempt += 1;
    const delay = Math.min(MAX_BACKOFF_MS, 2_000 * 2 ** (live.attempt - 1));
    clearTimeout(live.retry);
    live.retry = setTimeout(() => void this.connect(id), delay);
    live.retry.unref?.();
  }

  async #toolsChanged(id: string, tools: McpToolInfo[]): Promise<void> {
    const row = await findConnection(id);
    if (!row || !this.#live.has(id)) return;
    const changed = JSON.stringify(parseTools(row.toolsCache)) !== JSON.stringify(tools);
    if (changed) {
      await db
        .update(connections)
        .set({ toolsCache: JSON.stringify(tools) })
        .where(eq(connections.id, id));
    }
    this.#install(row, tools);
    if (changed) await this.#reconcileLinked(id);
  }

  #install(row: ConnectionRow, allTools: McpToolInfo[]): void {
    const tools = connectionTools(row, allTools);
    this.#runtime?.installCapability(
      createMcpCapability({
        slug: row.slug,
        name: row.name,
        url: row.url,
        tools,
        call: (tool, args, signal) => this.call(row.id, tool, args, signal),
      }),
    );
  }

  #withdraw(slug: string): void {
    this.#runtime?.uninstallCapability(connectionCapabilityId(slug));
  }

  async reinstall(id: string): Promise<void> {
    const row = await findConnection(id);
    if (!row) return;
    if (this.status(id).status !== "needs_auth") this.#install(row, parseTools(row.toolsCache));
    await this.#reconcileLinked(id);
  }

  async #reconcileLinked(id: string): Promise<void> {
    const links = await db
      .select({ botId: botConnections.botId })
      .from(botConnections)
      .where(eq(botConnections.connectionId, id));
    await this.#reconcile(links.map((link) => link.botId));
  }

  #reconcile(botIds: Iterable<string>): Promise<void> {
    for (const botId of botIds) this.#reconcilePending.add(botId);
    if (this.#reconcilePending.size === 0) return Promise.resolve();
    this.#reconcileFlush ??= sleep(0).then(async () => {
      const batch = [...this.#reconcilePending];
      this.#reconcilePending.clear();
      this.#reconcileFlush = undefined;
      for (const botId of batch) {
        try {
          if (this.#runtime) await reconcileBotConversation(botId, this.#runtime);
        } catch (error) {
          logger.warn({ error, botId }, "Failed to re-apply bot capabilities");
        }
      }
    });
    return this.#reconcileFlush;
  }

  async call(id: string, tool: string, args: Record<string, unknown>, signal?: AbortSignal) {
    let live = this.#entry(id);
    if (!live.connection) {
      await Promise.race([this.connect(id), sleep(CALL_WAIT_MS)]);
      live = this.#entry(id);
    }
    if (!live.connection) {
      throw new Error(live.error ?? "The connection is not available right now");
    }
    return live.connection.call(tool, args, signal);
  }

  async authorize(id: string): Promise<string | undefined> {
    const row = await findConnection(id);
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

  async finishAuthorization(state: string, code: string): Promise<string> {
    const id = await connectionForState(state);
    if (!id) throw new Error("Unknown or expired sign-in");
    const row = await findConnection(id);
    if (!row) throw Boom.notFound("Record not found");
    const provider = createOAuthProvider(id, () => undefined);
    await mcpAuth(provider, { serverUrl: row.url, authorizationCode: code });
    await this.rowChanged(id);
    return id;
  }

  async hasTokens(id: string): Promise<boolean> {
    return Boolean((await readOAuthState(id)).tokens);
  }

  async remove(id: string, slug: string, botIds: Iterable<string> = []): Promise<void> {
    const live = this.#live.get(id);
    this.#live.delete(id);
    if (live) {
      live.generation += 1;
      clearTimeout(live.retry);
      const connection = live.connection;
      live.connection = undefined;
      await connection?.close().catch(() => undefined);
    }
    this.#withdraw(slug);
    await this.#reconcile(botIds);
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
      live = { status: "connecting", attempt: 0, generation: 0 };
      this.#live.set(id, live);
    }
    return live;
  }

  #set(id: string, state: ConnectionLiveState): void {
    const live = this.#live.get(id);
    if (!live) return;
    live.status = state.status;
    live.error = state.error;
    for (const listener of this.#listeners) {
      try {
        listener(id, state);
      } catch {}
    }
  }
}

export function getConnectionManager(): ConnectionManager {
  return (app().connectionManager ??= new ConnectionManager());
}

export function setConnectionManagerForTests(instance: ConnectionManager | undefined): void {
  app().connectionManager = instance;
}
