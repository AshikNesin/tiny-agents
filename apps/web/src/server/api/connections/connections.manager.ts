/**
 * ConnectionManager (issue #1 M3): owns the whole life of every remote MCP
 * connection, from its row to the live client and the capability bots see.
 *
 * - At boot each connection's capability is installed from its cached tool
 *   list right away (so interrupted calls can resume and bots keep their
 *   tools), then connected in the background — `/health` never waits on it.
 * - A row change (created, url or secret edited) starts a fresh connect
 *   attempt that supersedes any in flight: every attempt carries the entry's
 *   generation and discards its own result once a newer one has started or
 *   the connection was removed. Dropped connections reconnect with backoff.
 * - A tool-list change re-installs the capability and Reconciles the bots
 *   that use it (their permissions are per tool). Bots linked or unlinked by
 *   the owner are Reconciled here too, each bot once per change, however
 *   many steps of the change asked for it.
 * - `tool_search` is installed while any connection defers its tools
 *   (`needsToolSearch`, bot-toolkits.ts) and uninstalled once none does.
 * - A server that needs (re)authorization marks the connection
 *   "needs_auth" and withdraws its tools until the owner signs in (D11).
 * - Tools the owner turned off on the connection are never installed, so no
 *   bot sees them; the dashboard playground still calls them directly.
 */
import { eq } from "drizzle-orm";
import { Boom } from "@groot/core/errors";
import { logger } from "@groot/core/logger";
import {
  connectMcp,
  createMcpCapability,
  createToolSearchCapability,
  isUnauthorized,
  mcpAuth,
  type AgentRuntime,
  type McpConnection,
  type McpToolInfo,
  type McpTransportKind,
} from "@tiny-agents/agent";
import { botConnections, connections, db, type Connection } from "../../db";
import { reconcileBotConversation } from "../bots/bots.conversation";
import {
  connectionCapabilityId,
  connectionTools,
  needsToolSearch,
  parseTools,
  TOOL_SEARCH_TOOLKIT,
} from "../bots/bot-toolkits";
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
  /** Bumped by every fresh attempt and by removal; an attempt that sees another value is stale. */
  generation: number;
  retry?: ReturnType<typeof setTimeout>;
  attempt: number;
  authorizationUrl?: string;
}

const MAX_BACKOFF_MS = 5 * 60_000;
/** How long a row change waits for its connect attempt before answering. */
const CONNECT_WAIT_MS = 15_000;
/** How long a tool call waits for a (re)connect. */
const CALL_WAIT_MS = 30_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref?.());

export class ConnectionManager {
  readonly #live = new Map<string, Live>();
  readonly #listeners = new Set<(id: string, state: ConnectionLiveState) => void>();
  /** Connections whose installed tools are deferred behind `tool_search`. */
  readonly #deferred = new Set<string>();
  #toolSearchInstalled = false;
  /** Bots waiting for one Reconcile; flushed together on the next tick. */
  readonly #reconcilePending = new Set<string>();
  #reconcileFlush: Promise<void> | undefined;
  #runtime: ManagedRuntime | undefined;
  #closed = false;

  /** Install cached capabilities and start connecting everything (non-blocking). */
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

  /** Connect unless an attempt is already running; resolves when that attempt settles. */
  connect(id: string): Promise<void> {
    const live = this.#entry(id);
    return live.connecting ?? this.#begin(id, live);
  }

