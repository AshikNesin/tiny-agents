/**
 * At-rest encryption for connection secrets (issue #1 D13): AES-256-GCM with
 * a key derived from SECRETS_KEY. Stored as `v1:<iv>:<tag>:<ciphertext>`
 * (base64). Secrets never leave the server.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export class SecretsKeyMissingError extends Error {
  constructor() {
    super("SECRETS_KEY is not set: connection secrets can't be stored or read");
    this.name = "SecretsKeyMissingError";
  }
}

function key(): Buffer {
  const raw = process.env.SECRETS_KEY?.trim();
  if (!raw) throw new SecretsKeyMissingError();
  return createHash("sha256").update(raw).digest();
}

export function hasSecretsKey(): boolean {
  return Boolean(process.env.SECRETS_KEY?.trim());
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), data]
    .map((p) => (typeof p === "string" ? p : p.toString("base64")))
    .join(":");
}

export function decryptSecret(stored: string): string {
  const [version, iv, tag, data] = stored.split(":");
  if (version !== "v1" || !iv || !tag || data === undefined) throw new Error("Unreadable secret");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString(
    "utf8",
  );
}

export function encryptJson(value: unknown): string {
  return encryptSecret(JSON.stringify(value));
}

export function decryptJson<T>(stored: string | null | undefined, fallback: T): T {
  if (!stored) return fallback;
  return JSON.parse(decryptSecret(stored)) as T;
}
