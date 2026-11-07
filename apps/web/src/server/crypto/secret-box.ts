/**
 * At-rest encryption for every secret the app stores itself (issue #179,
 * ADR 0005): the local vault backend's items and a connection's header
 * secret and OAuth state.
 *
 * - One key per purpose, derived from SECRETS_KEY with HKDF-SHA256, so a
 *   ciphertext of one subsystem never opens in another.
 * - AES-256-GCM with a random 96-bit IV per write.
 * - The binding (purpose, record, field and an optional policy digest) is
 *   the AAD: a ciphertext copied to another row or field, or one whose
 *   policy was changed behind the service's back, does not decrypt.
 * - Stored as `v2:<kid>:<iv>:<tag>:<ciphertext>` (base64url), where `kid`
 *   fingerprints the derived key. SECRETS_KEY_PREVIOUS opens values written
 *   under the old key until `pnpm secrets:rotate` rewrites them.
 *
 * Node only (`node:crypto`); `packages/core` stays runtime-neutral.
 */
import {
  createCipheriv,
  createHash,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { appEnv } from "../env";

export type SecretPurpose = "vault-local" | "connection";

/** What a ciphertext is bound to. Every field is part of the AAD. */
export interface SecretBinding {
  purpose: SecretPurpose;
  /** The row (or KV key) the value belongs to. */
  record: string;
  /** The column or field within it. */
  field: string;
  /** A digest of the policy the value may be used under (hosts, injection, audience). */
  policy?: string;
}

/** Why a stored secret can't be read; callers show the message to the owner. */
export class SecretLockedError extends Error {
  constructor(
    readonly reason: "no_key" | "key_mismatch" | "unreadable",
    message: string,
  ) {
    super(message);
    this.name = "SecretLockedError";
  }
}

const VERSION = "v2";
const SALT = Buffer.from("tiny-agents/secret-box");

interface DerivedKey {
  key: Buffer;
  kid: string;
}

const derived = new Map<string, DerivedKey>();

function derive(ikm: string, purpose: SecretPurpose): DerivedKey {
  const cacheKey = `${purpose}\0${ikm}`;
  let entry = derived.get(cacheKey);
  if (!entry) {
    const key = Buffer.from(hkdfSync("sha256", ikm, SALT, `tiny-agents/${purpose}/v2`, 32));
    const kid = createHmac("sha256", key).update("kid").digest("base64url").slice(0, 11);
    entry = { key, kid };
    derived.set(cacheKey, entry);
  }
  return entry;
}

function keys(purpose: SecretPurpose): { current?: DerivedKey; previous?: DerivedKey } {
  const env = appEnv();
  const current = env.SECRETS_KEY?.trim();
  const previous = env.SECRETS_KEY_PREVIOUS?.trim();
  return {
    ...(current ? { current: derive(current, purpose) } : {}),
    ...(previous ? { previous: derive(previous, purpose) } : {}),
  };
}

export function hasSecretsKey(): boolean {
  return Boolean(appEnv().SECRETS_KEY?.trim());
}

function currentKey(purpose: SecretPurpose): DerivedKey {
  const { current } = keys(purpose);
  if (!current) {
    throw new SecretLockedError("no_key", "SECRETS_KEY is not set: stored secrets can't be read.");
  }
  return current;
}

function aad(binding: SecretBinding): Buffer {
  return Buffer.from(
    JSON.stringify([binding.purpose, binding.record, binding.field, binding.policy ?? ""]),
  );
}

/** Encrypt `plain` under the current key, bound to `binding`. */
export function seal(plain: string, binding: SecretBinding): string {
  const { key, kid } = currentKey(binding.purpose);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(binding));
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, kid, iv, cipher.getAuthTag(), data]
    .map((p) => (typeof p === "string" ? p : p.toString("base64url")))
    .join(":");
}

function parse(stored: string) {
  const [version, kid, iv, tag, data] = stored.split(":");
  if (version !== VERSION || !kid || !iv || !tag || data === undefined) {
    throw new SecretLockedError("unreadable", "The stored secret is in an unknown format.");
  }
  return { kid, iv, tag, data };
}

/** Decrypt a value `seal` wrote for the same binding. */
export function open(stored: string, binding: SecretBinding): string {
  const parts = parse(stored);
  const { current, previous } = keys(binding.purpose);
  if (!current) {
    throw new SecretLockedError("no_key", "SECRETS_KEY is not set: stored secrets can't be read.");
  }
  const key = [current, previous].find((k) => k?.kid === parts.kid)?.key;
  if (!key) {
    throw new SecretLockedError(
      "key_mismatch",
      "The secret was stored under a different SECRETS_KEY. Re-enter it.",
    );
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parts.iv, "base64url"));
    decipher.setAAD(aad(binding));
    decipher.setAuthTag(Buffer.from(parts.tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(parts.data, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new SecretLockedError(
      "unreadable",
      "The stored secret doesn't match its record or policy. Re-enter it.",
    );
  }
}

/** True when `stored` was written under a key other than the current one. */
export function needsReseal(stored: string, purpose: SecretPurpose): boolean {
  return parse(stored).kid !== currentKey(purpose).kid;
}

export function sealJson(value: unknown, binding: SecretBinding): string {
  return seal(JSON.stringify(value), binding);
}

export function openJson<T>(
  stored: string | null | undefined,
  binding: SecretBinding,
): T | undefined {
  if (!stored) return undefined;
  return JSON.parse(open(stored, binding)) as T;
}

/**
 * A stable digest of the policy a value may be used under. Keys are sorted
 * and `undefined` entries dropped, so the digest depends only on the content.
 */
export function policyDigest(policy: Record<string, unknown>): string {
  return createHash("sha256").update(canonical(policy)).digest("base64url");
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}
