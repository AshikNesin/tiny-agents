import { createLocalJWKSet, decodeJwt, jwtVerify, type JSONWebKeySet } from "jose";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  microvmSettings,
  sandboxAwsCredentials,
  sandboxConfigured,
  sandboxConnection,
  sandboxHost,
} from "../../../../apps/web/src/server/api/sandbox/sandbox-host";
import {
  OIDC_AUDIENCE,
  OIDC_SANDBOX_SUBJECT,
  signOidcToken,
} from "../../../../apps/web/src/server/api/system/oidc";
import { app } from "../../../../apps/web/src/server/app-root";
import { appEnv } from "../../../../apps/web/src/server/env";
import { createTestApp } from "../../helpers";

const server = createTestApp();
const ISSUER = "https://issuer.example";
const MICROVM = {
  SANDBOX_PROVIDER: "microvm",
  SANDBOX_MICROVM_REGION: "us-east-1",
  SANDBOX_MICROVM_IMAGE: "arn:aws:lambda:us-east-1:111122223333:microvm-image:tiny-agents",
  SANDBOX_MICROVM_ROLE_ARN: "arn:aws:iam::111122223333:role/tiny-agents-sandbox",
  SANDBOX_OIDC_ISSUER: ISSUER,
};

function useMicrovmEnv(extra: Record<string, string> = {}) {
  for (const [name, value] of Object.entries({ ...MICROVM, ...extra })) vi.stubEnv(name, value);
}

async function publishedKeys(): Promise<JSONWebKeySet> {
  const res = await server.request("/.well-known/jwks.json");
  expect(res.status).toBe(200);
  return (await res.json()) as JSONWebKeySet;
}

afterEach(() => {
  vi.unstubAllEnvs();
  app().oidcSigningKey = undefined;
});

describe("the OIDC issuer AWS signs the app in with", () => {
  it("publishes its discovery document and keys without a session", async () => {
    useMicrovmEnv();
    const res = await server.request("/.well-known/openid-configuration");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      issuer: ISSUER,
      jwks_uri: "https://issuer.example/.well-known/jwks.json",
      id_token_signing_alg_values_supported: ["ES256"],
    });
    const { keys } = await publishedKeys();
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ kty: "EC", crv: "P-256", alg: "ES256", use: "sig" });
    expect(keys[0]).not.toHaveProperty("d");
  });

  it("is not there unless the sandbox signs in to AWS with OIDC", async () => {
    expect((await server.request("/.well-known/openid-configuration")).status).toBe(404);
    useMicrovmEnv({ SANDBOX_AWS_AUTH: "default" });
    expect((await server.request("/.well-known/jwks.json")).status).toBe(404);
  });

  it("signs 5-minute tokens for the sandbox that verify against the published key", async () => {
    useMicrovmEnv();
    const token = await signOidcToken(ISSUER, OIDC_SANDBOX_SUBJECT);
    const { payload } = await jwtVerify(token, createLocalJWKSet(await publishedKeys()), {
      issuer: ISSUER,
      audience: OIDC_AUDIENCE,
    });
    expect(payload.sub).toBe("sandbox");
    expect(payload.aud).toBe("sts.amazonaws.com");
    expect(payload.exp! - payload.iat!).toBe(300);
  });

  it("keeps its key across a restart, so AWS's trust stays valid", async () => {
    useMicrovmEnv();
    const before = await publishedKeys();
    app().oidcSigningKey = undefined;
    expect(await publishedKeys()).toEqual(before);
  });
});

describe("AWS credentials for the MicroVM sandbox", () => {
  it("exchanges a fresh app-signed token for the configured role", async () => {
    useMicrovmEnv();
    const exchanged: { RoleArn: string; WebIdentityToken: string }[] = [];
    const credentials = sandboxAwsCredentials(microvmSettings(appEnv()), async (params) => {
      exchanged.push(params);
      return { accessKeyId: "AKIA-TEMP", secretAccessKey: "secret", sessionToken: "session" };
    });
    if (typeof credentials !== "function") throw new Error("expected a credentials provider");

    expect(await credentials()).toMatchObject({ accessKeyId: "AKIA-TEMP" });
    expect(exchanged).toHaveLength(1);
    expect(exchanged[0]!.RoleArn).toBe(MICROVM.SANDBOX_MICROVM_ROLE_ARN);
    const claims = decodeJwt(exchanged[0]!.WebIdentityToken);
    expect(claims).toMatchObject({ iss: ISSUER, sub: "sandbox", aud: "sts.amazonaws.com" });
  });

  it("leaves credentials to the AWS SDK's own chain with SANDBOX_AWS_AUTH=default", () => {
    useMicrovmEnv({ SANDBOX_AWS_AUTH: "default" });
    expect(sandboxAwsCredentials(microvmSettings(appEnv()))).toBeUndefined();
  });
});

describe("SANDBOX_PROVIDER=microvm", () => {
  it("counts as a configured sandbox with no SANDBOX_HOST, even in production", () => {
    const env = appEnv({ ...MICROVM, NODE_ENV: "production" });
    expect(sandboxConfigured(env)).toBe(true);
    expect(sandboxHost(env)).toBeUndefined();
    expect(sandboxConfigured(appEnv({ NODE_ENV: "development" }))).toBe(false);
  });

  it("names the setting it is missing on first use, instead of failing to start", async () => {
    const env = appEnv({ SANDBOX_PROVIDER: "microvm", SANDBOX_MICROVM_REGION: "us-east-1" });
    const connection = sandboxConnection(env);
    expect(connection).toBeDefined();
    await expect(connection!.exec("true")).rejects.toThrow(
      "SANDBOX_PROVIDER=microvm needs SANDBOX_MICROVM_IMAGE. See docs/reference/config.md.",
    );
    connection!.close();
  });

  it("needs a role to sign in with OIDC", () => {
    const { SANDBOX_MICROVM_ROLE_ARN: _role, ...withoutRole } = MICROVM;
    expect(() => microvmSettings(appEnv(withoutRole))).toThrow(
      "SANDBOX_PROVIDER=microvm needs SANDBOX_MICROVM_ROLE_ARN (or SANDBOX_AWS_AUTH=default).",
    );
  });
});
