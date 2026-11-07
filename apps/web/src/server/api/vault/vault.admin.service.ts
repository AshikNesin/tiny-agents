/**
 * The owner's Vault UI (issue #56 D16): list, create, link, edit, reveal and
 * delete items, round-tripping to the backend. The only module that loads the
 * read+write Connect token (`OP_CONNECT_ADMIN_TOKEN`); never wired into a
 * toolkit. Values pass through in the request scope only: nothing here stores
 * one, and every reveal is registered with the redactor and audited.
 */
import { asc, desc, eq } from "drizzle-orm";
import { Boom } from "@groot/core/errors";
import { vaultAlert } from "./vault.alerts";
import { secretRedactor, type VaultKind } from "@tiny-agents/agent";
import { db, vaultAuditEvents, vaultItems } from "../../db";
import { appEnv } from "../../env";
import { connectConfig, primaryBackend, readBackends } from "./backends";
import { createLocalBackend } from "./backends/local";
import { createConnectBackend } from "./backends/onepassword-connect";
import {
  BackendError,
  type BackendItemSummary,
  type BackendName,
  type BackendStatus,
  type ItemDraft,
  type ValueField,
  type VaultBackend,
} from "./backends/types";
import type { CreateItemDTO, PolicyDTO, UpdateItemDTO } from "./vault.schema";
import {
  audit,
  backendStatus,
  clearStatusCache,
  effectiveApproval,
  effectiveTools,
  KIND_DEFAULT_TOOLS,
  normalizeOrigin,
  toMeta,
  type VaultItemRow,
} from "./vault.service";

