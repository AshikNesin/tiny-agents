import { parseJson } from "@tiny-agents/std";
import { z } from "zod";
import { failureOf, GitHubError } from "./api";
import type { RepoRef } from "./client";

export interface AppAuthOptions {
  appId: string;
  sign(data: string): Promise<string>;
  baseUrl?: string;
  fetch?: typeof fetch;
  now?: () => number;
}

export interface AppAuth {
  installationToken(installationId: number): Promise<string>;
  installationFor(repo: RepoRef): Promise<number>;
  repositories(): Promise<Array<{ fullName: string; installationId: number; private: boolean }>>;
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
    const body = base64url(
      JSON.stringify({ iat: seconds - 60, exp: seconds + 9 * 60, iss: options.appId }),
    );
    return `${head}.${body}.${await options.sign(`${head}.${body}`)}`;
  }

  async function call<T>(method: string, path: string, token?: string): Promise<T> {
    const response = await doFetch(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token ?? (await jwt())}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
    });
    if (!response.ok) throw await failureOf(response);
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
    async repositories() {
      const out: Array<{ fullName: string; installationId: number; private: boolean }> = [];
      for (let page = 1; ; page += 1) {
        const installations = await call<Array<{ id: number; suspended_at: string | null }>>(
          "GET",
          `/app/installations?per_page=100&page=${page}`,
        );
        for (const installation of installations) {
          if (installation.suspended_at) continue;
          const token = await this.installationToken(installation.id);
          for (let repoPage = 1; ; repoPage += 1) {
            const { repositories } = await call<{
              repositories: Array<{ full_name: string; private: boolean }>;
            }>("GET", `/installation/repositories?per_page=100&page=${repoPage}`, token);
            for (const repo of repositories) {
              out.push({
                fullName: repo.full_name,
                installationId: installation.id,
                private: repo.private,
              });
            }
            if (repositories.length < 100) break;
          }
        }
        if (installations.length < 100) break;
      }
      return out.sort((a, b) => a.fullName.localeCompare(b.fullName));
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
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1)
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

export interface ManifestApp {
  id: number;
  slug: string;
  name: string;
  pem: string;
  webhookSecret: string | null;
}

const manifestSchema = z.looseObject({
  id: z.number().optional(),
  slug: z.string().optional(),
  name: z.string().optional(),
  pem: z.string().optional(),
  webhook_secret: z.string().nullish(),
});

function manifestBody(text: string, status: number): z.infer<typeof manifestSchema> {
  try {
    return parseJson("GitHub's manifest conversion", text, manifestSchema);
  } catch (error) {
    throw new GitHubError(
      `GitHub answered ${status} with an app manifest that cannot be read: ${error instanceof Error ? error.message : String(error)}`,
      status,
    );
  }
}

export async function convertManifest(
  code: string,
  options: { baseUrl?: string; fetch?: typeof fetch } = {},
): Promise<ManifestApp> {
  const base = (options.baseUrl ?? "https://api.github.com").replace(/\/$/, "");
  const response = await (options.fetch ?? fetch)(
    `${base}/app-manifests/${encodeURIComponent(code)}/conversions`,
    {
      method: "POST",
      headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
    },
  );
  if (!response.ok) throw await failureOf(response);
  const body = manifestBody(await response.text(), response.status);
  if (!body.id || !body.slug || !body.pem) {
    throw new GitHubError(
      `GitHub answered ${response.status} without an app id, slug and key`,
      response.status,
    );
  }
  return {
    id: body.id,
    slug: body.slug,
    name: body.name ?? body.slug,
    pem: body.pem,
    webhookSecret: body.webhook_secret ?? null,
  };
}
