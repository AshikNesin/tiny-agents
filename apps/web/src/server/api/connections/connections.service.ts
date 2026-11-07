/**
 * Remote MCP connections (issue #1 M3): rows, DTOs, validation and the
 * playground. Everything live (connecting, tools, Reconciling bots, sign-in)
 * is the ConnectionManager's; this module tells it what changed. Secrets
 * are write-only from the API's point of view.
 */
import { asc, eq, inArray } from "drizzle-orm";
import { env } from "@groot/core/env";
import { Boom } from "@groot/core/errors";
import {
  checkPublicUrl,
  connectMcp,
  mcpToolName,
  type McpCallResult,
  type McpToolInfo,
  type McpTransportKind,
} from "@tiny-agents/agent";
import {
  botConnections,
  bots as botsTable,
  connections,
  db,
  vaultItems,
  type Connection,
} from "../../db";
import { getConnectionManager, type ConnectionStatus } from "./connections.manager";
import { parseDisabledTools, parseTools } from "../bots/bot-toolkits";
import { createId } from "@groot/core/utils/id.utils";
import { hasSecretsKey } from "../../crypto/secret-box";
import { sealHeaderSecret, sealOAuthState } from "./connection-secrets";
import type {
  CallToolDTO,
  CreateConnectionDTO,
  TestConnectionDTO,
  UpdateConnectionDTO,
  UpdateToolDTO,
} from "./connections.schema";

export interface ConnectionDTO {
  id: string;
  name: string;
  slug: string;
  url: string;
  transport: string;
  authType: string;
  headerName: string | null;
  hasSecret: boolean;
  /** Vault handle the header value is read from, when set. */
  secretRef: string | null;
  /** The server's tools from the last listing, including those turned off. */
  tools: ConnectionToolDTO[];
  botIds: string[];
  status: ConnectionStatus;
  error?: string;
  createdAt: Date;
}

interface ConnectionToolDTO {
  /** As bots see it: `mcp__<slug>__<tool>`. */
  name: string;
  /** As the server names it; the id in tool routes. */
  serverName: string;
  label: string;
  description: string;
  readOnly: boolean;
  /** Off: no bot gets the tool, whatever its own permissions say. */
  enabled: boolean;
}

/** One tool with everything the server declared about it. */
export interface ConnectionToolDetailDTO extends ConnectionToolDTO {
  idempotent: boolean;
  destructive: boolean;
  openWorld: boolean;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  connection: Pick<ConnectionDTO, "id" | "name" | "slug" | "status">;
}

type Row = Connection & {
  bots: { botId: string }[];
};

type ConnectionRow = Pick<Row, "slug" | "disabledTools">;

function toToolDTO(row: ConnectionRow, tool: McpToolInfo, disabled: Set<string>) {
  return {
    name: mcpToolName(row.slug, tool.name),
    serverName: tool.name,
    label: tool.title ?? tool.name,
    description: tool.description ?? "",
    readOnly: Boolean(tool.readOnly),
    enabled: !disabled.has(tool.name),
  };
}

function toDTO(row: Row): ConnectionDTO {
  const live = getConnectionManager().status(row.id);
  const disabled = parseDisabledTools(row.disabledTools);
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    url: row.url,
    transport: row.transport,
    authType: row.authType,
    headerName: row.headerName,
    hasSecret: Boolean(row.secretEnc || row.secretRef),
    secretRef: row.secretRef,
    tools: parseTools(row.toolsCache).map((tool) => toToolDTO(row, tool, disabled)),
    botIds: row.bots.map((link) => link.botId),
    status: live.status,
    ...(live.error ? { error: live.error } : {}),
    createdAt: row.createdAt,
  };
}

const withBots = { bots: { columns: { botId: true } } } as const;

/** Production only talks to public servers; dev/test may use local ones. */
function checkUrl(url: string): void {
  if (env.NODE_ENV !== "production") return;
  try {
    checkPublicUrl(url);
  } catch (error) {
    throw Boom.badRequest((error as Error).message);
  }
}

function requireSecretsKey(): void {
  if (!hasSecretsKey()) {
    throw Boom.badRequest("Set SECRETS_KEY on the server before adding a connection with auth.");
  }
}

