import { parseJson } from "@tiny-agents/std";
import { z } from "zod";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface GitHubApi {
  readonly kind: "gh" | "https";
  graphql<T>(schema: z.ZodType<T>, query: string, variables?: Record<string, unknown>): Promise<T>;
  rest<T>(
    schema: z.ZodType<T>,
    method: HttpMethod,
    path: string,
    options?: { body?: unknown },
  ): Promise<T>;
  text(method: HttpMethod, path: string): Promise<string>;
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

const graphQlBodySchema = z.looseObject({
  data: z.unknown().optional(),
  errors: z
    .array(z.looseObject({ message: z.string().nullish(), type: z.string().nullish() }))
    .nullish(),
});

function fitting<T>(what: string, value: unknown, schema: z.ZodType<T>): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`${what} does not fit its shape: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

export function graphQlData<T>(text: string, schema: z.ZodType<T>): T {
  const body = parseJson("GitHub's GraphQL answer", text, graphQlBodySchema);
  if (body.errors?.length) {
    const message = body.errors.map((e) => e.message ?? e.type ?? "error").join("; ");
    throw new GitHubError(`GitHub GraphQL: ${message}`);
  }
  if (body.data === undefined) throw new GitHubError("GitHub GraphQL: empty response");
  return fitting("GitHub's GraphQL data", body.data, schema);
}

export function restData<T>(what: string, text: string, schema: z.ZodType<T>): T {
  return text.trim() ? parseJson(what, text, schema) : fitting(what, undefined, schema);
}
