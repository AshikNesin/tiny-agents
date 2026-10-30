import { describe, expect, it } from "vite-plus/test";
import { api, createTestApp, signIn } from "../helpers";
import { createNamespaceKv } from "@groot/core/kv";

const app = createTestApp();

/** clientDataJSON as a browser would send it: base64url JSON carrying the challenge. */
function clientData(challenge: string): string {
  return Buffer.from(
    JSON.stringify({ type: "webauthn.get", challenge, origin: "http://localhost:3000" }),
  ).toString("base64url");
}

describe("passkey API", () => {
  it("issues registration and login options and stores single-use challenges", async () => {
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
    expect(await createNamespaceKv("passkey:challenge").has(reg.body.data!.challenge)).toBe(true);

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
    expect(first.status).toBe(400); // challenge consumed, attestation invalid
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
});
