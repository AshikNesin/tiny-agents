import { GitHubError, graphQlData, type GitHubApi, type GraphQlBody } from "./api";

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
  let message = result.stderr.trim().replace(/^gh: /, "");
  try {
    const body = JSON.parse(result.stdout) as { message?: string; errors?: unknown };
    if (typeof body.message === "string") message = body.message;
  } catch {}
  if (result.exitCode === 127) message = "gh is not installed on the sandbox.";
  if (/auth login|not logged in/i.test(result.stderr)) {
    message = "gh is not signed in on the sandbox. Run `gh auth login` from the Terminal page.";
  }
  return new GitHubError(
    message || `gh exited with ${result.exitCode}`,
    status ? Number(status) : undefined,
  );
}

export function createGhTransport(exec: ExecPort): GitHubApi {
  async function run(args: string, stdin?: string): Promise<string> {
    const result = await exec(`gh api ${args}`, { stdin, timeoutMs: GH_TIMEOUT_MS });
    if (result.exitCode !== 0) {
      if (args.startsWith("graphql")) {
        try {
          graphQlData(JSON.parse(result.stdout) as GraphQlBody<unknown>);
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
    async graphql<T>(query: string, variables: Record<string, unknown> = {}) {
      const out = await run("graphql --input -", JSON.stringify({ query, variables }));
      return graphQlData(JSON.parse(out) as GraphQlBody<T>);
    },
    async rest<T>(method: string, path: string, options: { body?: unknown; text?: boolean } = {}) {
      if (!SAFE_PATH.test(path)) throw new GitHubError(`Invalid path ${path}`);
      const input = options.body === undefined ? "" : " --input -";
      const out = await run(
        `--method ${method} ${path}${input}`,
        options.body === undefined ? undefined : JSON.stringify(options.body),
      );
      if (options.text) return out as T;
      return (out.trim() ? JSON.parse(out) : undefined) as T;
    },
  };
}
