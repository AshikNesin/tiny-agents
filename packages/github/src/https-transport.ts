import type { z } from "zod";
import { GitHubError, graphQlData, restData, type GitHubApi } from "./api";

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
    async graphql<T>(schema: z.ZodType<T>, query: string, variables: Record<string, unknown> = {}) {
      const response = await request("POST", "/graphql", { query, variables });
      return graphQlData(await response.text(), schema);
    },
    async rest<T>(
      schema: z.ZodType<T>,
      method: string,
      path: string,
      opts: { body?: unknown } = {},
    ) {
      if (!path.startsWith("/")) throw new GitHubError(`Invalid path ${path}`);
      const response = await request(method, path, opts.body);
      return restData(`GitHub's answer to ${method} ${path}`, await response.text(), schema);
    },
    async text(method: string, path: string) {
      if (!path.startsWith("/")) throw new GitHubError(`Invalid path ${path}`);
      return (await request(method, path)).text();
    },
  };
}
