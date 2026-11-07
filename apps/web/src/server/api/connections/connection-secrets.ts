/**
 * A connection's stored secrets (its header value and OAuth state), sealed
 * with the `connection` purpose and bound to the row and column they live
 * in, so a value copied to another connection or column doesn't open.
 */
import { and, eq } from "drizzle-orm";
import { connections, db } from "../../db";
import {
  needsReseal,
  open,
  openJson,
  seal,
  sealJson,
  type SecretBinding,
} from "../../secrets/secret-box";

const binding = (connectionId: string, field: "secret_enc" | "oauth_enc"): SecretBinding => ({
  purpose: "connection",
  record: connectionId,
  field,
});

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

/**
 * Rewrite every connection secret still sealed under SECRETS_KEY_PREVIOUS
 * under the current key (`pnpm secrets:rotate`). Each write is a
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
  let count = 0;
  for (const row of rows) {
    if (row.secretEnc && needsReseal(row.secretEnc, "connection")) {
      const next = sealHeaderSecret(row.id, openHeaderSecret(row.id, row.secretEnc));
      const done = await db
        .update(connections)
        .set({ secretEnc: next })
        .where(and(eq(connections.id, row.id), eq(connections.secretEnc, row.secretEnc)))
        .returning({ id: connections.id });
      count += done.length;
    }
    if (row.oauthEnc && needsReseal(row.oauthEnc, "connection")) {
      const next = sealOAuthState(row.id, openOAuthState(row.id, row.oauthEnc));
      const done = await db
        .update(connections)
        .set({ oauthEnc: next })
        .where(and(eq(connections.id, row.id), eq(connections.oauthEnc, row.oauthEnc)))
        .returning({ id: connections.id });
      count += done.length;
    }
  }
  return count;
}
