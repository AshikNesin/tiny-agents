import bcrypt from "bcryptjs";
import {
  fromBase64Url,
  timingSafeEqual,
  toBase64Url,
  utf8Encode,
  type Bytes,
} from "./encoding.utils";

const ALGORITHM = "pbkdf2-sha256";
const ITERATIONS = 600_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;

export function dummyPasswordHash(): string {
  return `${ALGORITHM}$${ITERATIONS}$${"A".repeat(22)}$${"A".repeat(43)}`;
}

async function derive(password: string, salt: Bytes, iterations: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey("raw", utf8Encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, ITERATIONS);
  return `${ALGORITHM}$${ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (isLegacyBcrypt(stored)) return bcrypt.compare(password, stored);
  const [algorithm, iterations, salt, hash] = stored.split("$");
  if (algorithm !== ALGORITHM || !iterations || !salt || !hash) return false;
  try {
    const expected = fromBase64Url(hash);
    const actual = await derive(password, fromBase64Url(salt), Number(iterations));
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function needsRehash(stored: string): boolean {
  const [algorithm, iterations] = stored.split("$");
  return algorithm !== ALGORITHM || Number(iterations) !== ITERATIONS;
}

function isLegacyBcrypt(stored: string): boolean {
  return /^\$2[aby]\$\d{2}\$/.test(stored);
}
