/**
 * The owner's Vault UI (issue #56 D16): list, create, link, edit, reveal and
 * delete items, round-tripping to the backend. Never wired into a toolkit. Values pass through in the request scope only: nothing here stores
 * one, and every reveal is registered with the redactor and audited.
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { Boom } from "@groot/core/errors";
import { logger } from "@groot/core/logger";
import { vaultAlert } from "./vault.alerts";
import { secretRedactor, type VaultApproval, type VaultKind } from "@tiny-agents/agent";
import { KIND_DEFAULT_TOOLS } from "../../../shared/vault-kinds";
import { connections, db, vaultAuditEvents, vaultItems } from "../../db";
import { readBackends } from "./backends";
import { createLocalBackend } from "./backends/local";
import {
  BackendError,
  type BackendItemSummary,
  type BackendName,
  type BackendStatus,
  type DbTx,
  type ItemDraft,
  type ValueField,
  type VaultBackend,
} from "./backends/types";
import type { CreateItemDTO, PolicyDTO, UpdateItemDTO } from "./vault.schema";
import type { Deleted } from "../../../shared/api/common";
import type {
  VaultBackendView,
  VaultItemData,
  VaultItemDetailData,
  VaultOverviewData,
  VaultRevealed,
} from "../../../shared/api/vault";
import {
  audit,
  backendStatus,
  clearStatusCache,
  effectiveApproval,
  effectiveTools,
  forgetAppCredential,
  normalizeOrigin,
  toMeta,
  type VaultItemRow,
} from "./vault.service";
import { vaultPolicyDigest } from "./vault.policy";

let adminBackends: Map<BackendName, VaultBackend> | undefined;

/** Write-path backends: the local store. */
function writeBackends(): Map<BackendName, VaultBackend> {
  adminBackends ??= new Map<BackendName, VaultBackend>([["local", createLocalBackend()]]);
  return adminBackends;
}

/** Where new items go. */
const PRIMARY_BACKEND: BackendName = "local";

/** Test seam. */
export function setWriteBackendsForTests(map: Map<BackendName, VaultBackend> | undefined): void {
  adminBackends = map;
  candidatesCache = undefined;
}

/** Items were added or removed outside this module (a connection's own item): list afresh. */
export function vaultItemsChanged(): void {
  candidatesCache = undefined;
}

function backendFor(name: string): VaultBackend {
  const backend = writeBackends().get(name as BackendName);
  if (!backend) throw Boom.badRequest(`The ${name} backend is not configured`);
  return backend;
}

function backendFailure(error: unknown): never {
  if (error instanceof BackendError) {
    if (error.code === "not_found") throw Boom.notFound(error.message);
    if (error.code === "missing_field") throw Boom.badRequest(error.message);
    if (error.code === "invalid") throw Boom.badRequest(error.message);
    // The backend's code goes in the envelope's `code` (machine-readable),
    // never in `details`: the client's error renderer treats the first
    // string in `details` as a human message, so `{ code }` there surfaced
    // the bare word "unconfigured" instead of error.message (issue #124).
    throw Boom.badGateway(error.message, undefined, error.code);
  }
  throw error;
}

// ── Listing ─────────────────────────────────────────────────────────────

const CANDIDATES_TTL_MS = 5 * 60_000;
/**
 * How a backend item that won't open (wrong key, policy edited in the
 * database) is listed, linked or not. The overview shows it under "Not
 * linked yet" only while no row links it; a linked one shows why on its page.
 */
const UNREADABLE_TITLE = "Unreadable item";
let candidatesCache:
  | { at: number; items: (BackendItemSummary & { backend: BackendName })[] }
  | undefined;

