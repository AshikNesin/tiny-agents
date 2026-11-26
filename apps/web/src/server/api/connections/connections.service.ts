import { asc, eq } from "drizzle-orm";
import { env } from "@groot/core/env";
import { Boom } from "@groot/core/errors";
import {
  connectMcp,
  mcpToolName,
  type McpToolInfo,
  type McpTransportKind,
} from "@tiny-agents/agent";
import { checkPublicUrl } from "@tiny-agents/sandbox";
import { connections, db, vaultItems, type Connection } from "../../db";
import { itemBotIds, setItemReach } from "../bots/bot-reach";
import { getConnectionManager } from "./connections.manager";
import type {
  ConnectionData,
  ConnectionAuthorization,
  ConnectionTestResult,
  ConnectionTool,
  ConnectionToolDetail,
  ToolCallResult,
} from "../../../shared/api/connections";
import { parseDisabledTools, parseTools } from "../bots/bot-toolkits";
import { createId } from "@groot/core/utils/id.utils";
import { appEnv } from "../../env";
import { hasSecretsKey, secretKeyProblem } from "../../crypto/secret-box";
import { deleteOwnHeaderSecret, sealOAuthState, writeOwnHeaderSecret } from "./connection-secrets";
import { vaultItemsChanged } from "../vault/vault.admin.service";
import type {
  CallToolDTO,
  CreateConnectionDTO,
  TestConnectionDTO,
  UpdateConnectionDTO,
  UpdateToolDTO,
} from "./connections.schema";

type Row = Connection & { botIds: string[] };

type ConnectionRow = Pick<Row, "slug" | "disabledTools">;

function toToolDTO(row: ConnectionRow, tool: McpToolInfo, disabled: Set<string>): ConnectionTool {
  return {
    name: mcpToolName(row.slug, tool.name),
    serverName: tool.name,
    label: tool.title ?? tool.name,
    description: tool.description ?? "",
    readOnly: Boolean(tool.readOnly),
    enabled: !disabled.has(tool.name),
  };
}

function toDTO(row: Row): ConnectionData {
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
    hasSecret: Boolean(row.secretRef || row.secretItemId || row.secretEnc),
    secretRef: row.secretRef,
    tools: parseTools(row.toolsCache).map((tool) => toToolDTO(row, tool, disabled)),
    allBots: row.allBots,
    botIds: row.botIds,
    status: live.status,
    ...(live.error ? { error: live.error } : {}),
    createdAt: row.createdAt,
  };
}

async function withBotIds(rows: Connection[]): Promise<Row[]> {
  const reach = await itemBotIds("connections", rows);
  return rows.map((row) => ({ ...row, botIds: reach.get(row.id) ?? [] }));
}

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
  const problem = secretKeyProblem(appEnv().SECRETS_KEY);
  if (problem) throw Boom.badRequest(problem);
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

async function setBots(connection: Connection, allBots: boolean, botIds: string[]): Promise<void> {
  const affected = await setItemReach("connections", { id: connection.id, allBots }, botIds);
  if (allBots !== connection.allBots) await getConnectionManager().reinstall(connection.id);
  await getConnectionManager().botsChanged(affected);
}

async function findRow(id: string): Promise<Connection> {
  const row = await db.query.connections.findFirst({ where: eq(connections.id, id) });
  if (!row) throw Boom.notFound("Connection not found");
  return row;
}

export async function list(): Promise<ConnectionData[]> {
  const rows = await db.query.connections.findMany({ orderBy: asc(connections.name) });
  return (await withBotIds(rows)).map(toDTO);
}

export async function get(id: string): Promise<ConnectionData> {
  const [row] = await withBotIds([await findRow(id)]);
  return toDTO(row!);
}

export async function create(data: CreateConnectionDTO): Promise<ConnectionData> {
  checkUrl(data.url);
  const manualClient = data.authType === "oauth" && data.clientId;
  if (data.authType === "header" || data.authType === "oauth") requireSecretsKey();
  const connectionId = createId();
  const slug = await uniqueSlug(data.name);
  db.transaction((tx) => {
    tx.insert(connections)
      .values({
        id: connectionId,
        name: data.name,
        slug,
        url: data.url,
        transport: data.transport,
        authType: data.authType,
        headerName: data.authType === "header" ? (data.headerName ?? null) : null,
        allBots: data.allBots ?? data.botIds === undefined,
        oauthEnc: manualClient
          ? sealOAuthState(connectionId, {
              client: {
                client_id: data.clientId,
                ...(data.clientSecret ? { client_secret: data.clientSecret } : {}),
              },
            })
          : null,
      })
      .run();
    if (data.authType === "header" && data.secret) {
      const target = { id: connectionId, name: data.name, slug, url: data.url, secretItemId: null };
      writeOwnHeaderSecret(tx, target, data.secret, "connections");
    }
  });
  if (data.authType === "header" && data.secret) vaultItemsChanged();
  const id = connectionId;
  await getConnectionManager().rowChanged(id);
  const created = await findRow(id);
  if (data.botIds) await setBots(created, created.allBots, data.botIds);
  else await getConnectionManager().botsChanged((await get(id)).botIds);
  return get(id);
}

