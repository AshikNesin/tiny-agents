export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface GitHubApi {
  readonly kind: "gh" | "https";
  graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T>;
  rest<T>(
    method: HttpMethod,
    path: string,
    options?: { body?: unknown; text?: boolean },
  ): Promise<T>;
}

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

export interface GraphQlBody<T> {
  data?: T;
  errors?: Array<{ message?: string; type?: string }>;
}

export function graphQlData<T>(body: GraphQlBody<T>): T {
  if (body.errors?.length) {
    const message = body.errors.map((e) => e.message ?? e.type ?? "error").join("; ");
    throw new GitHubError(`GitHub GraphQL: ${message}`);
  }
  if (body.data === undefined) throw new GitHubError("GitHub GraphQL: empty response");
  return body.data;
}
