/**
 * Remote MCP connections (issue #1 M3): CRUD, bot enablement, test and
 * sign-in. Live state (connected / needs sign-in / error) comes from the
 * ConnectionManager; secrets are write-only from the API's point of view.
 */
import { prisma } from "@groot/core/database";
import { Boom } from "@groot/core/errors";
import { checkPublicUrl, connectMcp, mcpToolName, type McpTransportKind } from "@tiny-agents/agent";
import { reconcileBotConversation } from "../bots/bots.conversation";
import { getAgentRuntime } from "../bots/bots.runtime";
import { getConnectionManager, parseTools, type ConnectionStatus } from "./connections.manager";
import { encryptJson, encryptSecret, hasSecretsKey } from "./secrets";
import type {
  CreateConnectionDTO,
  TestConnectionDTO,
  UpdateConnectionDTO,
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
  /** Tools as bots see them (`mcp__<slug>__<tool>`), from the last listing. */
  tools: { name: string; label: string; description: string; readOnly: boolean }[];
  botIds: string[];
  status: ConnectionStatus;
  error?: string;
  createdAt: Date;
}

type Row = NonNullable<Awaited<ReturnType<typeof prisma.connection.findUnique>>> & {
  bots: { botId: string }[];
};

function toDTO(row: Row): ConnectionDTO {
  const live = getConnectionManager().status(row.id);
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    url: row.url,
    transport: row.transport,
    authType: row.authType,
    headerName: row.headerName,
    hasSecret: Boolean(row.secretEnc),
    tools: parseTools(row.toolsCache).map((tool) => ({
      name: mcpToolName(row.slug, tool.name),
      label: tool.title ?? tool.name,
      description: tool.description ?? "",
      readOnly: Boolean(tool.readOnly),
    })),
    botIds: row.bots.map((link) => link.botId),
    status: live.status,
    ...(live.error ? { error: live.error } : {}),
    createdAt: row.createdAt,
  };
}

const withBots = { bots: { select: { botId: true } } } as const;

/** Production only talks to public servers; dev/test may use local ones. */
function checkUrl(url: string): void {
  if (process.env.NODE_ENV !== "production") return;
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
    if (!(await prisma.connection.findUnique({ where: { slug } }))) return slug;
  }
}

async function setBots(connectionId: string, botIds: string[]): Promise<void> {
  const before = await prisma.botConnection.findMany({ where: { connectionId } });
  const bots = await prisma.bot.findMany({ where: { id: { in: botIds } }, select: { id: true } });
  await prisma.$transaction([
    prisma.botConnection.deleteMany({ where: { connectionId } }),
    prisma.botConnection.createMany({ data: bots.map((bot) => ({ botId: bot.id, connectionId })) }),
  ]);
  const affected = new Set([...before.map((link) => link.botId), ...bots.map((bot) => bot.id)]);
  for (const botId of affected) await reconcileBotConversation(botId, getAgentRuntime());
}

/** Wait for the first connect attempt, but never longer than `ms`. */
async function settle(id: string, ms = 15_000): Promise<void> {
  await Promise.race([getConnectionManager().connect(id), new Promise((r) => setTimeout(r, ms))]);
}

export async function list(): Promise<ConnectionDTO[]> {
  const rows = await prisma.connection.findMany({ include: withBots, orderBy: { name: "asc" } });
  return rows.map(toDTO);
}

export async function get(id: string): Promise<ConnectionDTO> {
  const row = await prisma.connection.findUnique({ where: { id }, include: withBots });
  if (!row) throw Boom.notFound("Connection not found");
  return toDTO(row);
}

export async function create(data: CreateConnectionDTO): Promise<ConnectionDTO> {
  checkUrl(data.url);
  const manualClient = data.authType === "oauth" && data.clientId;
  if (data.authType === "header" || data.authType === "oauth") requireSecretsKey();
  const row = await prisma.connection.create({
    data: {
      name: data.name,
      slug: await uniqueSlug(data.name),
      url: data.url,
      transport: data.transport,
      authType: data.authType,
      headerName: data.authType === "header" ? (data.headerName ?? null) : null,
      secretEnc: data.authType === "header" && data.secret ? encryptSecret(data.secret) : null,
      oauthEnc: manualClient
        ? encryptJson({
            client: {
              client_id: data.clientId,
              ...(data.clientSecret ? { client_secret: data.clientSecret } : {}),
            },
          })
        : null,
    },
  });
  await settle(row.id);
  if (data.botIds) await setBots(row.id, data.botIds);
  return get(row.id);
}

export async function update(id: string, data: UpdateConnectionDTO): Promise<ConnectionDTO> {
  const current = await get(id);
  if (data.url) checkUrl(data.url);
  if (data.secret) requireSecretsKey();
  const reconnect =
    data.url !== undefined || data.secret !== undefined || data.headerName !== undefined;
  await prisma.connection.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.url !== undefined ? { url: data.url } : {}),
      ...(data.headerName !== undefined && current.authType === "header"
        ? { headerName: data.headerName }
        : {}),
      ...(data.secret !== undefined && current.authType === "header"
        ? { secretEnc: encryptSecret(data.secret) }
        : {}),
    },
  });
  if (reconnect) await settle(id);
  if (data.botIds) await setBots(id, data.botIds);
  return get(id);
}

export async function remove(id: string): Promise<void> {
  const connection = await get(id);
  await getConnectionManager().remove(id, connection.slug);
  await prisma.connection.delete({ where: { id } });
  for (const botId of connection.botIds) await reconcileBotConversation(botId, getAgentRuntime());
}

export async function reconnect(id: string): Promise<ConnectionDTO> {
  await get(id);
  await settle(id);
  return get(id);
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
