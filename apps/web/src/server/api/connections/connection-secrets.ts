/**
 * A connection's secrets. Its header value is a vault item (Q4): one the
 * owner picked (`secretRef`), or its own (`secretItemId`), which this module
 * writes and deletes with the connection. Its OAuth state is sealed on the
 * row with the `connection` purpose, bound to the row and column, so a value
 * copied to another connection or column doesn't open. Before Q4 the header
 * value was sealed the same way in `secret_enc`; the startup import
 * (`vault/vault.import.ts`) moves it into the connection's own item.
 */
import { and, eq } from "drizzle-orm";
import { connections, db, vaultAuditEvents, vaultItems } from "../../db";
import {
  needsReseal,
  open,
  openJson,
  seal,
  sealJson,
  type SecretBinding,
} from "../../crypto/secret-box";
import type { DbTx } from "../vault/backends/types";
import { deleteLocalItem, insertLocalItem, replaceLocalItem } from "../vault/backends/local";
import { vaultPolicyDigest } from "../vault/vault.policy";

const binding = (connectionId: string, field: "secret_enc" | "oauth_enc"): SecretBinding => ({
  purpose: "connection",
  record: connectionId,
  field,
});

/** A header value in the pre-Q4 `secret_enc` format (tests seed old installs with it). */
export function sealHeaderSecret(connectionId: string, value: string): string {
  return seal(value, binding(connectionId, "secret_enc"));
}

export function openHeaderSecret(connectionId: string, stored: string): string {
  return open(stored, binding(connectionId, "secret_enc"));
}

export function sealOAuthState(connectionId: string, state: unknown): string {
  return sealJson(state, binding(connectionId, "oauth_enc"));
}

export function openOAuthState<T>(
  connectionId: string,
  stored: string | null | undefined,
): T | undefined {
  return openJson<T>(stored, binding(connectionId, "oauth_enc"));
}

// ── The connection's own header value (Q4) ──────────────────────────────

/** What writing a connection's own item needs to know about it. */
export interface OwnSecretTarget {
  id: string;
  name: string;
  slug: string;
  url: string;
  secretItemId: string | null;
}

/** Who wrote it, for the item's audit trail. */
type Via = "connections" | "vault_import";

/**
 * The own item's policy: an API key for the connection's host that only the
 * connection uses. No bot may (`bots: []`), and its only tool is `mcp`.
 */
function ownPolicy(url: string) {
  return {
    audience: "bots",
    originsJson: "[]",
    hostsJson: JSON.stringify([new URL(url).hostname.toLowerCase()]),
    injectJson: null,
  };
}

/** `mcp-<slug>`, or the first `mcp-<slug>-<n>` no item holds. */
function freeHandle(tx: DbTx, slug: string): string {
  for (let n = 1; ; n++) {
    const handle = n === 1 ? `mcp-${slug}` : `mcp-${slug}-${n}`;
    const taken = tx
      .select({ id: vaultItems.id })
      .from(vaultItems)
      .where(eq(vaultItems.handle, handle))
      .get();
    if (!taken) return handle;
  }
}

/**
 * Write `value` as the connection's own header value, in the caller's
 * synchronous transaction: into the item it has (sealed afresh for the URL's
 * host), else a new item linked from `secret_item_id`. Clears `secret_enc`.
 * Returns the item's id.
 */