async function uniqueSlug(name: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 20) || "server";
  for (let n = 1; ; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    if (!(await db.query.connections.findFirst({ where: eq(connections.slug, slug) }))) {
      return slug;
    }
  }
}

/** Replace the connection's bot links; the manager Reconciles every bot that gained or lost it. */
async function setBots(connectionId: string, botIds: string[]): Promise<void> {
  const before = await db
    .select()
    .from(botConnections)
    .where(eq(botConnections.connectionId, connectionId));
  const bots =
    botIds.length > 0
      ? await db.select({ id: botsTable.id }).from(botsTable).where(inArray(botsTable.id, botIds))
      : [];
  db.transaction((tx) => {
    tx.delete(botConnections).where(eq(botConnections.connectionId, connectionId)).run();
    if (bots.length > 0) {
      tx.insert(botConnections)
        .values(bots.map((bot) => ({ botId: bot.id, connectionId })))
        .run();
    }
  });
  const affected = new Set([...before.map((link) => link.botId), ...bots.map((bot) => bot.id)]);
  await getConnectionManager().botsChanged(affected);
}

export async function list(): Promise<ConnectionDTO[]> {
  const rows = await db.query.connections.findMany({
    with: withBots,
    orderBy: asc(connections.name),
  });
  return rows.map(toDTO);
}

export async function get(id: string): Promise<ConnectionDTO> {
  const row = await db.query.connections.findFirst({
    where: eq(connections.id, id),
    with: withBots,
  });
  if (!row) throw Boom.notFound("Connection not found");
  return toDTO(row);
}

export async function create(data: CreateConnectionDTO): Promise<ConnectionDTO> {
  checkUrl(data.url);
  const manualClient = data.authType === "oauth" && data.clientId;
  if (data.authType === "header" || data.authType === "oauth") requireSecretsKey();
  // The id is chosen first: each sealed value is bound to its row.
  const connectionId = createId();
  const [row] = await db
    .insert(connections)
    .values({
      id: connectionId,
      name: data.name,
      slug: await uniqueSlug(data.name),
      url: data.url,
      transport: data.transport,
      authType: data.authType,
      headerName: data.authType === "header" ? (data.headerName ?? null) : null,
      secretEnc:
        data.authType === "header" && data.secret
          ? sealHeaderSecret(connectionId, data.secret)
          : null,
      oauthEnc: manualClient
        ? sealOAuthState(connectionId, {
            client: {
              client_id: data.clientId,
              ...(data.clientSecret ? { client_secret: data.clientSecret } : {}),
            },
          })
        : null,
    })
    .returning();
  const id = row!.id;
  await getConnectionManager().rowChanged(id);
  if (data.botIds) await setBots(id, data.botIds);
  return get(id);
}

export async function update(id: string, data: UpdateConnectionDTO): Promise<ConnectionDTO> {
  const current = await get(id);
  if (data.url) checkUrl(data.url);
  if (data.secret) requireSecretsKey();
  const reconnect =
    data.url !== undefined ||
    data.secret !== undefined ||
    data.headerName !== undefined ||
    data.secretRef !== undefined;
  if (data.secretRef) {
    const item = await db.query.vaultItems.findFirst({
      where: eq(vaultItems.handle, data.secretRef),
    });
    if (!item) throw Boom.badRequest(`No vault item "${data.secretRef}"`);
  }
  const changes = {
    ...(data.name !== undefined ? { name: data.name } : {}),
    ...(data.url !== undefined ? { url: data.url } : {}),
    ...(data.headerName !== undefined && current.authType === "header"
      ? { headerName: data.headerName }
      : {}),
    ...(data.secret !== undefined && current.authType === "header"
      ? { secretEnc: sealHeaderSecret(id, data.secret), secretRef: null }
      : {}),
    ...(data.secretRef !== undefined && data.secret === undefined && current.authType === "header"
      ? { secretRef: data.secretRef }
      : {}),
  };
  // Drizzle refuses an empty SET (e.g. a PATCH that only changes botIds).
  if (Object.keys(changes).length > 0) {
    await db.update(connections).set(changes).where(eq(connections.id, id));
  }
  if (reconnect) await getConnectionManager().rowChanged(id);
  if (data.botIds) await setBots(id, data.botIds);
  return get(id);
}

