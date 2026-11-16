/**
 * The GitHub App transport's credentials (issue #297 phase 6, ADR 0022):
 * an app JWT signed with the App's private key, traded for short-lived
 * installation tokens (cached until a minute before they expire), and the
 * webhook signature check. Web APIs only; the RS256 signature itself is
 * the caller's (`sign`), so the key never enters this package.
 */
import { GitHubError } from "./api";
import type { RepoRef } from "./client";

export interface AppAuthOptions {
  appId: string;
  /** RS256 over `data` with the App's private key, base64url. */
  sign(data: string): Promise<string>;
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Milliseconds since the epoch (tests). */
  now?: () => number;
}

export interface AppAuth {
  /** An installation token for `installationId`, minted or cached. */
  installationToken(installationId: number): Promise<string>;
  /** The installation that reaches `repo`, or a `GitHubError` 404 when the App is not installed there. */
  installationFor(repo: RepoRef): Promise<number>;
}

const base64url = (text: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

export function createAppAuth(options: AppAuthOptions): AppAuth {
  const base = (options.baseUrl ?? "https://api.github.com").replace(/\/$/, "");
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const tokens = new Map<number, { token: string; expiresAt: number }>();

  async function jwt(): Promise<string> {
    const seconds = Math.floor(now() / 1000);
    const head = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    // Backdated a minute for clock drift; GitHub allows at most ten minutes.
    const body = base64url(
      JSON.stringify({ iat: seconds - 60, exp: seconds + 9 * 60, iss: options.appId }),
    );
    return `${head}.${body}.${await options.sign(`${head}.${body}`)}`;
  }

  async function call<T>(method: string, path: string): Promise<T> {
    const response = await doFetch(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${await jwt()}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
    });
    if (!response.ok) {
      const message = ((await response.json().catch(() => ({}))) as { message?: string }).message;
      throw new GitHubError(message ?? `GitHub answered ${response.status}`, response.status);
    }
    return (await response.json()) as T;
  }

  return {
    async installationToken(installationId) {
      const cached = tokens.get(installationId);
      if (cached && cached.expiresAt - 60_000 > now()) return cached.token;
      const minted = await call<{ token: string; expires_at: string }>(
        "POST",
        `/app/installations/${installationId}/access_tokens`,
      );
      tokens.set(installationId, { token: minted.token, expiresAt: Date.parse(minted.expires_at) });
      return minted.token;
    },
    async installationFor(repo) {
      const found = await call<{ id: number }>(
        "GET",
        `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/installation`,
      );
      return found.id;
    },
  };
}

/** Whether `signature` (`X-Hub-Signature-256`) is the HMAC-SHA256 of `body` under `secret`. */
export async function verifyWebhook(
  secret: string,
  body: string,
  signature: string | null | undefined,
): Promise<boolean> {
  if (!signature?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  const expected = `sha256=${[...mac].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
  if (expected.length !== signature.length) return false;
  // Constant time: every character is compared.
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1)
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}