export async function update(id: string, data: UpdateConnectionDTO): Promise<ConnectionData> {
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
    if (item.audience !== "bots") {
      throw Boom.badRequest(`Vault item "${data.secretRef}" is used by the app, not by bots`);
    }
  }
  const movesHost = data.url !== undefined && new URL(data.url).host !== new URL(current.url).host;
  const dropSecret = movesHost && current.authType === "header" && data.secret === undefined;
  const dropRef = dropSecret && typeof data.secretRef !== "string";
  const writesSecret = data.secret !== undefined && current.authType === "header";
  const changes = {
    ...(data.name !== undefined ? { name: data.name } : {}),
    ...(data.url !== undefined ? { url: data.url } : {}),
    ...(data.headerName !== undefined && current.authType === "header"
      ? { headerName: data.headerName }
      : {}),
    ...(writesSecret ? { secretRef: null } : {}),
    ...(data.secretRef !== undefined && data.secret === undefined && current.authType === "header"
      ? { secretRef: data.secretRef }
      : {}),
    ...(dropSecret ? { secretEnc: null, secretItemId: null } : {}),
    ...(dropRef ? { secretRef: null } : {}),
  };
  db.transaction((tx) => {
    const row = tx.select().from(connections).where(eq(connections.id, id)).get();
    if (!row) throw Boom.notFound("Connection not found");
    if (dropSecret && row.secretItemId) deleteOwnHeaderSecret(tx, row.secretItemId, row.slug);
    if (Object.keys(changes).length > 0) {
      tx.update(connections).set(changes).where(eq(connections.id, id)).run();
    }
    if (writesSecret) {
      const target = { ...row, ...changes, secretItemId: dropSecret ? null : row.secretItemId };
      writeOwnHeaderSecret(tx, target, data.secret!, "connections");
    }
  });
  if (writesSecret || dropSecret) vaultItemsChanged();
  if (reconnect) await getConnectionManager().rowChanged(id);
  if (data.botIds !== undefined || data.allBots !== undefined) {
    const row = await findRow(id);
    await setBots(row, data.allBots ?? row.allBots, data.botIds ?? current.botIds);
  }
  return get(id);
}

export async function remove(id: string): Promise<void> {
  const connection = await get(id);
  const ownItem = db.transaction((tx) => {
    const row = tx.select().from(connections).where(eq(connections.id, id)).get();
    tx.delete(connections).where(eq(connections.id, id)).run();
    if (row?.secretItemId) deleteOwnHeaderSecret(tx, row.secretItemId, row.slug);
    return row?.secretItemId;
  });
  if (ownItem) vaultItemsChanged();
  await getConnectionManager().remove(id, connection.slug, connection.botIds);
}

export async function reconnect(id: string): Promise<ConnectionData> {
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

export async function getTool(id: string, serverName: string): Promise<ConnectionToolDetail> {
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

export async function updateTool(
  id: string,
  serverName: string,
  data: UpdateToolDTO,
): Promise<ConnectionToolDetail> {
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

export async function callTool(
  id: string,
  serverName: string,
  data: CallToolDTO,
): Promise<ToolCallResult> {
  await findTool(id, serverName);
  const started = Date.now();
  try {
    const result = await getConnectionManager().call(id, serverName, data.arguments);
    return { result, durationMs: Date.now() - started };
  } catch (error) {
    throw Boom.badRequest(`Call failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function authorize(id: string, initiator: number): Promise<ConnectionAuthorization> {
  const connection = await get(id);
  if (connection.authType !== "oauth") throw Boom.badRequest("This connection doesn't use sign-in");
  requireSecretsKey();
  try {
    const authorizationUrl = await getConnectionManager().authorize(id, initiator);
    return authorizationUrl ? { authorizationUrl } : {};
  } catch (error) {
    throw Boom.badRequest(
      `Sign-in failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function test(data: TestConnectionDTO): Promise<ConnectionTestResult> {
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