async function candidates(force = false) {
  if (!force && candidatesCache && Date.now() - candidatesCache.at < CANDIDATES_TTL_MS) {
    return candidatesCache.items;
  }
  const items: (BackendItemSummary & { backend: BackendName })[] = [];
  for (const [name, backend] of readBackends()) {
    const listed = await backend.listCandidates().catch((error: unknown) => {
      logger.warn({ backend: name, error: (error as Error).message }, "Vault listing failed");
      return { items: [], unreadable: [] };
    });
    items.push(...listed.items.map((item) => ({ ...item, backend: name })));
    // One item that won't open is shown as unreadable; the rest still list (C11).
    if (listed.unreadable.length > 0) {
      logger.warn(
        { backend: name, unreadable: listed.unreadable },
        "Vault items can't be read; listed as unreadable",
      );
    }
    items.push(
      ...listed.unreadable.map(({ externalId }) => ({
        externalId,
        title: UNREADABLE_TITLE,
        kind: "other" as const,
        urls: [],
        hasTotp: false,
        fields: [],
        backend: name,
      })),
    );
  }
  candidatesCache = { at: Date.now(), items };
  return items;
}

function parseList(raw: string | null): string[] {
  try {
    const value = JSON.parse(raw ?? "[]") as unknown;
    return Array.isArray(value) ? (value as string[]) : [];
  } catch {
    return [];
  }
}

