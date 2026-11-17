/**
 * The server's VAPID key pair (issue #306): made on first use and kept in
 * KV, the private key sealed with `SECRETS_KEY` (purpose `push`) when one is
 * set. Phones register with the public key; every push is signed with the
 * private one. No provider account or shared secret is involved.
 *
 * If the stored key can't be opened (SECRETS_KEY changed), a new pair is
 * made and every device is revoked: their endpoints were bound to the old
 * key, and the app registers again when it sees a different key.
 */
import { createNamespaceKv } from "@groot/core/kv";
import { logger } from "@groot/core/logger";
import { generateVapidKeys, type VapidKeys } from "@groot/core/notification/webpush.crypto";
import { hasSecretsKey, needsReseal, open, seal } from "../../crypto/secret-box";
import { app } from "../../app-root";

const KEY = "vapid";
const BINDING = { purpose: "push", record: "WEB_PUSH:vapid", field: "privateJwk" } as const;

interface StoredVapid {
  publicKey: string;
  /** The private JWK: sealed (`v2:…`) or, without SECRETS_KEY, plain JSON. */
  privateJwk: string;
}

const kv = () => createNamespaceKv("WEB_PUSH");

function sealed(privateJwk: JsonWebKey): string {
  const json = JSON.stringify(privateJwk);
  return hasSecretsKey() ? seal(json, BINDING) : json;
}

function opened(stored: StoredVapid): VapidKeys {
  const plain = stored.privateJwk.startsWith("{")
    ? stored.privateJwk
    : open(stored.privateJwk, BINDING);
  return { publicKey: stored.publicKey, privateJwk: JSON.parse(plain) as JsonWebKey };
}

/**
 * The key pair, made and stored on first use. `onReplaced` runs when a key
 * that could not be opened was replaced (the caller revokes devices).
 */
export async function vapidKeys(onReplaced?: () => Promise<void>): Promise<VapidKeys> {
  const cached = app().webPush.keys;
  if (cached) return cached;
  const store = kv();
  const stored = await store.get<StoredVapid>(KEY);
  if (stored) {
    try {
      const keys = opened(stored);
      // Under a rotated SECRETS_KEY, or sealed for the first time: write it again.
      const plain = stored.privateJwk.startsWith("{");
      if ((plain && hasSecretsKey()) || (!plain && needsReseal(stored.privateJwk, "push"))) {
        await store.set(KEY, { publicKey: keys.publicKey, privateJwk: sealed(keys.privateJwk) });
      }
      app().webPush.keys = keys;
      return keys;
    } catch (error) {
      logger.warn({ error }, "The Web Push key can't be opened; making a new one");
    }
  }
  const keys = await generateVapidKeys();
  await store.set(KEY, { publicKey: keys.publicKey, privateJwk: sealed(keys.privateJwk) });
  app().webPush.keys = keys;
  if (stored) await onReplaced?.();
  return keys;
}

/** Test seam: forget the stored and cached key pair. */
export async function clearVapidKeysForTests(): Promise<void> {
  app().webPush.keys = undefined;
  await kv().delete(KEY);
}
