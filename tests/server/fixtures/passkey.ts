import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { db, passkeys } from "@groot/core/database";

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest();

export async function createSoftPasskey(
  userId: number,
  { rpId = "localhost", origin = "http://localhost:3000" } = {},
) {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const coseKey = isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, new Uint8Array(Buffer.from(jwk.x!, "base64url"))],
      [-3, new Uint8Array(Buffer.from(jwk.y!, "base64url"))],
    ]),
  );
  const credentialId = randomBytes(16).toString("base64url");
  await db.insert(passkeys).values({
    userId,
    credentialId,
    publicKey: Buffer.from(coseKey),
    transports: ["internal"],
    deviceType: "singleDevice",
    credentialName: "Soft passkey",
  });

  let counter = 0;
  return {
    credentialId,
    assert(challenge: string): AuthenticationResponseJSON {
      counter += 1;
      const clientDataJSON = Buffer.from(
        JSON.stringify({ type: "webauthn.get", challenge, origin, crossOrigin: false }),
      );
      const signCount = Buffer.alloc(4);
      signCount.writeUInt32BE(counter);
      const authenticatorData = Buffer.concat([sha256(rpId), Buffer.from([0x05]), signCount]);
      const signature = sign(
        "sha256",
        Buffer.concat([authenticatorData, sha256(clientDataJSON)]),
        privateKey,
      );
      return {
        id: credentialId,
        rawId: credentialId,
        type: "public-key",
        response: {
          clientDataJSON: clientDataJSON.toString("base64url"),
          authenticatorData: authenticatorData.toString("base64url"),
          signature: signature.toString("base64url"),
        },
        clientExtensionResults: {},
      };
    },
  };
}
