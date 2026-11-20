import { and, asc, eq } from "drizzle-orm";
import { logger } from "@groot/core/logger";
import {
  secretRedactor,
  VaultError,
  VaultTargetMovedError,
  type SecretField,
  type SecretValues,
  type VaultApproval,
  type VaultCard,
  type VaultItemMeta,
  type VaultKind,
  type VaultOutcome,
  type VaultPlan,
  type VaultTargetKind,
  type VaultUse,
} from "@tiny-agents/agent";
import { KIND_DEFAULT_TOOLS } from "../../../shared/vault-kinds";
import { db, vaultAuditEvents, vaultItems, type VaultItem } from "../../db";
import { readBackends } from "./backends";
import {
  BackendError,
  type BackendName,
  type BackendStatus,
  type ValueField,
} from "./backends/types";

export type VaultItemRow = VaultItem;

const UNKNOWN_HANDLE = (handle: string) => `No vault item \`${handle}\`. Call vault_list.`;

const parseList = (raw: string | null | undefined): string[] => {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
};

const parseJson = <T>(raw: string | null | undefined): T | undefined => {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
};

export function effectiveApproval(row: Pick<VaultItemRow, "kind" | "approval">): VaultApproval {
  if (row.kind === "card") return "every_use";
  return (["every_use", "per_conversation", "allowed"] as const).includes(
    row.approval as VaultApproval,
  )
    ? (row.approval as VaultApproval)
    : "every_use";
}

export function effectiveTools(row: Pick<VaultItemRow, "kind" | "toolsJson">): string[] {
  const tools = parseList(row.toolsJson);
  return tools.length > 0 ? tools : (KIND_DEFAULT_TOOLS[row.kind as VaultKind] ?? []);
}

export function toMeta(row: VaultItemRow): VaultItemMeta {
  const card = parseJson<{ brand: string; last4: string; expiry: string }>(row.cardMetaJson);
  const inject = parseJson<VaultItemMeta["inject"]>(row.injectJson);
  return {
    handle: row.handle,
    kind: row.kind as VaultKind,
    label: row.label,
    ...(row.username ? { username: row.username } : {}),
    origins: parseList(row.originsJson),
    allowedHosts: parseList(row.hostsJson),
    ...(inject ? { inject } : {}),
    hasTotp: row.hasTotp,
    ...(card ? { card } : {}),
    ...(row.whenToUse ? { whenToUse: row.whenToUse } : {}),
    approval: effectiveApproval(row),
    tools: effectiveTools(row),
  };
}

function botAllowed(row: VaultItemRow, botId: string | undefined): boolean {
  if (row.botsJson === null) return true;
  return botId !== undefined && parseList(row.botsJson).includes(botId);
}