export function writeOwnHeaderSecret(
  tx: DbTx,
  connection: OwnSecretTarget,
  value: string,
  via: Via,
): string {
  const policy = ownPolicy(connection.url);
  const digest = vaultPolicyDigest(policy);
  const label = `MCP connection: ${connection.name}`;
  const draft = { kind: "api_key" as const, title: label, urls: [], values: { value } };
  const found = connection.secretItemId
    ? tx.select().from(vaultItems).where(eq(vaultItems.id, connection.secretItemId)).get()
    : undefined;
  let item: { id: string; handle: string };
  const existing = found?.backend === "local" ? found : undefined;
  if (existing) {
    replaceLocalItem(tx, existing.externalId, { ...draft, title: existing.label }, digest);
    tx.update(vaultItems)
      // The digest covers exactly these, so the re-seal above opens under the row.
      .set({
        audience: policy.audience,
        originsJson: policy.originsJson,
        hostsJson: policy.hostsJson,
        injectJson: policy.injectJson,
      })
      .where(eq(vaultItems.id, existing.id))
      .run();
    item = existing;
  } else {
    const externalId = insertLocalItem(tx, draft, digest);
    item = tx
      .insert(vaultItems)
      .values({
        handle: freeHandle(tx, connection.slug),
        kind: "api_key",
        backend: "local",
        externalId,
        field: "value",
        label,
        ...policy,
        toolsJson: JSON.stringify(["mcp"]),
        botsJson: "[]",
      })
      .returning({ id: vaultItems.id, handle: vaultItems.handle })
      .get();
  }
  tx.update(connections)
    .set({ secretItemId: item.id, secretEnc: null })
    .where(eq(connections.id, connection.id))
    .run();
  tx.insert(vaultAuditEvents)
    .values({
      itemId: item.id,
      handle: item.handle,
      tool: via,
      target: `mcp:${connection.slug}`,
      outcome: existing ? "updated" : "created",
      reason: "values: value",
    })
    .run();
  return item.id;
}

/**
 * Delete the connection's own item (its row and value), in the caller's
 * synchronous transaction. The caller clears or deletes the connection row.
 */
export function deleteOwnHeaderSecret(tx: DbTx, itemId: string, slug: string): void {
  const item = tx.select().from(vaultItems).where(eq(vaultItems.id, itemId)).get();
  if (!item) return;
  if (item.backend === "local") deleteLocalItem(tx, item.externalId);
  tx.delete(vaultItems).where(eq(vaultItems.id, item.id)).run();
  tx.insert(vaultAuditEvents)
    .values({
      handle: item.handle,
      tool: "connections",
      target: `mcp:${slug}`,
      outcome: "deleted",
      reason: "the connection no longer uses it",
    })
    .run();
}

/** The handle of the connection's own item, or why there is none to send. */
export function ownHeaderHandle(itemId: string): string {
  const item = db
    .select({ handle: vaultItems.handle })
    .from(vaultItems)
    .where(eq(vaultItems.id, itemId))
    .get();
  if (!item) {
    throw new Error("This connection's header value was deleted from the vault. Enter it again.");
  }
  return item.handle;
}

/**
 * Rewrite every connection secret still sealed under SECRETS_KEY_PREVIOUS
 * under the current key (`pnpm secrets:rotate`): OAuth state, and a header
 * value the startup import has not moved yet. Each write is a
 * compare-and-set, so a value changed meanwhile is left alone. Returns how
 * many values it rewrote.
 */
export async function resealConnectionSecrets(): Promise<number> {
  const rows = await db
    .select({
      id: connections.id,
      secretEnc: connections.secretEnc,
      oauthEnc: connections.oauthEnc,
    })
    .from(connections);
  // Each write is its own compare-and-set, so they can run together.
  const writes = rows.flatMap((row) => [
    ...(row.secretEnc && needsReseal(row.secretEnc, "connection")
      ? [
          db
            .update(connections)
            .set({ secretEnc: sealHeaderSecret(row.id, openHeaderSecret(row.id, row.secretEnc)) })
            .where(and(eq(connections.id, row.id), eq(connections.secretEnc, row.secretEnc)))
            .returning({ id: connections.id }),
        ]
      : []),
    ...(row.oauthEnc && needsReseal(row.oauthEnc, "connection")
      ? [
          db
            .update(connections)
            .set({ oauthEnc: sealOAuthState(row.id, openOAuthState(row.id, row.oauthEnc)) })
            .where(and(eq(connections.id, row.id), eq(connections.oauthEnc, row.oauthEnc)))
            .returning({ id: connections.id }),
        ]
      : []),
  ]);
  return (await Promise.all(writes)).reduce((sum, done) => sum + done.length, 0);
}