  /**
   * The row changed (created, or its url, auth or secret edited): connect
   * afresh, superseding any attempt in flight, and wait for the result up to
   * `waitMs` so the caller can report the live state.
   */
  async rowChanged(id: string, waitMs = CONNECT_WAIT_MS): Promise<void> {
    const live = this.#entry(id);
    await Promise.race([this.#begin(id, live), sleep(waitMs)]);
  }

  /** Links between bots and connections changed: Reconcile each bot once. */
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
    // Superseded by a newer attempt, removed, or shutting down: this attempt
    // owns nothing any more and must not write state or install anything.
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
        this.#set(id, { status: "error", error: error.message });
        return;
      }
      if (row.authType === "oauth" && isUnauthorized(error)) {
        this.#withdraw(id, row.slug);
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
    // The header value is a vault item (Q4): the one the owner picked, else the connection's own.
    const handle =
      row.secretRef ?? (row.secretItemId ? ownHeaderHandle(row.secretItemId) : undefined);
    if (row.authType === "header" && row.headerName && handle) {
      return {
        headers: { [row.headerName]: await resolveConnectionSecret(handle, row.slug) },
      };
    }
    if (row.authType === "header" && row.secretEnc) {
      // A pre-Q4 value the startup import could not move yet (it says why in the log).
      throw new SecretLockedError(
        "unreadable",
        "This connection's header value hasn't moved into the vault yet: check SECRETS_KEY and restart, or enter it again.",
      );
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
    if (this.#closed || this.#live.get(id) !== live) return;
    live.attempt += 1;
    const delay = Math.min(MAX_BACKOFF_MS, 2_000 * 2 ** (live.attempt - 1));
    clearTimeout(live.retry);
    live.retry = setTimeout(() => void this.connect(id), delay);
    live.retry.unref?.();
  }

  /** Persist a new tool list, re-install the capability and Reconcile the bots using it. */
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
    // A server with many tools defers them; the model finds them via tool_search.
    if (needsToolSearch(tools)) this.#deferred.add(row.id);
    else this.#deferred.delete(row.id);
    this.#syncToolSearch();
  }

  #withdraw(id: string, slug: string): void {
    this.#runtime?.uninstallCapability(connectionCapabilityId(slug));
    this.#deferred.delete(id);
    this.#syncToolSearch();
  }

  /** `tool_search` lives exactly as long as some connection defers its tools. */
  #syncToolSearch(): void {
    const wanted = this.#deferred.size > 0;
    if (wanted === this.#toolSearchInstalled) return;
    if (wanted) this.#runtime?.installCapability(createToolSearchCapability());
    else this.#runtime?.uninstallCapability(TOOL_SEARCH_TOOLKIT);
    this.#toolSearchInstalled = wanted;
  }

  /**
   * Re-install from the cached tool list after the owner turned tools on or
   * off, then Reconcile the bots that use the connection. A connection
   * waiting for sign-in stays withdrawn.
   */
  async reinstall(id: string): Promise<void> {
    const row = await findConnection(id);
    if (!row) return;
    if (this.status(id).status !== "needs_auth") this.#install(row, parseTools(row.toolsCache));
    await this.#reconcileLinked(id);
  }

  /** Reconcile every bot linked to the connection. */
  async #reconcileLinked(id: string): Promise<void> {
    const links = await db
      .select({ botId: botConnections.botId })
      .from(botConnections)
      .where(eq(botConnections.connectionId, id));
    await this.#reconcile(links.map((link) => link.botId));
  }

  /**
   * Reconcile each bot once, however many steps of one change asked: the
   * requests of a tick are flushed together on the next one.
   */
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

  /** Call a tool, waiting briefly for a (re)connect. */
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

  /** Start an OAuth sign-in; returns the consent URL to open. */
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

  /** The OAuth callback: exchange the code, then connect. Returns the connection id. */
  async finishAuthorization(state: string, code: string): Promise<string> {
    const id = await connectionForState(state);
    if (!id) throw new Error("Unknown or expired sign-in");
    const row = await findConnection(id);
    // Prisma's findUniqueOrThrow (P2025 → 404).
    if (!row) throw Boom.notFound("Record not found");
    const provider = createOAuthProvider(id, () => undefined);
    await mcpAuth(provider, { serverUrl: row.url, authorizationCode: code });
    await this.rowChanged(id);
    return id;
  }

  async hasTokens(id: string): Promise<boolean> {
    return Boolean((await readOAuthState(id)).tokens);
  }

  /**
   * The connection was deleted: cancel any attempt in flight, close the
   * client, withdraw its tools and Reconcile the bots that used it. The
   * entry is gone for good; a stale attempt never brings it back.
   */
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
    this.#withdraw(id, slug);
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

  /** Record and announce a state; a removed connection has none to record. */
  #set(id: string, state: ConnectionLiveState): void {
    const live = this.#live.get(id);
    if (!live) return;
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

/** The process's manager (`app().connectionManager`), made on first use. */
export function getConnectionManager(): ConnectionManager {
  return (app().connectionManager ??= new ConnectionManager());
}

/** Test seam. */
export function setConnectionManagerForTests(instance: ConnectionManager | undefined): void {
  app().connectionManager = instance;
}
