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
            commit: { oid: "rev1" },
          },
        ],
      },
      reviewThreads: {
        nodes: [
          {
            id: "T_1",
            path: "src/a.ts",
            line: 3,
            startLine: 1,
            diffSide: "LEFT",
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
    expect(snapshot.mergeable).toBe("unknown");
    expect(snapshot.mergeMethods).toEqual(["squash", "rebase"]);
    expect(snapshot.checks.map((c) => [c.name, c.state, c.jobId])).toEqual([
      ["test", "failure", 42],
      ["lint", "pending", null],
      ["old", "neutral", null],
      ["deploy", "success", null],
    ]);
    expect(snapshot.reviews[0]?.commit).toBe("rev1");
    expect(snapshot.reviews[0]?.author).toEqual({
      login: "carol",
      type: "user",
      association: "COLLABORATOR",
    });
    expect(snapshot.threads[0]?.comments[0]?.author.type).toBe("bot");
    expect(snapshot.threads[0]).toMatchObject({ side: "LEFT", startLine: 1, line: 3 });
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

describe("a check that ran more than once", () => {
  it("shows each check once: its latest run", async () => {
    const raw = structuredClone(SNAPSHOT);
    const nodes = raw.repository.pullRequest.commits.nodes[0]!.commit.statusCheckRollup.contexts
      .nodes as Array<Record<string, unknown>>;
    nodes.push(
      {
        __typename: "CheckRun",
        name: "test",
        status: "COMPLETED",
        conclusion: "SUCCESS",
        startedAt: "2026-11-04T23:00:00Z",
        completedAt: "2026-11-04T23:05:00Z",
        detailsUrl: "https://github.com/acme/web/actions/runs/8/job/40",
        databaseId: 40,
      },
      {
        __typename: "CheckRun",
        name: "test",
        status: "COMPLETED",
        conclusion: "SUCCESS",
        startedAt: "2026-11-04T23:30:00Z",
        completedAt: "2026-11-04T23:35:00Z",
        detailsUrl: "https://github.com/acme/web/actions/runs/8/job/41",
        databaseId: 41,
      },
    );
    const gh = createGhTransport(fakeGh(() => ({ stdout: JSON.stringify({ data: raw }) })).exec);
    const snapshot = await createGitHubClient(gh).snapshot(repo, 7);
    expect(snapshot.checks.map((c) => [c.name, c.state, c.jobId])).toEqual([
      ["test", "failure", 42],
      ["lint", "pending", null],
      ["old", "neutral", null],
      ["deploy", "success", null],
    ]);
  });
});

describe("the review inbox", () => {
  const node = (number: number, extra: Record<string, unknown> = {}) => ({
    number,
    title: `PR ${number}`,
    url: `https://github.com/acme/web/pull/${number}`,
    isDraft: false,
    updatedAt: "2026-11-17T09:00:00Z",
    headRefOid: `head${number}`,
    reviewDecision: "REVIEW_REQUIRED",
    repository: { owner: { login: "acme" }, name: "web" },
    author: { login: "maria" },
    reviews: { nodes: [] },
    ...extra,
  });

  it("asks for the viewer's own reviews, and lists each PR once by its first reason", async () => {
    const fake = fakeFetch((_method, _path, body) => {
      const { query } = body as { query: string };
      if (!query.includes("ReviewInbox")) return json({ data: { viewer: { login: "ashik" } } });
      return json({
        data: {
          requested: { nodes: [node(1)] },
          reviewed: {
            nodes: [
              node(1),
              node(2, {
                reviewDecision: "CHANGES_REQUESTED",
                reviews: {
                  nodes: [{ submittedAt: "2026-11-16T08:00:00Z", commit: { oid: "old2" } }],
                },
              }),
              {},
            ],
          },
          authored: { nodes: [node(3, { author: { login: "ashik" }, isDraft: true })] },
        },
      });
    });
    const client = createGitHubClient(
      createHttpsTransport({ token: async () => "t0ken", fetch: fake.impl }),
    );

    const inbox = await client.reviewInbox();

    expect((fake.calls[1]?.body as { variables: unknown }).variables).toEqual({
      login: "ashik",
      requested: "is:open is:pr archived:false review-requested:@me sort:updated-desc",
      reviewed: "is:open is:pr archived:false reviewed-by:@me -author:@me sort:updated-desc",
      authored: "is:open is:pr archived:false author:@me sort:updated-desc",
    });
    expect(inbox.map((p) => [p.reason, p.number])).toEqual([
      ["requested", 1],
      ["reviewed", 2],
      ["authored", 3],
    ]);
    expect(inbox[1]).toEqual({
      reason: "reviewed",
      repo: { owner: "acme", name: "web" },
      number: 2,
      title: "PR 2",
      url: "https://github.com/acme/web/pull/2",
      author: "maria",
      draft: false,
      updatedAt: "2026-11-17T09:00:00Z",
      headSha: "head2",
      decision: "changes_requested",
      lastReview: { at: "2026-11-16T08:00:00Z", commit: "old2" },
    });
    expect(inbox[2]?.draft).toBe(true);
  });

  it("narrows each search by when it was updated, its repositories and drafts", async () => {
    const fake = fakeFetch((_method, _path, body) => {
      const { query } = body as { query: string };
      if (!query.includes("ReviewInbox")) return json({ data: { viewer: { login: "ashik" } } });
      return json({
        data: {
          requested: {
            nodes: [node(1), node(2, { repository: { owner: { login: "other" }, name: "lib" } })],
          },
          reviewed: { nodes: [] },
          authored: { nodes: [] },
        },
      });
    });
    const client = createGitHubClient(
      createHttpsTransport({ token: async () => "t0ken", fetch: fake.impl }),
    );

    const inbox = await client.reviewInbox({
      updatedSince: "2026-10-07",
      repos: [{ owner: "acme", name: "web" }],
      drafts: false,
    });

    const { variables } = fake.calls[1]?.body as { variables: Record<string, string> };
    expect(variables.requested).toBe(
      "is:open is:pr archived:false review-requested:@me updated:>=2026-10-07 draft:false repo:acme/web sort:updated-desc",
    );
    expect(variables.authored).toBe(
      "is:open is:pr archived:false author:@me updated:>=2026-10-07 draft:false repo:acme/web sort:updated-desc",
    );
    expect(inbox.map((p) => p.number)).toEqual([1]);
  });
});

describe("submitting a review", () => {
  it("sends its line comments with GitHub's sides, a range as start_line and line", async () => {
    const fake = fakeFetch(() =>
      json({ html_url: "https://github.com/acme/web/pull/7#pullrequestreview-1" }, 200),
    );
    const client = createGitHubClient(
      createHttpsTransport({ token: async () => "t0ken", fetch: fake.impl }),
    );
    const out = await client.submitReview(repo, 7, {
      commitId: "abc123",
      event: "REQUEST_CHANGES",
      body: "A few things",
      comments: [
        { path: "src/a.ts", side: "RIGHT", line: 12, body: "Cap this" },
        { path: "src/b.ts", side: "LEFT", startLine: 3, line: 5, body: "Why remove?" },
      ],
    });
    expect(out.url).toBe("https://github.com/acme/web/pull/7#pullrequestreview-1");
    expect(fake.calls[0]).toMatchObject({
      method: "POST",
      path: "/repos/acme/web/pulls/7/reviews",
      body: {
        commit_id: "abc123",
        event: "REQUEST_CHANGES",
        body: "A few things",
        comments: [
          { path: "src/a.ts", side: "RIGHT", line: 12, body: "Cap this" },
          {
            path: "src/b.ts",
            side: "LEFT",
            start_side: "LEFT",
            start_line: 3,
            line: 5,
            body: "Why remove?",
          },
        ],
      },
    });
    expect(fake.calls[0]?.body).not.toHaveProperty("comments.0.start_line");
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

describe("the GitHub App", () => {
  it("trades a signed app JWT for an installation token, and reuses it until it nearly expires", async () => {
    const { createAppAuth } = await import("../../../packages/github/src/index");
    let now = Date.parse("2026-11-05T12:00:00Z");
    const signed: string[] = [];
    const fake = fakeFetch((method, path) => {
      if (method === "POST" && path === "/app/installations/77/access_tokens") {
        return json(
          {
            token: `ghs_${fake.calls.length}`,
            expires_at: new Date(now + 60 * 60_000).toISOString(),
          },
          201,
        );
      }
      if (path === "/repos/acme/web/installation") return json({ id: 77 });
      return json({ message: "Not Found" }, 404);
    });
    const auth = createAppAuth({
      appId: "123",
      sign: async (data) => {
        signed.push(data);
        return "sig";
      },
      fetch: fake.impl,
      now: () => now,
    });
    expect(await auth.installationFor(repo)).toBe(77);
    expect(await auth.installationToken(77)).toBe("ghs_2");
    expect(await auth.installationToken(77)).toBe("ghs_2");
    now += 59 * 60_000 + 1;
    expect(await auth.installationToken(77)).toBe("ghs_3");

    const [header, payload] = signed[0]!
      .split(".")
      .map((part) => JSON.parse(Buffer.from(part, "base64url").toString()));
    expect(header).toEqual({ alg: "RS256", typ: "JWT" });
    expect(payload).toEqual({
      iat: Date.parse("2026-11-05T12:00:00Z") / 1000 - 60,
      exp: Date.parse("2026-11-05T12:00:00Z") / 1000 + 540,
      iss: "123",
    });
    expect(fake.calls[1]?.auth).toBe(`Bearer ${signed[1]?.split(".").slice(0, 2).join(".")}.sig`);
  });

  it("accepts a webhook only with the right signature", async () => {
    const { verifyWebhook } = await import("../../../packages/github/src/index");
    const good = "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17";
    expect(await verifyWebhook("It's a Secret to Everybody", "Hello, World!", good)).toBe(true);
    expect(await verifyWebhook("It's a Secret to Everybody", "Hello, World?", good)).toBe(false);
    expect(await verifyWebhook("It's a Secret to Everybody", "Hello, World!", undefined)).toBe(
      false,
    );
  });
});

describe("convertManifest", () => {
  it("trades the one-time code for the App GitHub created", async () => {
    const { convertManifest } = await import("../../../packages/github/src/index");
    const fake = fakeFetch((method, path) =>
      method === "POST" && path === "/app-manifests/abc/conversions"
        ? json(
            {
              id: 5,
              slug: "tiny-agents-1",
              name: "tiny-agents-1",
              pem: "PEM",
              webhook_secret: "s3",
            },
            201,
          )
        : json({ message: "Not Found" }, 404),
    );
    expect(await convertManifest("abc", { fetch: fake.impl })).toEqual({
      id: 5,
      slug: "tiny-agents-1",
      name: "tiny-agents-1",
      pem: "PEM",
      webhookSecret: "s3",
    });
    expect(fake.calls[0]?.auth).toBeNull();
    await expect(convertManifest("used", { fetch: fake.impl })).rejects.toThrow("Not Found");
  });
});
