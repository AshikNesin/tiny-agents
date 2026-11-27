import { parseJson } from "@tiny-agents/std";
import { z } from "zod";
import { createNamespaceKv } from "@groot/core/kv";
import { logger } from "@groot/core/logger";
import { generateVapidKeys, type VapidKeys } from "@groot/core/notification/webpush.crypto";
import { hasSecretsKey, needsReseal, open, seal } from "../../crypto/secret-box";
import { app } from "../../app-root";

const KEY = "vapid";
const BINDING = { purpose: "push", record: "WEB_PUSH:vapid", field: "privateJwk" } as const;

interface StoredVapid {
  publicKey: string;
  privateJwk: string;
}

const kv = () => createNamespaceKv("WEB_PUSH");

function sealed(privateJwk: JsonWebKey): string {
  const json = JSON.stringify(privateJwk);
  return hasSecretsKey() ? seal(json, BINDING) : json;
}

const jwkSchema: z.ZodType<JsonWebKey> = z.looseObject({ kty: z.string() });

function opened(stored: StoredVapid): VapidKeys {
  const plain = stored.privateJwk.startsWith("{")
    ? stored.privateJwk
    : open(stored.privateJwk, BINDING);
  return {
    publicKey: stored.publicKey,
    privateJwk: parseJson("The Web Push private key", plain, jwkSchema),
  };
}

export async function vapidKeys(onReplaced?: () => Promise<void>): Promise<VapidKeys> {
  const cached = app().webPush.keys;
  if (cached) return cached;
  const store = kv();
  const stored = await store.get<StoredVapid>(KEY);
  if (stored) {
    try {
      const keys = opened(stored);
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

export async function clearVapidKeysForTests(): Promise<void> {
  app().webPush.keys = undefined;
  await kv().delete(KEY);
}
