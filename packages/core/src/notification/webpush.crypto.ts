import { fromBase64Url, toBase64Url, utf8Encode, type Bytes } from "../utils/encoding.utils";

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface VapidKeys {
  publicKey: string;
  privateJwk: JsonWebKey;
}

const RECORD_SIZE = 4096;
const P256 = { name: "ECDH", namedCurve: "P-256" } as const;
const ES256 = { name: "ECDSA", namedCurve: "P-256" } as const;

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Bytes> {
  const imported = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", imported, new Uint8Array(data)));
}

async function expand(prk: Uint8Array, info: Uint8Array, length: number): Promise<Bytes> {
  return (await hmac(prk, concat(info, new Uint8Array([1])))).slice(0, length);
}

function pointJwk(point: Uint8Array): JsonWebKey {
  if (point.length !== 65 || point[0] !== 4) {
    throw new Error("A P-256 public key is a 65-byte uncompressed point");
  }
  return {
    kty: "EC",
    crv: "P-256",
    x: toBase64Url(point.slice(1, 33)),
    y: toBase64Url(point.slice(33, 65)),
    ext: true,
  };
}

export interface EncryptOptions {
  salt?: Uint8Array;
  senderKeys?: { privateJwk: JsonWebKey; publicKey: string };
}

export async function encryptPayload(
  plaintext: Uint8Array,
  target: Pick<PushTarget, "p256dh" | "auth">,
  options: EncryptOptions = {},
): Promise<Bytes> {
  const uaPublic = fromBase64Url(target.p256dh);
  const authSecret = fromBase64Url(target.auth);
  const salt = options.salt ?? crypto.getRandomValues(new Uint8Array(16));

  let senderPrivate: CryptoKey;
  let asPublic: Bytes;
  if (options.senderKeys) {
    senderPrivate = await crypto.subtle.importKey(
      "jwk",
      options.senderKeys.privateJwk,
      P256,
      false,
      ["deriveBits"],
    );
    asPublic = fromBase64Url(options.senderKeys.publicKey);
  } else {
    const pair = (await crypto.subtle.generateKey(P256, true, ["deriveBits"])) as CryptoKeyPair;
    senderPrivate = pair.privateKey;
    asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  }
  const receiver = await crypto.subtle.importKey("jwk", pointJwk(uaPublic), P256, false, []);
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: receiver }, senderPrivate, 256),
  );

  const prkKey = await hmac(authSecret, ecdhSecret);
  const keyInfo = concat(utf8Encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await expand(prkKey, keyInfo, 32);
  const prk = await hmac(salt, ikm);
  const [cek, nonce] = await Promise.all([
    expand(prk, utf8Encode("Content-Encoding: aes128gcm\0"), 16),
    expand(prk, utf8Encode("Content-Encoding: nonce\0"), 12),
  ]);

  const record = concat(plaintext, new Uint8Array([2]));
  if (record.length + 16 > RECORD_SIZE) throw new Error("Push payload is too large");
  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, record),
  );

  const header = new Uint8Array(16 + 4 + 1);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  return concat(header, asPublic, ciphertext);
}

export async function generateVapidKeys(): Promise<VapidKeys> {
  const pair = (await crypto.subtle.generateKey(ES256, true, ["sign", "verify"])) as CryptoKeyPair;
  const publicKey = toBase64Url(
    new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)),
  );
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { publicKey, privateJwk };
}

export async function vapidAuthorization(
  endpoint: string,
  keys: VapidKeys,
  subject: string,
  nowMs: number = Date.now(),
  ttlSeconds = 12 * 60 * 60,
): Promise<string> {
  const json = (value: unknown) => toBase64Url(utf8Encode(JSON.stringify(value)));
  const unsigned = `${json({ typ: "JWT", alg: "ES256" })}.${json({
    aud: new URL(endpoint).origin,
    exp: Math.floor(nowMs / 1000) + ttlSeconds,
    sub: subject,
  })}`;
  const key = await crypto.subtle.importKey(
    "jwk",
    { ...keys.privateJwk, key_ops: ["sign"] },
    ES256,
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, utf8Encode(unsigned)),
  );
  return `vapid t=${unsigned}.${toBase64Url(signature)}, k=${keys.publicKey}`;
}

export async function pushTopic(tag: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", utf8Encode(tag)));
  return toBase64Url(digest).slice(0, 32);
}
