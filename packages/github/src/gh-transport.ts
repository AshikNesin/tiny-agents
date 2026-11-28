import { z } from "zod";
import { failureMessage, GitHubError, graphQlData, restData, type GitHubApi } from "./api";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type ExecPort = (
  command: string,
  options?: { stdin?: string; timeoutMs?: number },
) => Promise<ExecResult>;

const SAFE_PATH = /^\/[A-Za-z0-9/_.%~-]+$/;

const GH_TIMEOUT_MS = 60_000;

function failure(result: ExecResult): GitHubError {
  const status = /\(HTTP (\d{3})\)/.exec(result.stderr)?.[1];
  const stderr = result.stderr.trim().replace(/^gh: /, "");
  let message = failureMessage(result.stdout, stderr || `gh exited with ${result.exitCode}`);
  if (result.exitCode === 127) message = "gh is not installed on the sandbox.";
  if (/auth login|not logged in/i.test(result.stderr)) {
    message = "gh is not signed in on the sandbox. Run `gh auth login` from the Terminal page.";
  }
  return new GitHubError(message, status ? Number(status) : undefined);
}

export function createGhTransport(exec: ExecPort): GitHubApi {
  async function run(args: string, stdin?: string): Promise<string> {
    const result = await exec(`gh api ${args}`, { stdin, timeoutMs: GH_TIMEOUT_MS });
    if (result.exitCode !== 0) {
      if (args.startsWith("graphql")) {
        try {
          graphQlData(result.stdout, z.unknown());
        } catch (error) {
          if (error instanceof GitHubError) throw error;
        }
      }
      throw failure(result);
    }
    return result.stdout;
  }

  return {
    kind: "gh",
    async graphql<T>(schema: z.ZodType<T>, query: string, variables: Record<string, unknown> = {}) {
      const out = await run("graphql --input -", JSON.stringify({ query, variables }));
      return graphQlData(out, schema);
    },
    async rest<T>(
      schema: z.ZodType<T>,
      method: string,
      path: string,
      options: { body?: unknown } = {},
    ) {
      if (!SAFE_PATH.test(path)) throw new GitHubError(`Invalid path ${path}`);
      const input = options.body === undefined ? "" : " --input -";
      const out = await run(
        `--method ${method} ${path}${input}`,
        options.body === undefined ? undefined : JSON.stringify(options.body),
      );
      return restData(`GitHub's answer to ${method} ${path}`, out, schema);
    },
    async text(method: string, path: string) {
      if (!SAFE_PATH.test(path)) throw new GitHubError(`Invalid path ${path}`);
      return run(`--method ${method} ${path}`);
    },
  };
}
