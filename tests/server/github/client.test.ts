/**
 * @tiny-agents/github (issue #297 §7.1): one client over two transports. The
 * `gh` transport gets a fake exec answering `gh api` output (the subprocess
 * is the boundary); the HTTPS transport gets a fake fetch. The same contract
 * runs on both.
 */
import { describe, expect, it } from "vite-plus/test";
import {
  createGhTransport,
  createGitHubClient,
  createHttpsTransport,
  GitHubError,
  parseRepo,
  type ExecPort,
  type GitHubApi,
} from "../../../packages/github/src/index";

const repo = { owner: "acme", name: "web" };

/** A GraphQL answer for the snapshot query, as GitHub sends it. */
const SNAPSHOT = {
  repository: {
    mergeCommitAllowed: false,
    squashMergeAllowed: true,
    rebaseMergeAllowed: true,
    pullRequest: {
      id: "PR_1",
      number: 7,
      url: "https://github.com/acme/web/pull/7",
      title: "Fix login",
      body: "Body",
      state: "OPEN",
      isDraft: true,
      merged: false,
      mergeable: "UNKNOWN",
      headRefName: "ta/fix-login-a1",
      headRefOid: "aaa",
      baseRefName: "main",
      isCrossRepository: false,
      author: { login: "owner", __typename: "User" },
      reviews: {
        nodes: [
          {
            id: "R_1",
            state: "CHANGES_REQUESTED",
            body: "Please rename",
            submittedAt: "2026-11-05T00:00:00Z",
            authorAssociation: "COLLABORATOR",
            author: { login: "carol", __typename: "User" },
          },
        ],
      },
      reviewThreads: {
        nodes: [
          {
            id: "T_1",
            path: "src/a.ts",
            line: 3,
            isResolved: false,
            isOutdated: false,
            comments: {
              nodes: [
                {
                  id: "C_1",
                  databaseId: 11,
                  body: "nit",
                  createdAt: "2026-11-05T00:01:00Z",
                  authorAssociation: "NONE",
                  author: { login: "review-bot", __typename: "Bot" },
                },
              ],
            },
          },
        ],
      },
      comments: { nodes: [] },
      commits: {
        nodes: [
          {
            commit: {
              oid: "bbb",
              statusCheckRollup: {
                contexts: {
                  nodes: [
                    {
                      __typename: "CheckRun",
                      name: "test",
                      status: "COMPLETED",
                      conclusion: "FAILURE",
                      startedAt: "2026-11-05T00:00:00Z",
                      completedAt: "2026-11-05T00:05:00Z",
                      detailsUrl: "https://github.com/acme/web/actions/runs/9/job/42",
                      databaseId: 42,
                    },
                    {
                      __typename: "CheckRun",
                      name: "lint",
                      status: "IN_PROGRESS",
                      conclusion: null,
                      startedAt: "2026-11-05T00:00:00Z",
                      completedAt: null,
                      detailsUrl: null,
                      databaseId: 43,
                    },
                    {
                      __typename: "CheckRun",
                      name: "old",
                      status: "COMPLETED",
                      conclusion: "CANCELLED",
                      startedAt: null,
                      completedAt: null,
                      detailsUrl: null,
                      databaseId: 44,
                    },
                    {
                      __typename: "StatusContext",
                      context: "deploy",
                      state: "SUCCESS",
                      createdAt: "2026-11-05T00:02:00Z",
                      targetUrl: "https://example.com",
                    },
                  ],
                },
              },
            },
          },
        ],
      },
    },
  },
};

/** A fake `gh` on the sandbox: answers each `gh api` call from a table, records what it got. */
function fakeGh(
  answer: (args: string, stdin?: string) => { stdout: string; stderr?: string; exitCode?: number },
) {
  const calls: Array<{ command: string; stdin?: string }> = [];
  const exec: ExecPort = async (command, options = {}) => {
    calls.push({ command, stdin: options.stdin });
    const out = answer(command.replace(/^gh api /, ""), options.stdin);
    return { stdout: out.stdout, stderr: out.stderr ?? "", exitCode: out.exitCode ?? 0 };
  };
  return { exec, calls };
}

/** A fake api.github.com: answers by method and path. */
function fakeFetch(answer: (method: string, path: string, body?: unknown) => Response) {
  const calls: Array<{ method: string; path: string; auth: string | null; body?: unknown }> = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const auth = new Headers(init?.headers).get("authorization");
    calls.push({ method: init?.method ?? "GET", path, auth, body });
    return answer(init?.method ?? "GET", path, body);
  }) as typeof fetch;
  return { impl, calls };
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