/** An item as the Vault UI shows it: metadata and policy, never a value. */
function itemView(row: VaultItemRow): VaultItemData {
  const meta = toMeta(row);
  return {
    id: row.id,
    handle: row.handle,
    // Text columns only the schema's enums and this module write.
    kind: row.kind as VaultKind,
    backend: row.backend as BackendName,
    audience: row.audience as VaultItemData["audience"],
    label: row.label,
    username: row.username,
    origins: meta.origins,
    hosts: meta.allowedHosts,
    inject: meta.inject ?? null,
    tools: parseList(row.toolsJson),
    effectiveTools: effectiveTools(row),
    bots: row.botsJson === null ? null : parseList(row.botsJson),
    approval: row.approval as VaultApproval,
    effectiveApproval: effectiveApproval(row),
    allowUnattended: row.allowUnattended,
    whenToUse: row.whenToUse,
    card: meta.card ?? null,
    hasTotp: row.hasTotp,
    disabled: row.disabled,
    field: row.field as ValueField | null,
    lastUsedAt: row.lastUsedAt,
    lastUsedBy: row.lastUsedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function backendsView(): Promise<VaultBackendView[]> {
  const views: VaultBackendView[] = [];
  for (const name of ["local"] as BackendName[]) {
    const read = readBackends().get(name);
    if (!read) {
      views.push({ name, configured: false, read: { state: "unconfigured" } as BackendStatus });
      continue;
    }
    const write = writeBackends().get(name);
    const readStatus = await backendStatus(name);
    views.push({
      name,
      configured: true,
      read: readStatus,
      write: readStatus,
      capabilities: write?.capabilities ?? read.capabilities,
    });
  }
  return views;
}

export async function overview(options: { refresh?: boolean } = {}): Promise<VaultOverviewData> {
  if (options.refresh) {
    clearStatusCache();
    await syncMetadata();
  }
  const rows = await db
    .select()
    .from(vaultItems)
    .orderBy(asc(vaultItems.kind), asc(vaultItems.label));
  const linked = new Set(rows.map((row) => `${row.backend}:${row.externalId}`));
  const unlinked = (await candidates(options.refresh))
    .filter((item) => !linked.has(`${item.backend}:${item.externalId}`))
    .map((item) => ({
      backend: item.backend,
      externalId: item.externalId,
      title: item.title,
      kind: item.kind,
      urls: item.urls,
      username: item.username ?? null,
      card: item.card ?? null,
    }));
  return {
    backends: await backendsView(),
    primaryBackend: PRIMARY_BACKEND,
    items: rows.map(itemView),
    unlinked,
    kindDefaults: KIND_DEFAULT_TOOLS,
  };
}

/** Pull metadata (username, card display, TOTP, stale links) for linked items. */
async function syncMetadata(): Promise<void> {
  const rows = await db.select().from(vaultItems);
  for (const row of rows) {
    const backend = readBackends().get(row.backend as BackendName);
    if (!backend) continue;
    try {
      const summary = await backend.describe(row.externalId);
      await db.update(vaultItems).set(metadataOf(summary)).where(eq(vaultItems.id, row.id));
    } catch (error) {
      if (error instanceof BackendError && error.code === "not_found") {
        await audit({
          item: row,
          handle: row.handle,
          tool: "vault_ui",
          target: row.backend,
          outcome: "backend_error",
          reason: "item not found (stale link)",
        });
      }
    }
  }
}

function metadataOf(summary: BackendItemSummary) {
  return {
    username: summary.username ?? null,
    cardMetaJson: summary.card ? JSON.stringify(summary.card) : null,
    hasTotp: summary.hasTotp,
  };
}

export async function detail(handle: string): Promise<VaultItemDetailData> {
  const row = await findOrThrow(handle);
  const backend = readBackends().get(row.backend as BackendName);
  let fields: ValueField[] = [];
  let urls: string[] = [];
  let title = row.label;
  let stale = false;
  let backendError: string | undefined;
  if (backend) {
    try {
      const summary = await backend.describe(row.externalId);
      fields = summary.fields;
      urls = summary.urls;
      title = summary.title;
    } catch (error) {
      stale = error instanceof BackendError && error.code === "not_found";
      backendError = (error as Error).message;
    }
  }
  const events = await db
    .select()
    .from(vaultAuditEvents)
    .where(eq(vaultAuditEvents.itemId, row.id))
    .orderBy(desc(vaultAuditEvents.at))
    .limit(50);
  const write = writeBackends().get(row.backend as BackendName);
  return {
    item: itemView(row),
    title,
    urls,
    fields,
    stale,
    ...(backendError ? { backendError } : {}),
    capabilities: write?.capabilities ?? {
      create: false,
      update: false,
      delete: false,
      reveal: false,
    },
    events,
  };
}

async function findOrThrow(handle: string): Promise<VaultItemRow> {
  const row = await db.query.vaultItems.findFirst({ where: eq(vaultItems.handle, handle) });
  if (!row) throw Boom.notFound("Vault item not found");
  return row;
}

// ── Writes ──────────────────────────────────────────────────────────────

function originsFrom(urls: string[]): string[] {
  return [...new Set(urls.map(normalizeOrigin).filter((o): o is string => o !== undefined))];
}

function policyData(policy: Partial<PolicyDTO>, kind: VaultKind) {
  return {
    ...(policy.label !== undefined ? { label: policy.label } : {}),
    ...(policy.origins !== undefined ? { originsJson: JSON.stringify(policy.origins) } : {}),
    ...(policy.hosts !== undefined ? { hostsJson: JSON.stringify(policy.hosts) } : {}),
    ...(policy.inject !== undefined
      ? { injectJson: policy.inject ? JSON.stringify(policy.inject) : null }
      : {}),
    ...(policy.tools !== undefined ? { toolsJson: JSON.stringify(policy.tools) } : {}),
    ...(policy.bots !== undefined
      ? { botsJson: policy.bots === null ? null : JSON.stringify(policy.bots) }
      : {}),
    // Cards are every_use whatever was asked.
    ...(policy.approval !== undefined
      ? { approval: kind === "card" ? "every_use" : policy.approval }
      : {}),
    ...(policy.allowUnattended !== undefined
      ? { allowUnattended: kind === "card" ? false : policy.allowUnattended }
      : {}),
    ...(policy.whenToUse !== undefined ? { whenToUse: policy.whenToUse || null } : {}),
    ...(policy.disabled !== undefined ? { disabled: policy.disabled } : {}),
    ...(policy.field !== undefined ? { field: policy.field ?? null } : {}),
  };
}

async function assertHandleFree(handle: string, except?: string): Promise<void> {
  const existing = await db.query.vaultItems.findFirst({ where: eq(vaultItems.handle, handle) });
  if (existing && existing.id !== except) throw Boom.conflict(`Handle "${handle}" is taken`);
}

/** Never save a one-time code or a CVC from a credential request; the UI may save a CVC. */
export async function createItem(
  input: CreateItemDTO,
  actor: { via: "vault_ui" | "credential_request" } = { via: "vault_ui" },
): Promise<VaultItemData> {
  await assertHandleFree(input.policy.handle);
  const name = PRIMARY_BACKEND;
  const backend = backendFor(name);
  if (!backend.create) throw Boom.badRequest(`The ${name} backend is read-only`);
  const draft: ItemDraft = {
    kind: input.kind,
    title: input.title,
    urls: input.urls,
    values: input.values,
  };
  const origins = input.policy.origins.length > 0 ? input.policy.origins : originsFrom(input.urls);
  const policy = policyData({ ...input.policy, origins }, input.kind);
  const digest = vaultPolicyDigest({
    audience: "bots",
    originsJson: policy.originsJson ?? "[]",
    hostsJson: policy.hostsJson ?? "[]",
    injectJson: policy.injectJson ?? null,
  });
  let externalId: string;
  let summary: BackendItemSummary;
  try {
    externalId = await backend.create(draft, digest);
    summary = await backend.describe(externalId);
  } catch (error) {
    backendFailure(error);
  }
  const [inserted] = await db
    .insert(vaultItems)
    .values({
      handle: input.policy.handle,
      kind: input.kind,
      backend: name,
      externalId,
      label: input.policy.label ?? input.title,
      ...policy,
      ...metadataOf(summary),
    })
    .returning();
  const row = inserted!;
  candidatesCache = undefined;
  await audit({ item: row, handle: row.handle, tool: actor.via, target: name, outcome: "created" });
  return itemView(row);
}

/**
 * A secret the server itself uses (audience `app`, issue #179): a model
 * provider's key. Never listed to bots; usable only by the `provider` sink
 * for the given hosts. Goes to the local backend unless `backend` says
 * otherwise, so chatting never depends on an external manager being up.
 */
export async function createAppCredential(input: {
  handle: string;
  label: string;
  value: string;
  hosts: string[];
  inject: { as: "header"; name: string; format: string };
  backend?: BackendName;
}): Promise<VaultItemRow> {
  await assertHandleFree(input.handle);
  const name = input.backend ?? "local";
  const backend = backendFor(name);
  if (!backend.create) throw Boom.badRequest(`The ${name} backend is read-only`);
  const policy = {
    audience: "app",
    originsJson: "[]",
    hostsJson: JSON.stringify(input.hosts.map((h) => h.toLowerCase())),
    injectJson: JSON.stringify(input.inject),
  };
  let externalId: string;
  try {
    externalId = await backend.create(
      { kind: "api_key", title: input.label, urls: [], values: { value: input.value } },
      vaultPolicyDigest(policy),
    );
  } catch (error) {
    backendFailure(error);
  }
  const [row] = await db
    .insert(vaultItems)
    .values({
      handle: input.handle,
      kind: "api_key",
      backend: name,
      externalId,
      field: "value",
      label: input.label,
      ...policy,
      toolsJson: JSON.stringify(["model"]),
      botsJson: "[]",
      approval: "allowed",
    })
    .returning();
  candidatesCache = undefined;
  await audit({
    item: row!,
    handle: row!.handle,
    tool: "models",
    target: name,
    outcome: "created",
  });
  return row!;
}

export async function linkItem(input: {
  backend: BackendName;
  externalId: string;
  policy: PolicyDTO;
}): Promise<VaultItemData> {
  await assertHandleFree(input.policy.handle);
  const backend = readBackends().get(input.backend);
  if (!backend) throw Boom.badRequest(`The ${input.backend} backend is not configured`);
  let summary: BackendItemSummary;
  try {
    summary = await backend.describe(input.externalId);
  } catch (error) {
    backendFailure(error);
  }
  if (summary.kind === "other") throw Boom.badRequest("This kind of item can't be used by bots");
  const origins =
    input.policy.origins.length > 0 ? input.policy.origins : originsFrom(summary.urls);
  const values = {
    handle: input.policy.handle,
    kind: summary.kind,
    backend: input.backend,
    externalId: input.externalId,
    label: input.policy.label ?? summary.title,
    ...policyData({ ...input.policy, origins }, summary.kind),
    ...metadataOf(summary),
  };
  // A backend that seals values itself binds the item to its row's policy,
  // in the transaction that inserts the row. One row per value: a second
  // would open it under a policy the first never agreed to, so the check is
  // in that transaction too (C11).
  const insertRow = (tx: DbTx) => {
    const linked = tx
      .select({ handle: vaultItems.handle })
      .from(vaultItems)
      .where(
        and(eq(vaultItems.backend, input.backend), eq(vaultItems.externalId, input.externalId)),
      )
      .get();
    if (linked) throw Boom.conflict(`This item is already linked as "${linked.handle}"`);
    return tx.insert(vaultItems).values(values).returning().get();
  };
  const write = writeBackends().get(input.backend);
  let row: VaultItemRow;
  try {
    row = write?.rebind ? await write.rebind(input.externalId, insertRow) : insertRow(db);
  } catch (error) {
    backendFailure(error);
  }
  candidatesCache = undefined;
  await audit({
    item: row,
    handle: row.handle,
    tool: "vault_ui",
    target: input.backend,
    outcome: "linked",
  });
  return itemView(row);
}

export async function updateItem(
  handle: string,
  input: UpdateItemDTO,
  actor: { via: "vault_ui" | "credential_request" } = { via: "vault_ui" },
): Promise<VaultItemData> {
  const row = await findOrThrow(handle);
  if (row.audience === "app") {
    throw Boom.conflict(
      "This item is used by the app; change it where it is used (Settings → Models).",
    );
  }
  return updateItemRow(row, input, actor);
}

/**
 * Apply an edit to a vault item: the backend's values, then the policy,
 * re-sealing a self-sealed value when the policy digest changes. Also the
 * write path for `app` items, whose owners (the models service) call it
 * directly.
 */
async function updateItemRow(
  row: VaultItemRow,
  input: UpdateItemDTO & { audience?: "bots" | "app" },
  actor: { via: "vault_ui" | "credential_request" | "models" } = { via: "vault_ui" },
) {
  const kind = row.kind as VaultKind;
  const touchesPolicy = input.policy !== undefined || input.audience !== undefined;
  const touchesBackend =
    input.values !== undefined || input.title !== undefined || input.urls !== undefined;
  let metadata = {};
  if (touchesBackend) {
    const backend = backendFor(row.backend);
    if (!backend.update)
      throw Boom.badRequest("This item's backend is read-only; edit it in the source app");
    try {
      await backend.update(row.externalId, {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.urls !== undefined ? { urls: input.urls } : {}),
        values: input.values ?? {},
      });
      metadata = metadataOf(await backend.describe(row.externalId));
    } catch (error) {
      backendFailure(error);
    }
  }
  if (input.policy?.handle && input.policy.handle !== row.handle) {
    await assertHandleFree(input.policy.handle, row.id);
  }
  const data = {
    ...(input.policy?.handle ? { handle: input.policy.handle } : {}),
    ...(input.audience ? { audience: input.audience } : {}),
    ...policyData(input.policy ?? {}, kind),
    ...metadata,
  };
  const writeRow = (tx: DbTx): VaultItemRow => {
    // Drizzle refuses an empty SET: with nothing to change, the row as it stands now.
    const changed =
      Object.keys(data).length === 0
        ? tx.select().from(vaultItems).where(eq(vaultItems.id, row.id)).get()
        : tx.update(vaultItems).set(data).where(eq(vaultItems.id, row.id)).returning().get();
    // Deleted meanwhile (Prisma's P2025 → 404); a re-seal with it rolls back.
    if (!changed) throw Boom.notFound("Record not found");
    return changed;
  };
  // A policy edit re-seals a self-sealed value in the transaction that writes
  // the row: opened under the row as that transaction finds it (a concurrent
  // edit included) and sealed under the row as written, never under a digest
  // worked out from the row read before (C11).
  const rebind = touchesPolicy
    ? writeBackends().get(row.backend as BackendName)?.rebind
    : undefined;
  let updated: VaultItemRow;
  try {
    updated = rebind ? await rebind(row.externalId, writeRow) : writeRow(db);
  } catch (error) {
    backendFailure(error);
  }
  forgetAppCredential(row.handle);
  candidatesCache = undefined;
  await audit({
    item: updated,
    handle: updated.handle,
    tool: actor.via,
    target: row.backend,
    outcome: "updated",
    reason: [
      input.values ? `values: ${Object.keys(input.values).join(", ")}` : undefined,
      input.policy ? "policy" : undefined,
    ]
      .filter(Boolean)
      .join("; "),
  });
  return itemView(updated);
}

export async function deleteItem(handle: string, options: { purge: boolean }): Promise<Deleted> {
  const row = await findOrThrow(handle);
  if (row.audience === "app") {
    throw Boom.conflict(
      "This item is used by the app; remove it where it is used (Settings → Models).",
    );
  }
  // A connection's own header value goes with the connection, or with a new value there.
  const owner = await db.query.connections.findFirst({
    where: eq(connections.secretItemId, row.id),
    columns: { name: true },
  });
  if (owner) {
    throw Boom.conflict(
      `This item is the header value of the connection "${owner.name}"; change or remove it on the Connections page.`,
    );
  }
  return deleteItemRow(row, options);
}

/** Delete a vault item (and, with `purge`, its value in the backend). */
export async function deleteItemRow(
  row: VaultItemRow,
  options: { purge: boolean },
): Promise<Deleted> {
  if (options.purge) {
    const backend = backendFor(row.backend);
    if (!backend.remove)
      throw Boom.badRequest("This item's backend is read-only; delete it in the source app");
    try {
      await backend.remove(row.externalId);
    } catch (error) {
      if (!(error instanceof BackendError && error.code === "not_found")) backendFailure(error);
    }
  }
  await db.delete(vaultItems).where(eq(vaultItems.id, row.id));
  forgetAppCredential(row.handle);
  candidatesCache = undefined;
  await audit({
    handle: row.handle,
    tool: "vault_ui",
    target: row.backend,
    outcome: "deleted",
    reason: options.purge ? "deleted in the backend" : "unlinked only",
  });
  vaultAlert(
    "deleted",
    "Vault item deleted",
    `${row.label} (${row.handle}) was ${options.purge ? "deleted" : "unlinked"} in the Vault UI.`,
  );
  return { deleted: true };
}

/**
 * Drop a deleted bot from every item's bot list. A list it leaves empty
 * stays `[]` (no bot may use the item), never null (every bot may).
 */
export async function forgetBotInVault(botId: string): Promise<void> {
  await db
    .update(vaultItems)
    .set({
      botsJson: sql`(select json_group_array(value) from json_each(${vaultItems.botsJson}) where value <> ${botId})`,
    })
    .where(
      sql`json_valid(${vaultItems.botsJson}) and exists (select 1 from json_each(${vaultItems.botsJson}) where value = ${botId})`,
    );
}

/** One value for the owner's browser. Registered with the redactor and audited. */
export async function reveal(
  handle: string,
  field: ValueField,
  purpose: "reveal" | "copy",
): Promise<VaultRevealed> {
  const row = await findOrThrow(handle);
  const backend = backendFor(row.backend);
  if (!backend.capabilities.reveal) throw Boom.badRequest("This backend can't reveal values");
  let value: string;
  try {
    const secret = await backend.resolve(row.externalId, field);
    secretRedactor.register(secret);
    value = secret.reveal();
  } catch (error) {
    backendFailure(error);
  }
  await audit({
    item: row,
    handle: row.handle,
    tool: "vault_ui",
    target: field,
    outcome: purpose === "copy" ? "copied" : "revealed",
  });
  if (purpose === "reveal") {
    vaultAlert(
      "revealed",
      "Vault value revealed",
      `The ${field.replace(/_/g, " ")} of ${row.label} (${row.handle}) was revealed in the Vault UI.`,
    );
  }
  return { field, value };
}
