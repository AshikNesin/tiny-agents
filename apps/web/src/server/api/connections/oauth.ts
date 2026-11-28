import { z } from "zod";
import { randomBytes } from "node:crypto";
import { and, eq, isNotNull } from "drizzle-orm";
import { env } from "@groot/core/env";
import { Boom } from "@groot/core/errors";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthClientProvider,
  OAuthTokens,
} from "@tiny-agents/agent";
import { connections, db } from "../../db";
import { SecretLockedError } from "../../crypto/secret-box";
import { openOAuthState, sealOAuthState } from "./connection-secrets";

export interface OAuthState {
  client?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  verifier?: string;
  state?: string;
  issuedAt?: number;
  userId?: number;
}

const oauthStateSchema: z.ZodType<OAuthState> = z.looseObject({
  client: z
    .looseObject({
      client_id: z.string(),
      client_secret: z.string().optional(),
      client_id_issued_at: z.number().optional(),
      client_secret_expires_at: z.number().optional(),
    })
    .optional(),
  tokens: z
    .looseObject({
      access_token: z.string(),
      id_token: z.string().optional(),
      token_type: z.string(),
      expires_in: z.number().optional(),
      scope: z.string().optional(),
      refresh_token: z.string().optional(),
    })
    .optional(),
  verifier: z.string().optional(),
  state: z.string().optional(),
  issuedAt: z.number().optional(),
  userId: z.number().optional(),
});

function appOrigin(): string {
  return env.ORIGIN.replace(/\/+$/, "");
}

function oauthCallbackUrl(): string {
  return `${appOrigin()}/api/v1/connections/oauth/callback`;
}

export function clientMetadataUrl(): string | undefined {
  const origin = appOrigin();
  return origin.startsWith("https://")
    ? `${origin}/api/v1/connections/oauth/client-metadata.json`
    : undefined;
}

export function clientMetadata(): OAuthClientMetadata {
  return {
    client_name: "tiny-agents",
    redirect_uris: [oauthCallbackUrl()],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
}

export async function readOAuthState(connectionId: string): Promise<OAuthState> {
  const row = await db.query.connections.findFirst({
    where: eq(connections.id, connectionId),
    columns: { oauthEnc: true },
  });
  return openOAuthState(connectionId, row?.oauthEnc, oauthStateSchema) ?? {};
}

function openForSignIn(connectionId: string, stored: string | null | undefined): OAuthState {
  try {
    return openOAuthState(connectionId, stored, oauthStateSchema) ?? {};
  } catch (error) {
    if (error instanceof SecretLockedError && error.reason !== "no_key") return {};
    throw error;
  }
}

async function readForSignIn(connectionId: string): Promise<OAuthState> {
  const row = await db.query.connections.findFirst({
    where: eq(connections.id, connectionId),
    columns: { oauthEnc: true },
  });
  return openForSignIn(connectionId, row?.oauthEnc);
}

async function writeOAuthState(
  connectionId: string,
  change: (state: OAuthState) => OAuthState,
): Promise<void> {
  const written = db.transaction((tx) => {
    const row = tx
      .select({ oauthEnc: connections.oauthEnc })
      .from(connections)
      .where(eq(connections.id, connectionId))
      .get();
    if (!row) return false;
    const next = change(openForSignIn(connectionId, row.oauthEnc));
    tx.update(connections)
      .set({ oauthEnc: sealOAuthState(connectionId, next) })
      .where(eq(connections.id, connectionId))
      .run();
    return true;
  });
  if (!written) throw Boom.notFound("Record not found");
}

export async function connectionForState(state: string): Promise<string | undefined> {
  const rows = await db
    .select({ id: connections.id, oauthEnc: connections.oauthEnc })
    .from(connections)
    .where(and(eq(connections.authType, "oauth"), isNotNull(connections.oauthEnc)));
  for (const row of rows) {
    try {
      if (openOAuthState(row.id, row.oauthEnc, oauthStateSchema)?.state === state) return row.id;
    } catch {}
  }
  return undefined;
}

const OAUTH_STATE_TTL_MS = 10 * 60_000;

export function stateStillCurrent(issuedAt: number | undefined, now = Date.now()): boolean {
  return issuedAt !== undefined && now - issuedAt <= OAUTH_STATE_TTL_MS;
}

export async function clearOAuthState(connectionId: string): Promise<void> {
  await writeOAuthState(connectionId, (s) => ({ ...s, state: undefined, issuedAt: undefined }));
}

export function createOAuthProvider(
  connectionId: string,
  onAuthorizationUrl: (url: URL) => void,
  initiator?: number,
): OAuthClientProvider {
  const metadataUrl = clientMetadataUrl();
  return {
    get redirectUrl() {
      return oauthCallbackUrl();
    },
    ...(metadataUrl ? { clientMetadataUrl: metadataUrl } : {}),
    get clientMetadata() {
      return clientMetadata();
    },
    async state() {
      const state = randomBytes(16).toString("base64url");
      await writeOAuthState(connectionId, (s) => ({
        ...s,
        state,
        issuedAt: Date.now(),
        ...(initiator === undefined ? {} : { userId: initiator }),
      }));
      return state;
    },
    async clientInformation() {
      return (await readForSignIn(connectionId)).client;
    },
    async saveClientInformation(client) {
      await writeOAuthState(connectionId, (s) => ({ ...s, client }));
    },
    async tokens() {
      return (await readForSignIn(connectionId)).tokens;
    },
    async saveTokens(tokens) {
      await writeOAuthState(connectionId, (s) => ({ ...s, tokens }));
    },
    redirectToAuthorization(url) {
      onAuthorizationUrl(url);
    },
    async saveCodeVerifier(verifier) {
      await writeOAuthState(connectionId, (s) => ({ ...s, verifier }));
    },
    async codeVerifier() {
      const verifier = (await readForSignIn(connectionId)).verifier;
      if (!verifier) throw new Error("No pending OAuth sign-in for this connection");
      return verifier;
    },
    async invalidateCredentials(scope) {
      await writeOAuthState(connectionId, (s) => {
        if (scope === "all") return { client: s.client };
        if (scope === "client") return { ...s, client: undefined };
        if (scope === "tokens") return { ...s, tokens: undefined };
        if (scope === "verifier") return { ...s, verifier: undefined };
        return s;
      });
    },
  };
}
