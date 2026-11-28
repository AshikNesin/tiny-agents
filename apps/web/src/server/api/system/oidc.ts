import { createNamespaceKv } from "@groot/core/kv";
import { env } from "@groot/core/env";
import {
  calculateJwkThumbprint,
  exportJWK,
  generateKeyPair,
  importJWK,
  SignJWT,
  type JWK,
} from "jose";
import { app } from "../../app-root";
import { appEnv, type AppEnv } from "../../env";
import { routes } from "../routes";

const ALG = "ES256";
const KEY_NAME = "signing-key";
const TOKEN_SECONDS = 300;
export const OIDC_AUDIENCE = "sts.amazonaws.com";
export const OIDC_SANDBOX_SUBJECT = "sandbox";

interface SigningKey {
  kid: string;
  privateJwk: JWK;
  publicJwk: JWK;
}

export function oidcIssuer(source: AppEnv = appEnv()): string | undefined {
  if (source.SANDBOX_PROVIDER !== "microvm" || (source.SANDBOX_AWS_AUTH ?? "oidc") !== "oidc") {
    return undefined;
  }
  return (source.SANDBOX_OIDC_ISSUER ?? env.ORIGIN).replace(/\/+$/, "");
}

async function newSigningKey(): Promise<SigningKey> {
  const { privateKey, publicKey } = await generateKeyPair(ALG, { extractable: true });
  const publicJwk = await exportJWK(publicKey);
  const kid = await calculateJwkThumbprint(publicJwk);
  return { kid, privateJwk: await exportJWK(privateKey), publicJwk: { ...publicJwk, kid } };
}

async function loadSigningKey(): Promise<SigningKey> {
  const store = createNamespaceKv("OIDC");
  const saved = await store.get<SigningKey>(KEY_NAME);
  if (saved) return saved;
  await store.add(KEY_NAME, await newSigningKey());
  const kept = await store.get<SigningKey>(KEY_NAME);
  if (!kept) throw new Error("The OIDC signing key was not saved.");
  return kept;
}

function signingKey(): Promise<SigningKey> {
  const root = app();
  const retryNextTime = (error: unknown): never => {
    root.oidcSigningKey = undefined;
    throw error;
  };
  root.oidcSigningKey ??= loadSigningKey().catch(retryNextTime);
  return root.oidcSigningKey;
}

export async function signOidcToken(issuer: string, subject: string): Promise<string> {
  const key = await signingKey();
  return new SignJWT({})
    .setProtectedHeader({ alg: ALG, kid: key.kid, typ: "JWT" })
    .setIssuer(issuer)
    .setSubject(subject)
    .setAudience(OIDC_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_SECONDS}s`)
    .sign(await importJWK(key.privateJwk, ALG));
}

const oidcRouter = routes();

oidcRouter.get("/.well-known/openid-configuration", (c) => {
  const issuer = oidcIssuer();
  if (!issuer) return c.json({ error: "This server issues no OIDC tokens" }, 404);
  return c.json(
    {
      issuer,
      jwks_uri: `${issuer}/.well-known/jwks.json`,
      response_types_supported: ["id_token"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: [ALG],
      claims_supported: ["iss", "sub", "aud", "iat", "exp"],
    },
    200,
    { "Cache-Control": "public, max-age=3600" },
  );
});

oidcRouter.get("/.well-known/jwks.json", async (c) => {
  if (!oidcIssuer()) return c.json({ error: "This server issues no OIDC tokens" }, 404);
  const { publicJwk } = await signingKey();
  return c.json({ keys: [{ ...publicJwk, alg: ALG, use: "sig" }] }, 200, {
    "Cache-Control": "public, max-age=3600",
  });
});

export default oidcRouter.hono;
