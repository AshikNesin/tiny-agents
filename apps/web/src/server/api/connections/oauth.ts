/**
 * OAuth 2.1 for MCP connections (issue #1 D9–D11). The MCP SDK runs the
 * protocol (discovery, PKCE, Client ID Metadata Document or dynamic
 * registration, token refresh); this provider persists its state encrypted on
 * the connection row and hands consent URLs to the manager.
 */
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
import { openOAuthState, sealOAuthState } from "./connection-secrets";

/** What a connection stores about its OAuth sign-in (encrypted in `oauthEnc`). */
export interface OAuthState {
  /** Registered (or manually entered) client. */
  client?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  verifier?: string;
  /** Pending authorization request's state parameter. */
  state?: string;
}

function appOrigin(): string {
  return env.ORIGIN.replace(/\/+$/, "");
}

function oauthCallbackUrl(): string {
  return `${appOrigin()}/api/v1/connections/oauth/callback`;
}

/** Public Client ID Metadata Document URL — only usable on an https origin. */
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
  return openOAuthState<OAuthState>(connectionId, row?.oauthEnc) ?? {};
}

async function writeOAuthState(
  connectionId: string,
  change: (state: OAuthState) => OAuthState,
): Promise<void> {
  const next = change(await readOAuthState(connectionId));
  const updated = await db
    .update(connections)
    .set({ oauthEnc: sealOAuthState(connectionId, next) })
    .where(eq(connections.id, connectionId))
    .returning({ id: connections.id });
  // The connection was removed (Prisma's update threw P2025 → 404).
  if (updated.length === 0) throw Boom.notFound("Record not found");
}

/** The connection whose pending authorization used `state`. */
export async function connectionForState(state: string): Promise<string | undefined> {
  const rows = await db
    .select({ id: connections.id, oauthEnc: connections.oauthEnc })
    .from(connections)
    .where(and(eq(connections.authType, "oauth"), isNotNull(connections.oauthEnc)));
  for (const row of rows) {
    try {
      if (openOAuthState<OAuthState>(row.id, row.oauthEnc)?.state === state) return row.id;
    } catch {
      // unreadable rows can't match
    }
  }
  return undefined;
}

export function createOAuthProvider(
  connectionId: string,
  onAuthorizationUrl: (url: URL) => void,
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
      await writeOAuthState(connectionId, (s) => ({ ...s, state }));
      return state;
    },
    async clientInformation() {
      return (await readOAuthState(connectionId)).client;
    },
    async saveClientInformation(client) {
      await writeOAuthState(connectionId, (s) => ({ ...s, client }));
    },
    async tokens() {
      return (await readOAuthState(connectionId)).tokens;
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
      const verifier = (await readOAuthState(connectionId)).verifier;
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
