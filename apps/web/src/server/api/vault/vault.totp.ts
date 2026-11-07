/**
 * RFC 6238 one-time codes from an item's seed: an `otpauth://totp/…` URI or
 * a bare base32 secret (what 1Password stores in an OTP field).
 */
import { createHmac } from "node:crypto";

export interface TotpSpec {
  secret: Buffer;
  digits: number;
  period: number;
  algorithm: "sha1" | "sha256" | "sha512";
}

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error("Invalid base32 secret");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The seed's parameters, or `undefined` when it isn't a TOTP seed. */
export function parseTotp(seed: string): TotpSpec | undefined {
  const raw = seed.trim();
  if (!raw) return undefined;
  try {
    if (raw.toLowerCase().startsWith("otpauth://")) {
      const url = new URL(raw);
      if (url.host.toLowerCase() !== "totp") return undefined;
      const secret = url.searchParams.get("secret");
      if (!secret) return undefined;
      const algorithm = (url.searchParams.get("algorithm") ?? "SHA1").toLowerCase();
      return {
        secret: base32Decode(secret),
        digits: Number(url.searchParams.get("digits") ?? 6) || 6,
        period: Number(url.searchParams.get("period") ?? 30) || 30,
        algorithm: algorithm === "sha256" || algorithm === "sha512" ? algorithm : "sha1",
      };
    }
    const secret = base32Decode(raw);
    return secret.length > 0 ? { secret, digits: 6, period: 30, algorithm: "sha1" } : undefined;
  } catch {
    return undefined;
  }
}

/** The code for `at` (epoch ms). */
export function totpCode(spec: TotpSpec, at = Date.now()): string {
  const counter = Math.floor(at / 1000 / spec.period);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac(spec.algorithm, spec.secret).update(message).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** spec.digits;
  return String(binary).padStart(spec.digits, "0");
}
