import {
  createCipheriv,
  createHash,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { appEnv } from "../env";

export type SecretPurpose = "vault-local" | "connection" | "push";

export interface SecretBinding {
  purpose: SecretPurpose;
  record: string;
  field: string;
  policy?: string;
}

export class SecretLockedError extends Error {
  constructor(
    readonly reason: "no_key" | "key_mismatch" | "unreadable" | "weak_key",
    message: string,
  ) {
    super(message);
    this.name = "SecretLockedError";
  }
}

const VERSION = "v2";
const SALT = Buffer.from("tiny-agents/secret-box");
const MIN_KEY_BYTES = 32;

interface DerivedKey {
  key: Buffer;
  kid: string;
}

const derived = new Map<string, DerivedKey>();

function keyMaterialBytes(value: string): number {
  const hex = /^[0-9a-f]+$/i.exec(value);
  if (hex && value.length % 2 === 0) return value.length / 2;
  const decoded = Buffer.from(value, "base64");
  const canonical = value.replaceAll("-", "+").replaceAll("_", "/").replace(/=+$/, "");
  return decoded.toString("base64").replace(/=+$/, "") === canonical
    ? decoded.length
    : Buffer.byteLength(value, "utf8");
}

export function secretKeyProblem(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const key = value.trim();
  const bytes = keyMaterialBytes(key);
  if (bytes < MIN_KEY_BYTES) {
    return (
      `SECRETS_KEY is too short: it holds ${bytes} bytes of key material, ` +
      `at least 32 are required. Use a long random string, e.g. openssl rand -base64 32.`
    );
  }
  return undefined;
}

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

export function seal(plain: string, binding: SecretBinding): string {
  const { key, kid } = currentKey(binding.purpose);
  const problem = secretKeyProblem(appEnv().SECRETS_KEY);
  if (problem) throw new SecretLockedError("weak_key", problem);
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
