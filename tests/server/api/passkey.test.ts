import { describe, expect, it } from "vite-plus/test";
import { and, eq } from "drizzle-orm";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { api, createTestApp, signIn } from "../helpers";
import { createSoftPasskey } from "../fixtures/passkey";
import { db, passkeys } from "@groot/core/database";
import { memoryRateLimitStore } from "@groot/core/rate-limit/store";
import * as passkeyService from "@groot/core/passkey/passkey.service";
import { guests } from "../../../apps/web/src/server/db";

const app = createTestApp();

interface PasskeyRow {
  id: number;
  credentialName: string | null;
  kind: string;
  label: string;
  canDelete: boolean;
}

async function storePasskey(
  userId: number,
  values: { transports: string[]; deviceType: string | null; credentialName: string },
) {
  await db.insert(passkeys).values({
    userId,
    credentialId: `cred-${crypto.randomUUID()}`,
    publicKey: Buffer.from([1, 2, 3]),
    ...values,
  });
}

function clientData(challenge: string): string {
  return Buffer.from(
    JSON.stringify({ type: "webauthn.get", challenge, origin: "http://localhost:3000" }),
  ).toString("base64url");
}

function registrationResponse(
  challenge: string,
  credentialId: Uint8Array = randomBytes(16),
): RegistrationResponseJSON {
  const { publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
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
  const credId = Buffer.from(credentialId);
  const authData = Buffer.concat([
    createHash("sha256").update("localhost").digest(),
    Buffer.from([0x45]),
    Buffer.alloc(4),
    Buffer.alloc(16),
    Buffer.from([0, credId.length]),
    credId,
    coseKey,
  ]);
  const attestationObject = Buffer.from(
    isoCBOR.encode(
      new Map<string, Uint8Array | string | Map<number, Uint8Array>>([
        ["fmt", "none"],
        ["attStmt", new Map()],
        ["authData", new Uint8Array(authData)],
      ]),
    ),
  );
  const clientDataJSON = Buffer.from(
    JSON.stringify({
      type: "webauthn.create",
      challenge,
      origin: "http://localhost:3000",
      crossOrigin: false,
    }),
  );
  const id = credId.toString("base64url");
  return {
    id,
    rawId: id,
    type: "public-key",
    response: {
      clientDataJSON: clientDataJSON.toString("base64url"),
      attestationObject: attestationObject.toString("base64url"),
      transports: ["internal"],
    },
    clientExtensionResults: {},
  };
}

describe("passkey API", () => {
  it("issues registration and login options", async () => {
    const { token } = await signIn(app);
    const reg = await api<{ challenge: string; rp: { id: string; name: string } }>(
      app,
      "/api/v1/passkey/register/options",
      {
        method: "POST",
        token,
      },
    );
    expect(reg.status).toBe(200);
    expect(reg.body.data?.rp).toEqual({ id: "localhost", name: "Groot" });
    expect(reg.body.data?.challenge).toBeTruthy();

    const login = await api<{ challenge: string; allowCredentials: unknown[] }>(
      app,
      "/api/v1/passkey/login/options",
      {
        method: "POST",
        json: {},
      },
    );
    expect(login.status).toBe(200);
    expect(login.body.data?.allowCredentials).toEqual([]);
    expect((await api(app, "/api/v1/passkey/register/options", { method: "POST" })).status).toBe(
      401,
    );
  });

  it("rejects verification with an unknown or reused challenge", async () => {
    const { token } = await signIn(app);
    const unknown = await api(app, "/api/v1/passkey/login/verify", {
      method: "POST",
      json: {
        response: {
          id: "x",
          rawId: "x",
          type: "public-key",
          response: { clientDataJSON: clientData("nope") },
        },
      },
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error?.message).toMatch(/Challenge not found or expired/);

    const options = await api<{ challenge: string }>(app, "/api/v1/passkey/register/options", {
      method: "POST",
      token,
    });
    const challenge = options.body.data!.challenge;
    const bogus = {
      response: {
        id: "cred",
        rawId: "cred",
        type: "public-key",
        response: { clientDataJSON: clientData(challenge), attestationObject: "AA" },
        clientExtensionResults: {},
      },
    };
    const first = await api(app, "/api/v1/passkey/register/verify", {
      method: "POST",
      json: bogus,
      token,
    });
    expect(first.status).toBe(400);
    expect(first.body.error?.message).not.toMatch(/Challenge not found/);
    const second = await api(app, "/api/v1/passkey/register/verify", {
      method: "POST",
      json: bogus,
      token,
    });
    expect(second.body.error?.message).toMatch(/Challenge not found or expired/);

    const malformed = await api(app, "/api/v1/passkey/login/verify", {
      method: "POST",
      json: {
        response: { id: "x", rawId: "x", type: "public-key", response: { clientDataJSON: "!!!" } },
      },
    });
    expect(malformed.status).toBe(400);
  });

  it("signs in with a passkey, once per challenge", async () => {
    const { user } = await signIn(app);
    const passkey = await createSoftPasskey(user.id);
    const options = await api<{ challenge: string }>(app, "/api/v1/passkey/login/options", {
      method: "POST",
      json: {},
    });
    const response = passkey.assert(options.body.data!.challenge);
    const verify = () =>
      api<{ token: string; user: { id: number } }>(app, "/api/v1/passkey/login/verify", {
        method: "POST",
        json: { response },
      });

    const results = await Promise.all([verify(), verify()]);
    expect(results.map((r) => r.status).toSorted()).toEqual([200, 400]);
    const signedIn = results.find((r) => r.status === 200)!;
    expect(signedIn.body.data?.user.id).toBe(user.id);
    expect(signedIn.headers.get("set-cookie")).toMatch(/^token=/);
    const replayed = results.find((r) => r.status === 400)!;
    expect(replayed.body.error?.message).toMatch(/Challenge not found or expired/);

    const [row] = await db
      .select()
      .from(passkeys)
      .where(eq(passkeys.credentialId, passkey.credentialId));
    expect(row).toMatchObject({ counter: 1, lastUsedAt: new Date(Date.now()) });
  });

  it("says how to show each passkey and whether it can be deleted", async () => {
    const { token, user } = await signIn(app);
    const list = async () =>
      (await api<PasskeyRow[]>(app, "/api/v1/passkey/list", { token })).body.data!;

    await storePasskey(user.id, {
      transports: ["usb", "nfc"],
      deviceType: "singleDevice",
      credentialName: "YubiKey",
    });
    const [only] = await list();
    expect(only).toMatchObject({
      credentialName: "YubiKey",
      kind: "security-key",
      label: "Security key (USB, NFC)",
      canDelete: false,
    });
    expect(only).not.toHaveProperty("publicKey");
    expect(only).not.toHaveProperty("credentialId");

    await storePasskey(user.id, {
      transports: ["internal", "hybrid"],
      deviceType: "multiDevice",
      credentialName: "Phone",
    });
    await storePasskey(user.id, {
      transports: ["internal"],
      deviceType: "singleDevice",
      credentialName: "Laptop",
    });
    const rows = await list();
    expect(Object.fromEntries(rows.map((r) => [r.credentialName, [r.kind, r.label]]))).toEqual({
      YubiKey: ["security-key", "Security key (USB, NFC)"],
      Phone: ["synced", "Synced passkey"],
      Laptop: ["device", "Device-bound passkey"],
    });
    expect(rows.every((r) => r.canDelete)).toBe(true);

    for (const row of rows.slice(1)) {
      expect(
        (await api(app, `/api/v1/passkey/${row.id}`, { method: "DELETE", token })).status,
      ).toBe(204);
    }
    const [last] = await list();
    expect(last!.canDelete).toBe(false);
    const refused = await api(app, `/api/v1/passkey/${last!.id}`, { method: "DELETE", token });
    expect(refused.status).toBe(400);
    expect(refused.body.error?.message).toMatch(/last passkey/);

    const renamed = await api<PasskeyRow>(app, `/api/v1/passkey/${last!.id}`, {
      method: "PATCH",
      json: { credentialName: "Renamed" },
      token,
    });
    expect(renamed.body.data).toMatchObject({ credentialName: "Renamed", canDelete: false });
  });

  it("never deletes the last passkey, even when two deletes race", async () => {
    const { token, user } = await signIn(app);
    const device = { transports: ["internal"], deviceType: "singleDevice" };
    await storePasskey(user.id, { ...device, credentialName: "A" });
    await storePasskey(user.id, { ...device, credentialName: "B" });
    const rows = (await api<PasskeyRow[]>(app, "/api/v1/passkey/list", { token })).body.data!;

    const results = await Promise.all(
      rows.map((row) => api(app, `/api/v1/passkey/${row.id}`, { method: "DELETE", token })),
    );
    expect(results.map((r) => r.status).toSorted()).toEqual([204, 400]);
    expect(await db.select().from(passkeys).where(eq(passkeys.userId, user.id))).toHaveLength(1);
  });

  it("verifies a challenge only for what it was issued for", async () => {
    const { token, user } = await signIn(app);
    const passkey = await createSoftPasskey(user.id);

    const reg = await api<{ challenge: string }>(app, "/api/v1/passkey/register/options", {
      method: "POST",
      token,
    });
    const signInWithReg = await api(app, "/api/v1/passkey/login/verify", {
      method: "POST",
      json: { response: passkey.assert(reg.body.data!.challenge) },
    });
    expect(signInWithReg.status).toBe(400);
    expect(signInWithReg.body.error?.message).toMatch(/Challenge not found or expired/);

    const login = await api<{ challenge: string }>(app, "/api/v1/passkey/login/options", {
      method: "POST",
      json: {},
    });
    const registerWithLogin = await api(app, "/api/v1/passkey/register/verify", {
      method: "POST",
      json: {
        response: {
          id: "cred",
          rawId: "cred",
          type: "public-key",
          response: {
            clientDataJSON: clientData(login.body.data!.challenge),
            attestationObject: "AA",
          },
          clientExtensionResults: {},
        },
      },
      token,
    });
    expect(registerWithLogin.status).toBe(400);
    expect(registerWithLogin.body.error?.message).toMatch(/Challenge not found or expired/);
  });

  it("lists, renames and guards passkeys per user", async () => {
    const { token } = await signIn(app);
    expect((await api(app, "/api/v1/passkey/list", { token })).body.data).toEqual([]);
    expect((await api(app, "/api/v1/passkey/999", { method: "DELETE", token })).status).toBe(404);
    expect(
      (
        await api(app, "/api/v1/passkey/abc", {
          method: "PATCH",
          json: { credentialName: "x" },
          token,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await api(app, "/api/v1/passkey/999", {
          method: "PATCH",
          json: { credentialName: "x" },
          token,
        })
      ).status,
    ).toBe(404);
  });

  it("lets a guest manage only their own passkeys, never the owner's", async () => {
    const fresh = createTestApp({ rateLimitStore: memoryRateLimitStore() });
    const owner = await signIn(fresh, { email: "passkey-owner@example.com" });
    const ownerPasskey = await createSoftPasskey(owner.user.id);
    const guest = await signIn(fresh, { email: "passkey-guest@example.com" });
    await db.insert(guests).values({ userId: guest.user.id });
    const [ownerRow] = await db
      .select({ id: passkeys.id })
      .from(passkeys)
      .where(eq(passkeys.credentialId, ownerPasskey.credentialId));

    const asGuest = <T = unknown>(path: string, init: { method?: string; json?: unknown } = {}) =>
      api<T>(fresh, path, { ...init, token: guest.token });
    expect((await asGuest("/api/v1/people/me")).body.data).toEqual({ guest: true });
    expect((await asGuest("/api/v1/passkey/list")).body.data).toEqual([]);
    expect((await asGuest(`/api/v1/passkey/${ownerRow!.id}`, { method: "DELETE" })).status).toBe(
      404,
    );
    expect(
      (
        await asGuest(`/api/v1/passkey/${ownerRow!.id}`, {
          method: "PATCH",
          json: { credentialName: "mine" },
        })
      ).status,
    ).toBe(404);
    expect(await db.select().from(passkeys).where(eq(passkeys.userId, owner.user.id))).toHaveLength(
      1,
    );

    const options = await asGuest<{ challenge: string }>("/api/v1/passkey/register/options", {
      method: "POST",
    });
    expect(options.status).toBe(200);
    const registered = await asGuest("/api/v1/passkey/register/verify", {
      method: "POST",
      json: {
        response: {
          id: "guest-cred",
          rawId: "guest-cred",
          type: "public-key",
          response: {
            clientDataJSON: clientData(options.body.data!.challenge),
            attestationObject: "AA",
          },
          clientExtensionResults: {},
        },
      },
    });
    expect(registered.status).toBe(400);
    await storePasskey(guest.user.id, {
      transports: ["internal"],
      deviceType: "singleDevice",
      credentialName: "Guest phone",
    });
    expect(
      (await asGuest<PasskeyRow[]>("/api/v1/passkey/list")).body.data?.map(
        (row) => row.credentialName,
      ),
    ).toEqual(["Guest phone"]);
    expect(
      (await api(fresh, "/api/v1/passkey/list", { token: owner.token })).body.data,
    ).toHaveLength(1);
  });

  it("answers the same login options whether or not the email has an account", async () => {
    const fresh = createTestApp({ rateLimitStore: memoryRateLimitStore() });
    const { user } = await signIn(fresh);
    await createSoftPasskey(user.id);
    const options = (email: string) =>
      api<Record<string, unknown>>(fresh, "/api/v1/passkey/login/options", {
        method: "POST",
        json: { email },
      });
    const known = await options(user.email);
    const unknown = await options("nobody-here@example.com");
    for (const response of [known, unknown]) {
      expect(response.status).toBe(200);
      expect(Object.keys(response.body.data!).toSorted()).toEqual([
        "allowCredentials",
        "challenge",
        "rpId",
        "timeout",
        "userVerification",
      ]);
      expect(response.body.error).toBeUndefined();
    }
    expect(known.body.data!.allowCredentials).toHaveLength(1);
    expect(unknown.body.data!.allowCredentials).toEqual([]);
    expect(unknown.body.data!.timeout).toBe(known.body.data!.timeout);
    expect(unknown.body.data!.rpId).toBe(known.body.data!.rpId);
    expect(unknown.body.data!.userVerification).toBe(known.body.data!.userVerification);
  });

  it("registers a passkey and says 409, not 500, when the same credential races through", async () => {
    const { token, user } = await signIn(app);
    const options = await api<{ challenge: string }>(app, "/api/v1/passkey/register/options", {
      method: "POST",
      token,
    });
    expect(options.status).toBe(200);
    const challenge = options.body.data!.challenge;
    const credentialId = randomBytes(16);

    const first = await api<{ id: number; credentialName: string }>(
      app,
      "/api/v1/passkey/register/verify",
      {
        method: "POST",
        json: { response: registrationResponse(challenge, credentialId) },
        token,
      },
    );
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ credentialName: "Security key" });

    const secondOptions = await api<{ challenge: string }>(
      app,
      "/api/v1/passkey/register/options",
      { method: "POST", token },
    );
    const second = await api(app, "/api/v1/passkey/register/verify", {
      method: "POST",
      json: {
        response: registrationResponse(secondOptions.body.data!.challenge, credentialId),
        credentialName: "Second",
      },
      token,
    });
    expect(second.status).toBe(409);
    expect(second.body.error?.message).toMatch(/already registered/);
    expect(
      await db
        .select()
        .from(passkeys)
        .where(eq(passkeys.credentialId, credentialId.toString("base64url"))),
    ).toHaveLength(1);

    const racingCredential = randomBytes(16);
    const racedA = await passkeyService.generateRegistrationOptions({ userId: user.id });
    const racedB = await passkeyService.generateRegistrationOptions({ userId: user.id });
    const [won, lost] = await Promise.allSettled([
      passkeyService.verifyRegistration({
        userId: user.id,
        response: registrationResponse(racedA.challenge, racingCredential),
      }),
      passkeyService.verifyRegistration({
        userId: user.id,
        response: registrationResponse(racedB.challenge, racingCredential),
      }),
    ]);
    expect(won.status).toBe("fulfilled");
    if (lost.status !== "rejected") throw new Error("the racing registration should have lost");
    expect(lost.reason).toMatchObject({ output: { statusCode: 409 } });
  });

  it("says 404, not 500, when a rename loses its race with a delete", async () => {
    const { user } = await signIn(app);
    const device = { transports: ["internal"], deviceType: "singleDevice" };
    await storePasskey(user.id, { ...device, credentialName: "A" });
    await storePasskey(user.id, { ...device, credentialName: "B" });
    const [row] = await db
      .select({ id: passkeys.id })
      .from(passkeys)
      .where(and(eq(passkeys.userId, user.id), eq(passkeys.credentialName, "A")));

    const renaming = passkeyService.updatePasskeyName({
      passkeyId: row!.id,
      userId: user.id,
      credentialName: "Renamed",
    });
    await db.delete(passkeys).where(eq(passkeys.id, row!.id));
    await expect(renaming).resolves.toMatchObject({ id: row!.id, credentialName: "Renamed" });
    expect(await db.select().from(passkeys).where(eq(passkeys.id, row!.id))).toHaveLength(0);
  });
});
