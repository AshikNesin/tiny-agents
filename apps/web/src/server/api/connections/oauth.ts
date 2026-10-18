/**
 * OAuth 2.1 for MCP connections (issue #1 D9–D11). The MCP SDK runs the
 * protocol (discovery, PKCE, Client ID Metadata Document or dynamic
 * registration, token refresh); this provider persists its state encrypted on
 * the connection row and hands consent URLs to the manager.
 */
import { randomBytes } from "node:crypto";
import { prisma } from "@groot/core/database";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthClientProvider,
  OAuthTokens,
} from "@tiny-agents/agent";
import { decryptJson, encryptJson } from "./secrets";

/** What a connection stores about its OAuth sign-in (encrypted in `oauthEnc`). */
export interface OAuthState {
  /** Registered (or manually entered) client. */
  client?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  verifier?: string;
  /** Pending authorization request's state parameter. */
  state?: string;
}

export function appOrigin(): string {
  return (process.env.ORIGIN?.trim() || "http://localhost:3000").replace(/\/+$/, "");
}

export function oauthCallbackUrl(): string {
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
  const row = await prisma.connection.findUnique({
    where: { id: connectionId },
    select: { oauthEnc: true },
  });
  return decryptJson<OAuthState>(row?.oauthEnc, {});
}

export async function writeOAuthState(
  connectionId: string,
  change: (state: OAuthState) => OAuthState,
): Promise<void> {
  const next = change(await readOAuthState(connectionId));
  await prisma.connection.update({
    where: { id: connectionId },
    data: { oauthEnc: encryptJson(next) },
  });
}

/** The connection whose pending authorization used `state`. */
export async function connectionForState(state: string): Promise<string | undefined> {
  const rows = await prisma.connection.findMany({
    where: { authType: "oauth", oauthEnc: { not: null } },
    select: { id: true, oauthEnc: true },
  });
  for (const row of rows) {
    try {
      if (decryptJson<OAuthState>(row.oauthEnc, {}).state === state) return row.id;
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