/** The same answers through either transport. */
const TRANSPORTS: Array<[string, () => GitHubApi]> = [
  [
    "gh",
    () =>
      createGhTransport(
        fakeGh((args, stdin) => {
          if (args.startsWith("graphql")) {
            const { query } = JSON.parse(stdin!) as { query: string };
            if (query.includes("PullSnapshot"))
              return { stdout: JSON.stringify({ data: SNAPSHOT }) };
            return { stdout: JSON.stringify({ data: { viewer: { login: "owner" } } }) };
          }
          if (args.includes("/pulls") && args.includes("POST")) {
            return {
              stdout: JSON.stringify({ number: 8, html_url: "https://github.com/acme/web/pull/8" }),
            };
          }
          return { stdout: "", stderr: "gh: Not Found (HTTP 404)", exitCode: 1 };
        }).exec,
      ),
  ],
  [
    "https",
    () =>
      createHttpsTransport({
        token: async () => "t0ken",
        fetch: fakeFetch((method, path, body) => {
          if (path === "/graphql") {
            const { query } = body as { query: string };
            if (query.includes("PullSnapshot")) return json({ data: SNAPSHOT });
            return json({ data: { viewer: { login: "owner" } } });
          }
          if (method === "POST" && path.endsWith("/pulls")) {
            return json({ number: 8, html_url: "https://github.com/acme/web/pull/8" }, 201);
          }
          return json({ message: "Not Found" }, 404);
        }).impl,
      }),
  ],
];

describe.each(TRANSPORTS)("the client over %s", (_, transport) => {
  it("reads a PR snapshot in one query, as Code reads it", async () => {
    const snapshot = await createGitHubClient(transport()).snapshot(repo, 7);
    expect(snapshot.state).toBe("open");
    expect(snapshot.headSha).toBe("bbb");
    // GitHub has not computed mergeability yet: no decision either way.
    expect(snapshot.mergeable).toBe("unknown");
    expect(snapshot.mergeMethods).toEqual(["squash", "rebase"]);
    expect(snapshot.checks.map((c) => [c.name, c.state, c.jobId])).toEqual([
      ["test", "failure", 42],
      ["lint", "pending", null],
      ["old", "neutral", null],
      ["deploy", "success", null],
    ]);
    expect(snapshot.reviews[0]?.author).toEqual({
      login: "carol",
      type: "user",
      association: "COLLABORATOR",
    });
    expect(snapshot.threads[0]?.comments[0]?.author.type).toBe("bot");
  });

  it("opens a pull request", async () => {
    const pr = await createGitHubClient(transport()).createPull(repo, {
      head: "ta/x",
      base: "main",
      title: "T",
      body: "B",
      draft: true,
    });
    expect(pr).toEqual({ number: 8, url: "https://github.com/acme/web/pull/8" });
  });

  it("says what GitHub refused, with its status", async () => {
    const error = await createGitHubClient(transport())
      .merge(repo, 7, "squash")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubError);
    expect((error as GitHubError).status).toBe(404);
  });
});

describe("the gh transport", () => {
  it("sends request bodies on stdin, never on the command line", async () => {
    const gh = fakeGh(() => ({ stdout: JSON.stringify({ id: 5 }) }));
    await createGitHubClient(createGhTransport(gh.exec)).comment(repo, 7, "secret-ish body");
    expect(gh.calls[0]?.command).toBe(
      `gh api --method POST /repos/acme/web/issues/7/comments --input -`,
    );
    expect(JSON.parse(gh.calls[0]!.stdin!)).toEqual({ body: "secret-ish body" });
  });

  it("explains a missing or signed-out gh", async () => {
    const missing = createGhTransport(
      fakeGh(() => ({ stdout: "", stderr: "", exitCode: 127 })).exec,
    );
    await expect(createGitHubClient(missing).viewer()).rejects.toThrow("gh is not installed");
    const signedOut = createGhTransport(
      fakeGh(() => ({
        stdout: "",
        stderr: "To get started with GitHub CLI, please run:  gh auth login",
        exitCode: 4,
      })).exec,
    );
    await expect(createGitHubClient(signedOut).viewer()).rejects.toThrow("gh is not signed in");
  });

  it("surfaces GraphQL errors", async () => {
    const gh = fakeGh(() => ({
      stdout: JSON.stringify({ errors: [{ message: "Resource not accessible by integration" }] }),
      stderr: "gh: Resource not accessible",
      exitCode: 1,
    }));
    await expect(
      createGitHubClient(createGhTransport(gh.exec)).resolveThread("T_1"),
    ).rejects.toThrow("Resource not accessible by integration");
  });
});

describe("the HTTPS transport", () => {
  it("signs each request with the token", async () => {
    const fake = fakeFetch(() => json({ data: { viewer: { login: "owner" } } }));
    const client = createGitHubClient(
      createHttpsTransport({ token: async () => "t0ken", fetch: fake.impl }),
    );
    expect(await client.viewer()).toEqual({ login: "owner" });
    expect(fake.calls[0]?.auth).toBe("Bearer t0ken");
  });
});

describe("parseRepo", () => {
  it("reads the forms people paste", () => {
    expect(parseRepo("acme/web")).toEqual(repo);
    expect(parseRepo("https://github.com/acme/web.git")).toEqual(repo);
    expect(parseRepo("git@github.com:acme/web.git")).toEqual(repo);
    expect(parseRepo("https://gitlab.com/acme/web")).toBeUndefined();
    expect(parseRepo("acme/..")).toBeUndefined();
  });
});
