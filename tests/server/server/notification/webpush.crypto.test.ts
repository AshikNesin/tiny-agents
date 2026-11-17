/**
 * Web Push crypto (RFC 8291 / RFC 8292) against the RFC's own example and an
 * independent receiver built on node:crypto: what the phone does to read a
 * push, and what a push service does to check the VAPID token.
 */
import { createECDH, createPublicKey, createVerify, hkdfSync, createDecipheriv } from "node:crypto";
import { describe, expect, it } from "vite-plus/test";
import {
  encryptPayload,
  generateVapidKeys,
  pushTopic,
  vapidAuthorization,
} from "@groot/core/notification/webpush.crypto";
import { fromBase64Url, toBase64Url } from "@groot/core/utils/encoding.utils";

/** RFC 8291 Appendix A. */
const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  asPublic:
    "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  uaPublic:
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  body: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

const jwkOf = (privateKey: string, publicKey: string): JsonWebKey => {
  const point = fromBase64Url(publicKey);
  return {
    kty: "EC",
    crv: "P-256",
    ...(privateKey ? { d: privateKey } : {}),
    x: toBase64Url(point.slice(1, 33)),
    y: toBase64Url(point.slice(33, 65)),
  };
};

/** A receiver on node:crypto: a fresh key pair and a decrypt for one aes128gcm record. */
function receiver() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    target: { p256dh: toBase64Url(ecdh.getPublicKey()), auth: toBase64Url(auth) },
    decrypt(body: Uint8Array): string {
      const buf = Buffer.from(body);
      const salt = buf.subarray(0, 16);
      const idLength = buf[20]!;
      const asPublic = buf.subarray(21, 21 + idLength);
      const ciphertext = buf.subarray(21 + idLength);
      const secret = ecdh.computeSecret(asPublic);
      const info = Buffer.concat([Buffer.from("WebPush: info\0"), ecdh.getPublicKey(), asPublic]);
      const ikm = Buffer.from(hkdfSync("sha256", secret, auth, info, 32));
      const cek = Buffer.from(hkdfSync("sha256", ikm, salt, "Content-Encoding: aes128gcm\0", 16));
      const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, "Content-Encoding: nonce\0", 12));
      const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
      decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
      const plain = Buffer.concat([
        decipher.update(ciphertext.subarray(0, ciphertext.length - 16)),
        decipher.final(),
      ]);
      expect(plain[plain.length - 1]).toBe(2);
      return plain.subarray(0, plain.length - 1).toString("utf8");
    },
  };
}

describe("Web Push payload encryption", () => {
  it("reproduces the RFC 8291 example byte for byte", async () => {
    const body = await encryptPayload(
      new TextEncoder().encode(RFC.plaintext),
      { p256dh: RFC.uaPublic, auth: RFC.auth },
      {
        salt: fromBase64Url(RFC.salt),
        senderKeys: { privateJwk: jwkOf(RFC.asPrivate, RFC.asPublic), publicKey: RFC.asPublic },
      },
    );
    expect(toBase64Url(body)).toBe(RFC.body);
  });

  it("produces a body an independent receiver decrypts, with a fresh key each time", async () => {
    const phone = receiver();
    const text = JSON.stringify({ v: 1, kind: "show", title: "✋ Ops needs approval" });
    const first = await encryptPayload(new TextEncoder().encode(text), phone.target);
    const second = await encryptPayload(new TextEncoder().encode(text), phone.target);
    expect(phone.decrypt(first)).toBe(text);
    expect(phone.decrypt(second)).toBe(text);
    expect(toBase64Url(first)).not.toBe(toBase64Url(second));
  });

  it("refuses a payload that doesn't fit one 4096-byte record", async () => {
    const phone = receiver();
    await expect(encryptPayload(new Uint8Array(4080), phone.target)).rejects.toThrow(/too large/);
  });
});

describe("VAPID", () => {
  it("signs an ES256 JWT for the endpoint's origin that verifies with the public key", async () => {
    const keys = await generateVapidKeys();
    const header = await vapidAuthorization(
      "https://fcm.googleapis.com/fcm/send/abc:123",
      keys,
      "https://agents.example.com",
      1_800_000_000_000,
    );
    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
    expect(match).not.toBeNull();
    const [, head, claims, signature, k] = match!;
    expect(k).toBe(keys.publicKey);
    expect(JSON.parse(Buffer.from(head!, "base64url").toString())).toEqual({
      typ: "JWT",
      alg: "ES256",
    });
    expect(JSON.parse(Buffer.from(claims!, "base64url").toString())).toEqual({
      aud: "https://fcm.googleapis.com",
      exp: 1_800_000_000 + 12 * 60 * 60,
      sub: "https://agents.example.com",
    });
    const publicKey = createPublicKey({
      key: jwkOf("", keys.publicKey) as import("node:crypto").webcrypto.JsonWebKey,
      format: "jwk",
    });
    const verify = createVerify("SHA256");
    verify.update(`${head}.${claims}`);
    expect(
      verify.verify(
        { key: publicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(signature!, "base64url"),
      ),
    ).toBe(true);
  });

  it("derives a topic of at most 32 base64url characters, stable per tag", async () => {
    const topic = await pushTopic("approval:12:34");
    expect(topic).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(await pushTopic("approval:12:34")).toBe(topic);
    expect(await pushTopic("approval:12:35")).not.toBe(topic);
  });
});
