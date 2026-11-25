import { SignJWT } from "jose";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { env } from "@groot/core/env";
import { utf8Encode } from "@groot/core/utils/encoding.utils";
import type { SessionUser, SignInResponse } from "@groot/core/auth/auth.schema";
import * as authService from "@groot/core/auth/auth.service";
import * as passkeyService from "@groot/core/passkey/passkey.service";
import { api, createTestApp, type JsonResponse } from "../helpers";
import { createSoftPasskey } from "../fixtures/passkey";
import { useFreshTestDatabase } from "../fixtures/test-db";

const app = createTestApp();
const owner = { email: "owner@example.com", password: "long-enough-pw", name: "Owner" };

function cookieAttributes(response: JsonResponse): string {
  const cookie = response.headers.get("set-cookie");
  expect(cookie).toMatch(/^token=[^;]+;/);
  return cookie!.replace(/^token=[^;]+;/, "token=<jwt>;");
}

async function expectSignedIn(
  response: JsonResponse<SignInResponse>,
  user: SessionUser,
): Promise<string> {
  expect(response.body.data).toStrictEqual({ token: expect.any(String), user });
  const me = await api<{ id: number }>(app, "/api/v1/auth/me", {
    token: response.body.data!.token,
  });
  expect(me.body.data?.id).toBe(user.id);
  return cookieAttributes(response);
}

beforeEach(useFreshTestDatabase);
describe("sign-in paths", () => {
  it("first-run setup, password login and passkey login start the same session", async () => {
    const setup = await api<SignInResponse>(app, "/api/v1/auth/setup", {
      method: "POST",
      json: owner,
    });
    expect(setup.status).toBe(201);
    const user: SessionUser = {
      id: setup.body.data!.user.id,
      email: owner.email,
      name: "Owner",
      isAdmin: true,
    };
    const setupCookie = await expectSignedIn(setup, user);

    const login = await api<SignInResponse>(app, "/api/v1/auth/login", {
      method: "POST",
      json: { email: owner.email, password: owner.password },
    });
    expect(login.status).toBe(200);
    expect(await expectSignedIn(login, user)).toBe(setupCookie);

    const passkey = await createSoftPasskey(user.id);
    const options = await api<{ challenge: string }>(app, "/api/v1/passkey/login/options", {
      method: "POST",
      json: {},
    });
    const verified = await api<SignInResponse>(app, "/api/v1/passkey/login/verify", {
      method: "POST",
      json: { response: passkey.assert(options.body.data!.challenge) },
    });
    expect(verified.status).toBe(200);
    expect(await expectSignedIn(verified, user)).toBe(setupCookie);
  });

  it("the deprecated service-level sign-ins return the same body", async () => {
    const created = await authService.createUser({ ...owner, email: "legacy@example.com" });
    const user: SessionUser = {
      id: created.id,
      email: "legacy@example.com",
      name: "Owner",
      isAdmin: false,
    };
    const viaPassword = await authService.login({ email: user.email, password: owner.password });
    expect(viaPassword).toStrictEqual({ token: expect.any(String), user });

    const passkey = await createSoftPasskey(user.id);
    const { challenge } = await passkeyService.generateAuthenticationOptions();
    const viaPasskey = await passkeyService.verifyAuthentication({
      response: passkey.assert(challenge),
    });
    expect(viaPasskey).toStrictEqual({ token: expect.any(String), user });
  });
});

describe("logout", () => {
  const credentials = { email: "revocable@example.com", password: "a-long-enough-password" };

  async function signInTwice() {
    if (!(await authService.findUserByEmail(credentials.email))) {
      await authService.createUser(credentials);
    }
    const tokens: string[] = [];
    for (let i = 0; i < 2; i++) {
      tokens.push(
        (
          await api<SignInResponse>(app, "/api/v1/auth/login", {
            method: "POST",
            json: credentials,
          })
        ).body.data!.token,
      );

      vi.setSystemTime(Date.now() + 1000);
    }
    expect(tokens[0]).not.toBe(tokens[1]);
    return tokens as [string, string];
  }

  it("ends every token the account holds, not only the one that asked", async () => {
    const [first, second] = await signInTwice();
    const status = (token: string) =>
      api(app, "/api/v1/auth/me", { token }).then((res) => res.status);
    expect(await status(first)).toBe(200);
    expect(await status(second)).toBe(200);

    expect((await api(app, "/api/v1/auth/logout", { method: "POST", token: first })).status).toBe(
      200,
    );

    expect(await status(first)).toBe(401);
    expect(await status(second)).toBe(401);
  });

  it("leaves other accounts signed in, and lets the account sign in again", async () => {
    const [mine] = await signInTwice();
    const created = await authService.createUser({
      email: "bystander@example.com",
      password: credentials.password,
    });
    const bystander = (
      await api<SignInResponse>(app, "/api/v1/auth/login", {
        method: "POST",
        json: { email: created.email, password: credentials.password },
      })
    ).body.data!.token;

    await api(app, "/api/v1/auth/logout", { method: "POST", token: mine });

    expect((await api(app, "/api/v1/auth/me", { token: bystander })).status).toBe(200);
    const again = await api<SignInResponse>(app, "/api/v1/auth/login", {
      method: "POST",
      json: credentials,
    });
    expect((await api(app, "/api/v1/auth/me", { token: again.body.data!.token })).status).toBe(200);
  });

  it("ends a cookie session too, which carries the same token as a bearer one", async () => {
    const [token] = await signInTwice();
    const res = await api(app, "/api/v1/auth/logout", {
      method: "POST",
      headers: { cookie: `token=${token}` },
    });
    expect(res.status).toBe(200);
    expect((await api(app, "/api/v1/auth/me", { token })).status).toBe(401);
  });

  it("keeps a token minted before logout revoked sessions, which carries no version", async () => {
    const created = await authService.createUser({
      email: "legacy-token@example.com",
      password: credentials.password,
    });
    const legacy = await new SignJWT({ userId: created.id, email: created.email })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("30d")
      .sign(utf8Encode(env.JWT_SECRET_KEY));

    expect((await api(app, "/api/v1/auth/me", { token: legacy })).status).toBe(200);

    await api(app, "/api/v1/auth/logout", { method: "POST", token: legacy });
    expect((await api(app, "/api/v1/auth/me", { token: legacy })).status).toBe(401);
  });

  it("lets a sign-in that bypasses the routes mint a working token after a logout", async () => {
    const [token] = await signInTwice();
    await api(app, "/api/v1/auth/logout", { method: "POST", token });
    expect((await api(app, "/api/v1/auth/me", { token })).status).toBe(401);

    const viaPassword = await authService.login(credentials);
    const viaPasskey = await passkeyService.verifyAuthentication({
      response: (
        await createSoftPasskey((await authService.findUserByEmail(credentials.email))!.id)
      ).assert((await passkeyService.generateAuthenticationOptions()).challenge),
    });
    for (const minted of [viaPassword, viaPasskey]) {
      expect(minted.user.email).toBe(credentials.email);
      expect(
        (await api(app, "/api/v1/auth/me", { token: minted.token })).status,
        "a token minted after logout",
      ).toBe(200);
    }
  });
});
