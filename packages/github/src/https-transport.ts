/**
 * The HTTPS transport: API calls straight from the app server with a token
 * the vault releases (ADR 0022, open question 2 of issue #297). With it, no
 * GitHub credential is on the sandbox for API calls; only `git push` still
 * runs there, with the token handed to that one command.
 */
import { GitHubError, graphQlData, type GitHubApi, type GraphQlBody } from "./api";

export interface HttpsTransportOptions {
  /** The token, read for each request (the vault caches it). */
  token(): Promise<string>;
  /** Default `https://api.github.com`. */
  baseUrl?: string;
  fetch?: typeof fetch;
}

export function createHttpsTransport(options: HttpsTransportOptions): GitHubApi {
  const base = (options.baseUrl ?? "https://api.github.com").replace(/\/$/, "");
  const doFetch = options.fetch ?? fetch;

  async function request(method: string, path: string, body?: unknown): Promise<Response> {
    const response = await doFetch(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${await options.token()}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "follow",
    });
    if (!response.ok) {
      let message = `GitHub answered ${response.status}`;
      try {
        const json = (await response.json()) as { message?: string };
        if (json.message) message = json.message;
      } catch {
        // No JSON body.
      }
      throw new GitHubError(message, response.status);
    }
    return response;
  }

  return {
    kind: "https",
    async graphql<T>(query: string, variables: Record<string, unknown> = {}) {
      const response = await request("POST", "/graphql", { query, variables });
      return graphQlData((await response.json()) as GraphQlBody<T>);
    },
    async rest<T>(method: string, path: string, opts: { body?: unknown; text?: boolean } = {}) {
      if (!path.startsWith("/")) throw new GitHubError(`Invalid path ${path}`);
      const response = await request(method, path, opts.body);
      if (opts.text) return (await response.text()) as T;
      const raw = await response.text();
      return (raw.trim() ? JSON.parse(raw) : undefined) as T;
    },
  };
}