const unquote = (value: string | undefined) =>
  value
    ?.trim()
    .replace(/^(['"])([\s\S]*)\1$/, "$2")
    .trim() || undefined;

let adminBackends: Map<BackendName, VaultBackend> | undefined;

/** Write-path backends: Connect with the read+write token, and the local store. */
function writeBackends(): Map<BackendName, VaultBackend> {
  if (adminBackends) return adminBackends;
  const map = new Map<BackendName, VaultBackend>([["local", createLocalBackend()]]);
  const connect = connectConfig();
  if (connect) {
    map.set(
      "onepassword-connect",
      createConnectBackend({
        ...connect,
        token: unquote(appEnv().OP_CONNECT_ADMIN_TOKEN) ?? "",
        writable: true,
      }),
    );
  }
  adminBackends = map;
  return map;
}

/** Test seam. */
export function setWriteBackendsForTests(map: Map<BackendName, VaultBackend> | undefined): void {
  adminBackends = map;
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
let candidatesCache:
  | { at: number; items: (BackendItemSummary & { backend: BackendName })[] }
  | undefined;

async function candidates(force = false) {
  if (!force && candidatesCache && Date.now() - candidatesCache.at < CANDIDATES_TTL_MS) {
    return candidatesCache.items;
  }
  const items: (BackendItemSummary & { backend: BackendName })[] = [];
  for (const [name, backend] of readBackends()) {
    const listed = await backend.listCandidates().catch(() => [] as BackendItemSummary[]);
    items.push(...listed.map((item) => ({ ...item, backend: name })));
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
function itemView(row: VaultItemRow) {
  const meta = toMeta(row);
  return {
    id: row.id,
    handle: row.handle,
    kind: row.kind,
    backend: row.backend,
    label: row.label,
    username: row.username,
    origins: meta.origins,
    hosts: meta.allowedHosts,
    inject: meta.inject ?? null,
    tools: parseList(row.toolsJson),
    effectiveTools: effectiveTools(row),
    bots: row.botsJson === null ? null : parseList(row.botsJson),
    approval: row.approval,
    effectiveApproval: effectiveApproval(row),
    allowUnattended: row.allowUnattended,
    whenToUse: row.whenToUse,
    card: meta.card ?? null,
    hasTotp: row.hasTotp,
    disabled: row.disabled,
    field: row.field,
    lastUsedAt: row.lastUsedAt,
    lastUsedBy: row.lastUsedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function backendsView() {
  const views = [];
  const connect = connectConfig();
  for (const name of ["onepassword-connect", "local"] as BackendName[]) {
    const read = readBackends().get(name);
    if (!read) {
      views.push({ name, configured: false, read: { state: "unconfigured" } as BackendStatus });
      continue;
    }
    const write = writeBackends().get(name);
    const readStatus = await backendStatus(name);
    const writeStatus = name === "local" ? readStatus : await write!.status();
    const expiry = (backend?: VaultBackend) =>
      (backend as { tokenExpiresAt?: () => Date | undefined } | undefined)?.tokenExpiresAt?.() ??
      null;
    views.push({
      name,
      configured: true,
      read: readStatus,
      write: writeStatus,
      capabilities: write?.capabilities ?? read.capabilities,
      ...(name === "onepassword-connect" && connect
        ? {
            host: connect.host,
            vaultId: connect.vaultId,
            readTokenExpiresAt: expiry(read),
            writeTokenExpiresAt: expiry(write),
          }
        : {}),
    });
  }
  return views;
}

export async function overview(options: { refresh?: boolean } = {}) {
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
    primaryBackend: primaryBackend(),
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

export async function detail(handle: string) {
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
) {
  await assertHandleFree(input.policy.handle);
  const name = primaryBackend();
  const backend = backendFor(name);
  if (!backend.create) throw Boom.badRequest(`The ${name} backend is read-only`);
  const draft: ItemDraft = {
    kind: input.kind,
    title: input.title,
    urls: input.urls,
    values: input.values,
  };
  let externalId: string;
  let summary: BackendItemSummary;
  try {
    externalId = await backend.create(draft);
    summary = await backend.describe(externalId);
  } catch (error) {
    backendFailure(error);
  }
  const origins = input.policy.origins.length > 0 ? input.policy.origins : originsFrom(input.urls);
  const [inserted] = await db
    .insert(vaultItems)
    .values({
      handle: input.policy.handle,
      kind: input.kind,
      backend: name,
      externalId,
      label: input.policy.label ?? input.title,
      ...policyData({ ...input.policy, origins }, input.kind),
      ...metadataOf(summary),
    })
    .returning();
  const row = inserted!;
  candidatesCache = undefined;
  await audit({ item: row, handle: row.handle, tool: actor.via, target: name, outcome: "created" });
  return itemView(row);
}

export async function linkItem(input: {
  backend: BackendName;
  externalId: string;
  policy: PolicyDTO;
}) {
  await assertHandleFree(input.policy.handle);
  const backend = readBackends().get(input.backend);
  if (!backend) throw Boom.badRequest(`The ${input.backend} backend is not configured`);
  let summary: BackendItemSummary;
  try {
    summary = await backend.describe(input.externalId);
  } catch (error) {
    backendFailure(error);
  }
  if (summary.kind === "other")
    throw Boom.badRequest("This kind of 1Password item can't be used by bots");
  const origins =
    input.policy.origins.length > 0 ? input.policy.origins : originsFrom(summary.urls);
  const [inserted] = await db
    .insert(vaultItems)
    .values({
      handle: input.policy.handle,
      kind: summary.kind,
      backend: input.backend,
      externalId: input.externalId,
      label: input.policy.label ?? summary.title,
      ...policyData({ ...input.policy, origins }, summary.kind),
      ...metadataOf(summary),
    })
    .returning();
  const row = inserted!;
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
) {
  const row = await findOrThrow(handle);
  const kind = row.kind as VaultKind;
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
    ...policyData(input.policy ?? {}, kind),
    ...metadata,
  };
  // Drizzle refuses an empty SET; with nothing to change the row stands as it is.
  let updated = row;
  if (Object.keys(data).length > 0) {
    const [changed] = await db
      .update(vaultItems)
      .set(data)
      .where(eq(vaultItems.id, row.id))
      .returning();
    // Deleted meanwhile (Prisma's P2025 → 404).
    if (!changed) throw Boom.notFound("Record not found");
    updated = changed;
  }
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

export async function deleteItem(handle: string, options: { purge: boolean }) {
  const row = await findOrThrow(handle);
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

/** One value for the owner's browser. Registered with the redactor and audited. */
export async function reveal(handle: string, field: ValueField, purpose: "reveal" | "copy") {
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