export function normalizeOrigin(raw: string): string | undefined {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

const STATUS_TTL_MS = 60_000;
const statusCache = new Map<BackendName, { at: number; status: BackendStatus }>();

export async function backendStatus(name: BackendName, force = false): Promise<BackendStatus> {
  const backend = readBackends().get(name);
  if (!backend) return { state: "unconfigured", detail: "Not configured." };
  const cached = statusCache.get(name);
  if (!force && cached && Date.now() - cached.at < STATUS_TTL_MS) return cached.status;
  const status = await backend.status().catch((error: unknown): BackendStatus => ({
    state: "error",
    detail: (error as Error).message,
  }));
  statusCache.set(name, { at: Date.now(), status });
  return status;
}

export function clearStatusCache(): void {
  statusCache.clear();
}

export interface AuditInput {
  item?: Pick<VaultItemRow, "id" | "handle">;
  handle: string;
  botId?: string;
  conversationId?: number;
  taskId?: number;
  tool: string;
  target: string;
  outcome:
    | VaultOutcome
    | "created"
    | "updated"
    | "deleted"
    | "linked"
    | "revealed"
    | "copied"
    | "filled"
    | "cancelled";
  reason?: string;
  unattended?: boolean;
}

export async function audit(input: AuditInput): Promise<void> {
  try {
    await db.insert(vaultAuditEvents).values({
      itemId: input.item?.id ?? null,
      handle: input.handle,
      botId: input.botId ?? null,
      conversationId: input.conversationId ?? null,
      taskId: input.taskId ?? null,
      tool: input.tool,
      target: secretRedactor.scrub(input.target).slice(0, 500),
      outcome: input.outcome,
      reason: input.reason ? secretRedactor.scrub(input.reason).slice(0, 500) : null,
      unattended: input.unattended ?? false,
    });
  } catch (error) {
    logger.error(
      { error: (error as Error).message, handle: input.handle },
      "Vault audit write failed",
    );
  }
}

export interface UseContext {
  botId?: string;
  botName?: string;
  unattended: boolean;
  shared?: boolean;
}

export async function findItem(handle: string): Promise<VaultItemRow | null> {
  return (await db.query.vaultItems.findFirst({ where: eq(vaultItems.handle, handle) })) ?? null;
}

export async function listFor(scope: {
  botId?: string;
  tool?: string;
  origin?: string;
}): Promise<VaultItemMeta[]> {
  const rows = await db
    .select()
    .from(vaultItems)
    .where(and(eq(vaultItems.disabled, false), eq(vaultItems.audience, "bots")))
    .orderBy(asc(vaultItems.handle));
  const origin = scope.origin ? normalizeOrigin(scope.origin) : undefined;
  return rows
    .filter((row) => botAllowed(row, scope.botId))
    .filter((row) => !scope.tool || effectiveTools(row).includes(scope.tool))
    .filter((row) => !origin || parseList(row.originsJson).includes(origin))
    .map(toMeta);
}

function hostAllowed(row: VaultItemRow, host: string): boolean {
  return parseList(row.hostsJson)
    .map((h) => h.toLowerCase())
    .includes(host.toLowerCase());
}

function targetAllowed(row: VaultItemRow, kind: VaultTargetKind, target: string): boolean {
  switch (kind) {
    case "origin": {
      const origin = normalizeOrigin(target);
      return origin !== undefined && parseList(row.originsJson).includes(origin);
    }
    case "host":
      return hostAllowed(row, target);
    case "provider":
      return row.audience === "app" && hostAllowed(row, target);
    case "github":
      return (
        row.audience === "app" &&
        (hostAllowed(row, "github.com") || hostAllowed(row, "api.github.com"))
      );
    case "command":
      return parseList(row.hostsJson).length > 0;
    case "connection":
      return true;
    case "window":
      return true;
    default:
      return false;
  }
}

function targetRefusal(row: VaultItemRow, use: Pick<VaultUse, "handle" | "targetKind" | "target">) {
  switch (use.targetKind) {
    case "origin":
      return `Vault item \`${use.handle}\` only fills on ${parseList(row.originsJson).join(", ") || "no origin yet"}, not ${use.target}.`;
    case "command":
      return `Vault item \`${use.handle}\` names no hosts a command may reach; the owner must add them on the Vault page.`;
    default:
      return `Vault item \`${use.handle}\` may not be sent to ${use.target}.`;
  }
}

type Refusal = Extract<VaultPlan, { refused: string }>;

type PolicyUse = Pick<VaultUse, "handle" | "tool" | "targetKind" | "target">;

async function policyRefusal(
  row: VaultItemRow | null,
  use: PolicyUse,
  who: UseContext,
  botScoped = true,
): Promise<{ refused: Refusal["refused"]; message: string; reason?: string } | undefined> {
  if (!row || (botScoped && (row.audience !== "bots" || !botAllowed(row, who.botId)))) {
    return { refused: "unknown_handle", message: UNKNOWN_HANDLE(use.handle) };
  }
  if (row.disabled) {
    return { refused: "disabled", message: `Vault item \`${use.handle}\` is disabled.` };
  }
  if (!effectiveTools(row).includes(use.tool)) {
    return {
      refused: "refused_policy",
      message: `Vault item \`${use.handle}\` can't be used by ${use.tool}.`,
    };
  }
  if (!targetAllowed(row, use.targetKind, use.target)) {
    return { refused: "refused_origin", message: targetRefusal(row, use) };
  }
  if (who.unattended && (row.kind === "card" || !row.allowUnattended)) {
    return {
      refused: "refused_unattended",
      message: `Vault item \`${use.handle}\` can't be used without the owner present (routines and messages from other bots). Ask the owner in the chat.`,
    };
  }
  const status = await backendStatus(row.backend as BackendName);
  if (status.state !== "ready") {
    return {
      refused: "vault_locked",
      message: "The vault is locked or unreachable. Ask the owner to check Settings → Vault.",
      reason: status.code ?? status.detail,
    };
  }
  return undefined;
}

export async function planUse(use: VaultUse, who: UseContext): Promise<VaultPlan> {
  const row = await findItem(use.handle);
  const refusal = await policyRefusal(row, use, who);
  if (refusal) {
    await audit({
      ...(row ? { item: row } : {}),
      handle: use.handle,
      botId: who.botId,
      conversationId: use.conversation,
      tool: use.tool,
      target: use.target,
      outcome: refusal.refused,
      reason: refusal.reason ?? refusal.message,
      unattended: who.unattended,
    });
    return { refused: refusal.refused, message: refusal.message };
  }
  const item = row!;
  const card: VaultCard = {
    handle: item.handle,
    label: item.label,
    kind: item.kind as VaultKind,
    tool: use.tool,
    target: use.target,
    ...(who.botName ? { bot: who.botName } : {}),
    ...(item.username ? { username: item.username } : {}),
  };
  const meta = parseJson<{ brand: string; last4: string }>(item.cardMetaJson);
  if (meta) card.card = { brand: meta.brand, last4: meta.last4 };
  return { ...approvalOf(item, use, who), unattended: who.unattended, card };
}

function approvalOf(
  item: VaultItemRow,
  use: Pick<VaultUse, "targetKind"> & { granted?: boolean },
  who: UseContext,
): { approve: boolean; grantable: boolean } {
  const approval = effectiveApproval(item);
  const everyUse =
    approval === "every_use" ||
    use.targetKind === "command" ||
    use.targetKind === "window" ||
    who.shared === true;
  return {
    approve: everyUse || (approval === "per_conversation" && !use.granted),
    grantable: !everyUse,
  };
}

const VALUE_FIELD: Record<SecretField, ValueField> = {
  username: "username",
  password: "password",
  totp: "totp",
  card_number: "card_number",
  card_expiry: "card_expiry",
  card_cvc: "card_cvc",
  card_holder: "card_holder",
  value: "value",
};

function backendField(row: VaultItemRow, field: SecretField): ValueField {
  if (field === "value" && row.field) return row.field as ValueField;
  if (field === "value" && row.kind === "login") return "password";
  return VALUE_FIELD[field];
}

export async function runItemUse<T>(
  use: VaultUse & { approved: boolean },
  who: UseContext & { taskId?: number },
  fields: readonly SecretField[] | ((item: VaultItemMeta) => readonly SecretField[]),
  sink: (values: SecretValues, item: VaultItemMeta) => Promise<T>,
): Promise<T> {
  return runUse(use, who, { botScoped: true, usedBy: who.botName ?? null }, fields, sink);
}

async function runUse<T>(
  use: PolicyUse & { conversation?: number; granted?: boolean; approved: boolean },
  who: UseContext & { taskId?: number },
  path: { botScoped: boolean; usedBy: string | null; auditUse?: boolean },
  fields: readonly SecretField[] | ((item: VaultItemMeta) => readonly SecretField[]),
  sink: (values: SecretValues, item: VaultItemMeta) => Promise<T>,
): Promise<T> {
  const row = await findItem(use.handle);
  const base = {
    ...(row ? { item: row } : {}),
    handle: use.handle,
    botId: who.botId,
    conversationId: use.conversation,
    taskId: who.taskId,
    tool: use.tool,
    target: use.target,
    unattended: who.unattended,
  };
  const refusal = await policyRefusal(row, use, who, path.botScoped);
  if (refusal) {
    await audit({ ...base, outcome: refusal.refused, reason: refusal.reason ?? refusal.message });
    throw new VaultError(refusal.refused, refusal.message);
  }
  const item = row!;
  if (path.botScoped && approvalOf(item, use, who).approve && !use.approved) {
    await audit({ ...base, outcome: "refused_policy", reason: "approval required" });
    throw new VaultError("refused_policy", `Using \`${use.handle}\` needs the owner's approval.`);
  }
  const meta = toMeta(item);
  const wanted = typeof fields === "function" ? fields(meta) : fields;
  const values = await resolveValues(item, wanted, base);
  let result: T;
  try {
    result = await sink(values, meta);
  } catch (error) {
    const moved = error instanceof VaultTargetMovedError;
    await audit({
      ...base,
      outcome: moved ? "refused_origin" : "sink_error",
      reason: moved
        ? error.reason
        : `the sink failed: ${error instanceof Error ? error.name : "error"}`,
    });
    throw error;
  }
  if (path.auditUse !== false) {
    await audit({ ...base, outcome: use.approved ? "approved_used" : "used" });
  }
  await markUsed(item.id, path.usedBy);
  return result;
}

async function resolveValues(
  row: VaultItemRow,
  wanted: readonly SecretField[],
  base: Omit<AuditInput, "outcome" | "reason">,
): Promise<SecretValues> {
  const backend = readBackends().get(row.backend as BackendName);
  if (!backend) {
    await audit({ ...base, outcome: "vault_locked", reason: "backend not configured" });
    throw new VaultError("vault_locked", "The vault backend for this item is not configured.");
  }
  const values: SecretValues = {};
  try {
    for (const field of wanted) {
      try {
        const value = await backend.resolve(row.externalId, backendField(row, field));
        secretRedactor.register(value);
        values[field] = value;
      } catch (error) {
        if (!(error instanceof BackendError && error.code === "missing_field")) throw error;
      }
    }
    if (wanted.length > 0 && Object.keys(values).length === 0) {
      throw new BackendError("missing_field", "none of the fields hold a value");
    }
    return values;
  } catch (error) {
    const code = error instanceof BackendError ? error.code : "failed";
    await audit({ ...base, outcome: "backend_error", reason: code });
    if (code === "missing_field") {
      throw new VaultError("missing_field", `Vault item \`${base.handle}\` has no value for that.`);
    }
    throw new VaultError(
      "backend_error",
      "The vault backend failed. The owner can see why on the Vault page.",
    );
  }
}

async function markUsed(itemId: string, by: string | null): Promise<void> {
  await db
    .update(vaultItems)
    .set({ lastUsedAt: new Date(), lastUsedBy: by })
    .where(eq(vaultItems.id, itemId))
    .catch(() => undefined);
}

export async function resolveConnectionSecret(
  handle: string,
  slug: string,
  host?: string,
): Promise<string> {
  const target = `mcp:${slug}`;
  try {
    return await runUse(
      host === undefined
        ? { handle, tool: "mcp", targetKind: "connection", target, approved: false }
        : { handle, tool: "mcp", targetKind: "host", target: host, approved: false },
      { unattended: false },
      { botScoped: false, usedBy: target },
      ["value"],
      async (values) => values.value!.reveal(),
    );
  } catch (error) {
    if (!(error instanceof VaultError)) throw error;
    throw new Error(
      error.code === "backend_error" || error.code === "missing_field"
        ? error.message
        : `Vault item "${handle}": ${error.message}`,
    );
  }
}

const APP_VALUE_TTL_MS = 5 * 60_000;
const appValues = new Map<string, { at: number; value: string }>();

export function forgetAppCredential(handle?: string): void {
  if (handle === undefined) return appValues.clear();
  for (const key of appValues.keys()) {
    if (key.startsWith(`${handle}\0`)) appValues.delete(key);
  }
}

export async function resolveProviderSecret(
  handle: string,
  input: { providerName: string; host: string },
): Promise<string> {
  const key = `${handle}\0${input.host.toLowerCase()}`;
  const cached = appValues.get(key);
  if (cached && Date.now() - cached.at < APP_VALUE_TTL_MS) return cached.value;
  const value = await runUse(
    { handle, tool: "model", targetKind: "provider", target: input.host, approved: false },
    { unattended: false },
    { botScoped: false, usedBy: input.providerName, auditUse: false },
    ["value"],
    async (values) => values.value!.reveal(),
  );
  appValues.set(key, { at: Date.now(), value });
  return value;
}

export async function resolveGitHubToken(handle: string): Promise<string> {
  const key = `${handle}\0github`;
  const cached = appValues.get(key);
  if (cached && Date.now() - cached.at < APP_VALUE_TTL_MS) return cached.value;
  const value = await runUse(
    { handle, tool: "github", targetKind: "github", target: "api.github.com", approved: false },
    { unattended: false },
    { botScoped: false, usedBy: "code:github", auditUse: false },
    ["value"],
    async (values) => values.value!.reveal(),
  );
  appValues.set(key, { at: Date.now(), value });
  return value;
}
