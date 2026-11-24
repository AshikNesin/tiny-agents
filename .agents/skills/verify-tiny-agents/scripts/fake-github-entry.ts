/**
 * `ta-verify up --fake-github` (loaded by verify-entry.ts): Code's GitHub and git
 * replaced by the server tests' fakes, so a verify run can drive projects and
 * pull requests end to end with no sandbox and no GitHub. The workspace runs
 * real git in a local bash against a local bare repository (`acme/web`); the
 * GitHub API is the in-memory fake from `tests/server/code/projects`.
 *
 * Journeys shape the fake's PRs (checks, reviews, mergeability) through a
 * control server on port + 3:
 *   GET  /state           every PR, as the fake holds it
 *   POST /pulls/:n        merge a JSON object into PR n (checks, threads, …)
 *   POST /inbox           replace the Reviews inbox
 */
import http from "node:http";
import { installAppForTests } from "../../../../apps/web/src/server/app-root";
import { createWorkspace } from "../../../../apps/web/src/server/api/code/code.workspace";
import { bareRepo, localExec } from "../../../../tests/server/code/projects/local-exec";
import { fakeGitHub } from "../../../../tests/server/code/projects/fake-github";

const local = localExec();
const bare = await bareRepo(local);
const github = fakeGitHub(local, bare, "demo");
// GitHub keeps every PR's head under refs/pull/N/head (review mode fetches it).
const createPull = github.createPull.bind(github);
github.createPull = async (repo, input) => {
  const made = await createPull(repo, input);
  await local.exec(
    `git -C ${bare} update-ref refs/pull/${made.number}/head refs/heads/${input.head}`,
  );
  return made;
};
const ws = createWorkspace({
  exec: local.exec,
  credential: { kind: "token", token: async () => "ghs_verify" },
  remoteUrl: () => bare,
});
installAppForTests({
  codeGitHub: {
    client: async () => github,
    workspace: async () => ws,
    credential: async () => "token",
    installationFor: async () => 1,
    appRepositories: async () => [
      { fullName: "acme/web", installationId: 1, private: true },
      { fullName: "acme/api", installationId: 1, private: true },
    ],
    convertManifest: async () => {
      throw new Error("No GitHub App in a verify run.");
    },
  },
});

const port = Number(process.env.PORT ?? 3100) + 3;
http
  .createServer((req, res) => {
    let raw = "";
    req.on("data", (d: Buffer) => (raw += d.toString("utf8")));
    req.on("end", () => {
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      try {
        const pull = /^\/pulls\/(\d+)$/.exec(req.url ?? "");
        if (req.method === "GET" && req.url === "/state") {
          return send(200, {
            bare,
            home: local.home,
            pulls: github.pulls,
            merged: github.merged,
            submitted: github.submitted,
          });
        }
        if (req.method === "POST" && pull) {
          Object.assign(github.pull(Number(pull[1])), JSON.parse(raw || "{}"));
          return send(200, github.pull(Number(pull[1])));
        }
        if (req.method === "POST" && req.url === "/inbox") {
          github.inbox = JSON.parse(raw || "[]");
          return send(200, github.inbox);
        }
        send(404, { error: "not found" });
      } catch (error) {
        send(400, { error: String(error) });
      }
    });
  })
  .listen(port, "127.0.0.1");
process.on("exit", () => local.cleanup());