export async function remove(id: string): Promise<void> {
  const connection = await get(id);
  // The row (and its bot links) go first, so a connect attempt racing the
  // delete finds nothing to connect and the Reconcile sees the links gone.
  await db.delete(connections).where(eq(connections.id, id));
  await getConnectionManager().remove(id, connection.slug, connection.botIds);
}

export async function reconnect(id: string): Promise<ConnectionDTO> {
  await get(id);
  await getConnectionManager().rowChanged(id);
  return get(id);
}

async function findTool(id: string, serverName: string) {
  const row = await db.query.connections.findFirst({ where: eq(connections.id, id) });
  if (!row) throw Boom.notFound("Connection not found");
  const tool = parseTools(row.toolsCache).find((candidate) => candidate.name === serverName);
  if (!tool) throw Boom.notFound("Tool not found");
  return { row, tool };
}

export async function getTool(id: string, serverName: string): Promise<ConnectionToolDetailDTO> {
  const { row, tool } = await findTool(id, serverName);
  return {
    ...toToolDTO(row, tool, parseDisabledTools(row.disabledTools)),
    idempotent: Boolean(tool.idempotent),
    destructive: Boolean(tool.destructive),
    openWorld: Boolean(tool.openWorld),
    inputSchema:
      tool.inputSchema && typeof tool.inputSchema === "object"
        ? tool.inputSchema
        : { type: "object" },
    ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
    connection: {
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: getConnectionManager().status(row.id).status,
    },
  };
}

/** Turn a tool on or off for every bot using the connection. */
export async function updateTool(
  id: string,
  serverName: string,
  data: UpdateToolDTO,
): Promise<ConnectionToolDetailDTO> {
  const { row } = await findTool(id, serverName);
  const disabled = parseDisabledTools(row.disabledTools);
  if (disabled.has(serverName) === !data.enabled) return getTool(id, serverName);
  if (data.enabled) disabled.delete(serverName);
  else disabled.add(serverName);
  await db
    .update(connections)
    .set({ disabledTools: JSON.stringify([...disabled].sort()) })
    .where(eq(connections.id, id));
  await getConnectionManager().reinstall(id);
  return getTool(id, serverName);
}

/**
 * Playground: call a tool on the live connection as the owner. Works for
 * tools turned off for bots, so the owner can try one before turning it on.
 */
export async function callTool(
  id: string,
  serverName: string,
  data: CallToolDTO,
): Promise<{ result: McpCallResult; durationMs: number }> {
  await findTool(id, serverName);
  const started = Date.now();
  try {
    const result = await getConnectionManager().call(id, serverName, data.arguments);
    return { result, durationMs: Date.now() - started };
  } catch (error) {
    throw Boom.badRequest(`Call failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Start the OAuth sign-in: the consent URL to open, or none when already authorized. */
export async function authorize(id: string): Promise<{ authorizationUrl?: string }> {
  const connection = await get(id);
  if (connection.authType !== "oauth") throw Boom.badRequest("This connection doesn't use sign-in");
  requireSecretsKey();
  try {
    const authorizationUrl = await getConnectionManager().authorize(id);
    return authorizationUrl ? { authorizationUrl } : {};
  } catch (error) {
    throw Boom.badRequest(
      `Sign-in failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Connect once with the given settings and list the server's tools, without saving. */
export async function test(data: TestConnectionDTO) {
  checkUrl(data.url);
  try {
    const connection = await connectMcp({
      url: data.url,
      transport: data.transport as McpTransportKind,
      ...(data.headerName && data.secret ? { headers: { [data.headerName]: data.secret } } : {}),
    });
    await connection.close();
    return {
      transport: connection.transport,
      tools: connection.tools.map((tool) => ({
        name: tool.name,
        label: tool.title ?? tool.name,
        description: tool.description ?? "",
        readOnly: Boolean(tool.readOnly),
      })),
    };
  } catch (error) {
    throw Boom.badRequest(
      `Couldn't connect: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
