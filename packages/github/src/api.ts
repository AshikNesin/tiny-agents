/**
 * The two calls everything in this package is built on: one GraphQL query
 * and one REST request. A transport is how they reach GitHub (the `gh` CLI
 * on the sandbox, or HTTPS from the app server); the client above never
 * knows which.
 */

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface GitHubApi {
  /** Which transport this is, for Settings and logs. */
  readonly kind: "gh" | "https";
  /** One GraphQL request; resolves to its `data`, rejects on `errors`. */
  graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T>;
  /** One REST request to `path` (`/repos/o/r/pulls`). `text` reads the body as text (job logs). */
  rest<T>(
    method: HttpMethod,
    path: string,
    options?: { body?: unknown; text?: boolean },
  ): Promise<T>;
}

/** GitHub said no, or could not be reached. `status` is the HTTP status when there was one. */
export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

/** A GraphQL response body: `data` and `errors` as GitHub sends them. */
export interface GraphQlBody<T> {
  data?: T;
  errors?: Array<{ message?: string; type?: string }>;
}

/** The `data` of a GraphQL body, or the error its `errors` name. */
export function graphQlData<T>(body: GraphQlBody<T>): T {
  if (body.errors?.length) {
    const message = body.errors.map((e) => e.message ?? e.type ?? "error").join("; ");
    throw new GitHubError(`GitHub GraphQL: ${message}`);
  }
  if (body.data === undefined) throw new GitHubError("GitHub GraphQL: empty response");
  return body.data;
}
