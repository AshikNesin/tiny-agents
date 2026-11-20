import { GitHubError, graphQlData, type GitHubApi, type GraphQlBody } from "./api";

export interface HttpsTransportOptions {
  token(): Promise<string>;
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
      } catch {}
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
