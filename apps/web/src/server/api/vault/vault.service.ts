/**
 * The vault's policy, audit and read path (issue #56).
 *
 * `VaultItem` rows hold references and policy; values stay in the backend
 * and are fetched per use (never cached). Every attempted use — refusals and
 * denials included — writes a `VaultAuditEvent` without any value. This
 * module resolves with the read-only backends only; writes live in
 * `vault.admin.service.ts`.
 */
import { asc, eq } from "drizzle-orm";
import { logger } from "@groot/core/logger";
import {
  secretRedactor,
  VaultError,
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
import { db, vaultAuditEvents, vaultItems, type VaultItem } from "../../db";
import { readBackends } from "./backends";
import {
  BackendError,
  type BackendName,
  type BackendStatus,
  type ValueField,
} from "./backends/types";

export type VaultItemRow = VaultItem;

/** Tools an item may be used by when its row names none. */
export const KIND_DEFAULT_TOOLS: Record<VaultKind, string[]> = {
  login: ["browser_fill_secret", "browser_enter_code", "computer_fill_secret"],
  card: ["browser_fill_secret"],
  identity: [],
  api_key: ["http_request", "mcp"],
};

export const UNKNOWN_HANDLE = (handle: string) => `No vault item \`${handle}\`. Call vault_list.`;

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

/** Cards always ask, every time; no setting lowers that. */
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

/** Exact `scheme://host[:port]`, lowercased; `undefined` when not an http(s) origin. */
export function normalizeOrigin(raw: string): string | undefined {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

// ── Backend status ──────────────────────────────────────────────────────

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
  if (status.code === "token_overscoped") {
    logger.error({ backend: name, extraVaults: status.extraVaults }, "Vault token is overscoped");
  }
  return status;
}

export function clearStatusCache(): void {
  statusCache.clear();
}

// ── Audit ───────────────────────────────────────────────────────────────

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

// ── Policy ──────────────────────────────────────────────────────────────

/** Who is asking: resolved by the broker from the conversation. */
export interface UseContext {
  botId?: string;
  botName?: string;
  unattended: boolean;
  /** A shared bot's chat (issue #145): guests are in it, so every use asks the owner. */
  shared?: boolean;
}

export async function findItem(handle: string): Promise<VaultItemRow | null> {
  return (await db.query.vaultItems.findFirst({ where: eq(vaultItems.handle, handle) })) ?? null;
}

/** Items the bot may use, narrowed by tool and origin. */
export async function listFor(scope: {
  botId?: string;
  tool?: string;
  origin?: string;
}): Promise<VaultItemMeta[]> {
  const rows = await db
    .select()
    .from(vaultItems)
    .where(eq(vaultItems.disabled, false))
    .orderBy(asc(vaultItems.handle));
  const origin = scope.origin ? normalizeOrigin(scope.origin) : undefined;
  return rows
    .filter((row) => botAllowed(row, scope.botId))
    .filter((row) => !scope.tool || effectiveTools(row).includes(scope.tool))
    .filter((row) => !origin || parseList(row.originsJson).includes(origin))
    .map(toMeta);
}

/** Whether the item's policy lets a value go to this target, read by the target's kind. */
function targetAllowed(row: VaultItemRow, kind: VaultTargetKind, target: string): boolean {
  switch (kind) {
    case "origin": {
      const origin = normalizeOrigin(target);
      return origin !== undefined && parseList(row.originsJson).includes(origin);
    }
    case "host":
      return parseList(row.hostsJson)
        .map((h) => h.toLowerCase())
        .includes(target.toLowerCase());
    // Commands run confined to the item's hosts, so it must name some.
    case "command":
      return parseList(row.hostsJson).length > 0;
    // The owner linked the item to the connection itself.
    case "connection":
      return true;
    // A desktop window: the sink checks the bound window right before typing,
    // and every use asks, showing the owner which window.
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

/** What a policy check is about: the use, minus the conversation a connection's use has none of. */
type PolicyUse = Pick<VaultUse, "handle" | "tool" | "targetKind" | "target">;

/**
 * The one policy check: why this row may not be used this way, or nothing.
 * `botScoped` is false for a use with no bot behind it (a connection the
 * owner linked the item to). Checks the backend last, so a refusal never
 * costs a backend round-trip.
 */
async function policyRefusal(
  row: VaultItemRow | null,
  use: PolicyUse,
  who: UseContext,
  botScoped = true,
): Promise<{ refused: Refusal["refused"]; message: string; reason?: string } | undefined> {
  // A bot that may not see an item learns nothing about it.
  if (!row || (botScoped && !botAllowed(row, who.botId))) {
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

/** The policy decision for a use; audits refusals. Resolves no value. */
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
  const approval = effectiveApproval(item);
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
  // A command is code the model wrote holding the secret, and a window is
  // one the model named: every use asks.
  const everyUse =
    approval === "every_use" ||
    use.targetKind === "command" ||
    use.targetKind === "window" ||
    who.shared === true;
  return {
    approve: everyUse || (approval === "per_conversation" && !use.granted),
    grantable: !everyUse,
    unattended: who.unattended,
    card,
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

/** The value field an api_key item keeps its key in (`VaultItem.field`, else the credential). */
function backendField(row: VaultItemRow, field: SecretField): ValueField {
  if (field === "value" && row.field) return row.field as ValueField;
  if (field === "value" && row.kind === "login") return "password";
  return VALUE_FIELD[field];
}

/**
 * Re-check policy, resolve the fields, register them with the redactor and
 * hand them to `sink`. Audited either way; values never leave this call
 * except into the sink.
 */
export async function useItem<T>(
  use: VaultUse & { approved: boolean },
  who: UseContext & { taskId?: number },
  fields: readonly SecretField[] | ((item: VaultItemMeta) => readonly SecretField[]),
  sink: (values: SecretValues, item: VaultItemMeta) => Promise<T>,
): Promise<T> {
  const plan = await planUse(use, who);
  if (plan.refused) throw new VaultError(plan.refused, plan.message);
  const row = (await findItem(use.handle))!;
  const base = {
    item: row,
    handle: use.handle,
    botId: who.botId,
    conversationId: use.conversation,
    taskId: who.taskId,
    tool: use.tool,
    target: use.target,
    unattended: who.unattended,
  };
  if (plan.approve && !use.approved) {
    await audit({ ...base, outcome: "refused_policy", reason: "approval required" });
    throw new VaultError("refused_policy", `Using \`${use.handle}\` needs the owner's approval.`);
  }
  const meta = toMeta(row);
  const wanted = typeof fields === "function" ? fields(meta) : fields;
  const values = await resolveValues(row, wanted, base);
  let result: T;
  try {
    result = await sink(values, meta);
  } catch (error) {
    // The audit says what happened, not what was meant: a sink that threw
    // used nothing it can vouch for.
    const movedAway = error instanceof Error && error.name === "OriginMismatchError";
    await audit({
      ...base,
      outcome: movedAway ? "refused_origin" : "sink_error",
      reason: movedAway
        ? "page origin changed before the fill"
        : `the sink failed: ${error instanceof Error ? error.name : "error"}`,
    });
    throw error;
  }
  await audit({ ...base, outcome: use.approved ? "approved_used" : "used" });
  await markUsed(row.id, who.botName ?? null);
  return result;
}

/**
 * Resolve the wanted fields from the item's backend, registering each with
 * the redactor. A field the item has no value for is left out (a card
 * without a saved security code); none at all, or a backend failure, is
 * audited and thrown as a `VaultError`.
 */
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

/**
 * A connection's header value from its vault item (`Connection.secretRef`):
 * resolved at connect time, registered with the redactor and audited. The
 * owner linked the item to the connection, so there is no per-use approval;
 * the item must still allow `mcp` and be enabled. Throws a message the
 * connection's status shows.
 */
export async function resolveConnectionSecret(handle: string, slug: string): Promise<string> {
  const row = await findItem(handle);
  const use: PolicyUse = { handle, tool: "mcp", targetKind: "connection", target: `mcp:${slug}` };
  const base = { ...(row ? { item: row } : {}), handle, tool: use.tool, target: use.target };
  // No bot behind a connection: the owner linked the item to it, and nobody
  // is "present", so neither the bot scope nor the unattended rule applies.
  const refusal = await policyRefusal(row, use, { unattended: false }, false);
  if (refusal) {
    const message = `Vault item "${handle}": ${refusal.message}`;
    await audit({ ...base, outcome: refusal.refused, reason: refusal.reason ?? refusal.message });
    throw new Error(message);
  }
  const item = row!;
  let values: SecretValues;
  try {
    values = await resolveValues(item, ["value"], base);
  } catch (error) {
    throw new Error(error instanceof VaultError ? error.message : "Vault backend failed");
  }
  await audit({ ...base, outcome: "used" });
  await markUsed(item.id, `mcp:${slug}`);
  return values.value!.reveal();
}
