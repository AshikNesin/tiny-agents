/**
 * How Code reaches GitHub and git (issue #297 §7, ADR 0022), built from
 * Settings → GitHub:
 *
 * - With a token (recommended): API calls go over HTTPS from the app server
 *   with the token the vault releases (`github` sink), and only `git push`
 *   and fetches run on the sandbox, with the token handed to that one
 *   command on stdin.
 * - Without one: `gh` on the sandbox, signed in with `gh auth login`, for
 *   API calls and as git's credential helper.
 *
 * The services live in the App root (`app().codeGitHub`), so tests install
 * a fake GitHub and a local git without a sandbox.
 */
import { createSign, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { Boom } from "@groot/core/errors";
import { createNamespaceKv } from "@groot/core/kv";
import {
  createAppAuth,
  createGhTransport,
  createGitHubClient,
  createHttpsTransport,
  type AppAuth,
  type ExecPort,
  type GitHubClient,
  type RepoRef,
} from "@tiny-agents/github";
import type { SandboxConnection } from "@tiny-agents/sandbox";
import { db, vaultItems } from "../../db";
import { app } from "../../app-root";
import { sandboxConnection } from "../bots/sandbox-host";
import { createAppCredential, deleteItemRow } from "../vault/vault.admin.service";
import { resolveGitHubToken } from "../vault/vault.service";
import { createWorkspace, type Workspace } from "./code.workspace";

/** What decides how a project reaches GitHub: its transport and, for the App, its installation. */
interface ProjectTransport {
  transport: "gh" | "app";
  installationId: number | null;
}

export interface CodeGitHub {
  /**
   * The client for GitHub's API: for an App project, HTTPS with an
   * installation token; otherwise HTTPS with the vault token, else `gh` on
   * the sandbox.
   */
  client(project?: ProjectTransport): Promise<GitHubClient>;
  /** Git on the sandbox, authenticated the same way. */
  workspace(project?: ProjectTransport): Promise<Workspace>;
  /** A vault token, or `gh` signed in on the sandbox. */
  credential(): Promise<"token" | "gh">;
  /** The GitHub App installation that reaches `repo` (an App project). */
  installationFor(repo: RepoRef): Promise<number>;
}

interface GitHubSettings {
  /** The `app` vault item holding the token; unset means `gh auth login` on the sandbox. */
  tokenHandle?: string;
  /** The GitHub App (phase 6): its id, and the vault items with its key and webhook secret. */
  app?: { appId: string; keyHandle: string; webhookSecretHandle: string };
}

const settingsKv = () => createNamespaceKv("CODE_GITHUB");

async function githubSettings(): Promise<GitHubSettings> {
  return (await settingsKv().get<GitHubSettings>("settings")) ?? {};
}

/** The Sandbox connection as an exec port. */
function sandboxExec(connection: SandboxConnection): ExecPort {
  return async (command, options = {}) => {
    const result = await connection.exec(command, {
      stdin: options.stdin,
      timeoutMs: options.timeoutMs,
    });
    return {
      stdout: result.stdout.toString("utf8"),
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  };
}

function requireSandbox(): ExecPort {
  const connection = sandboxConnection();
  if (!connection) {
    throw Boom.unavailable("Code projects need a sandbox (SANDBOX_HOST, or `pnpm sandbox:up`).");
  }
  return sandboxExec(connection);
}

/** RS256 with the App's private key (PKCS#1 or PKCS#8 PEM), base64url. */
function rsaSign(pem: string, data: string): string {
  return createSign("RSA-SHA256").update(data).sign(pem).toString("base64url");
}

/** The App's token source, kept in the App root so installation tokens are reused. */
async function gitHubApp(): Promise<AppAuth> {
  const { app: config } = await githubSettings();
  if (!config) throw Boom.badRequest("Set up the GitHub App in Projects → GitHub first.");
  const key = `${config.appId}\0${config.keyHandle}`;
  const root = app();
  if (root.codeGitHubApp?.key === key) return root.codeGitHubApp.auth;
  const auth = createAppAuth({
    appId: config.appId,
    sign: async (data) => rsaSign(await resolveGitHubToken(config.keyHandle), data),
  });
  root.codeGitHubApp = { key, auth };
  return auth;
}

function installationOf(project: ProjectTransport): number {
  if (!project.installationId) throw Boom.badRequest("The project has no App installation.");
  return project.installationId;
}

/** The services as Settings → GitHub configures them now. */
function defaultServices(): CodeGitHub {
  return {
    async client(project) {
      if (project?.transport === "app") {
        const installation = installationOf(project);
        const auth = await gitHubApp();
        return createGitHubClient(
          createHttpsTransport({ token: () => auth.installationToken(installation) }),
        );
      }
      const { tokenHandle } = await githubSettings();
      if (tokenHandle) {
        return createGitHubClient(
          createHttpsTransport({ token: () => resolveGitHubToken(tokenHandle) }),
        );
      }
      return createGitHubClient(createGhTransport(requireSandbox()));
    },
    async workspace(project) {
      if (project?.transport === "app") {
        const installation = installationOf(project);
        const auth = await gitHubApp();
        return createWorkspace({
          exec: requireSandbox(),
          credential: { kind: "token", token: () => auth.installationToken(installation) },
        });
      }
      const { tokenHandle } = await githubSettings();
      return createWorkspace({
        exec: requireSandbox(),
        credential: tokenHandle
          ? { kind: "token", token: () => resolveGitHubToken(tokenHandle) }
          : { kind: "gh" },
      });
    },
    async credential() {
      return (await githubSettings()).tokenHandle ? "token" : "gh";
    },
    async installationFor(repo) {
      return (await gitHubApp()).installationFor(repo);
    },
  };
}

export function codeGitHub(): CodeGitHub {
  return app().codeGitHub ?? defaultServices();
}

export interface GitHubStatusView {
  credential: "token" | "gh";
  tokenHandle: string | null;
  /** The GitHub App, when one is set up (its id). */
  appId: string | null;
  sandbox: boolean;
  tools: { git: boolean; gh: boolean } | null;
  /** Who the credential acts as, when it works. */
  login: string | null;
  error: string | null;
}

/** What Settings → GitHub shows: which credential is active and whom it acts as. */
export async function githubStatus(): Promise<GitHubStatusView> {
  const { tokenHandle } = await githubSettings();
  const services = codeGitHub();
  const view: GitHubStatusView = {
    credential: await services.credential(),
    tokenHandle: tokenHandle ?? null,
    appId: (await githubSettings()).app?.appId ?? null,
    sandbox: Boolean(app().codeGitHub) || Boolean(sandboxConnection()),
    tools: null,
    login: null,
    error: null,
  };
  try {
    view.tools = await (await services.workspace()).tools();
  } catch (error) {
    view.error = error instanceof Error ? error.message : String(error);
  }
  try {
    view.login = (await (await services.client()).viewer()).login;
  } catch (error) {
    view.error ??= error instanceof Error ? error.message : String(error);
  }
  return view;
}

/**
 * Store a token as an `app` vault item for the `github` sink (replacing the
 * one Settings stored before), or with null go back to `gh auth login`.
 */
export async function setGitHubToken(token: string | null): Promise<void> {
  const kv = settingsKv();
  const before = await githubSettings();
  if (token) {
    const row = await createAppCredential({
      handle: `code-github-${randomBytes(3).toString("hex")}`,
      label: "Code: GitHub token",
      value: token,
      hosts: ["api.github.com", "github.com"],
      inject: { as: "header", name: "Authorization", format: "Bearer {value}" },
      tools: ["github"],
    });
    await kv.set("settings", { ...before, tokenHandle: row.handle });
  } else {
    await kv.set("settings", { ...before, tokenHandle: undefined });
  }
  if (before.tokenHandle) {
    const old = await db.query.vaultItems.findFirst({
      where: eq(vaultItems.handle, before.tokenHandle),
    });
    if (old) await deleteItemRow(old, { purge: true });
  }
}

/** Store the GitHub App's id, private key and webhook secret (each secret an `app` vault item). */
export async function setGitHubApp(
  input: { appId: string; privateKey: string; webhookSecret: string } | null,
): Promise<void> {
  const kv = settingsKv();
  const before = await githubSettings();
  if (input) {
    const suffix = randomBytes(3).toString("hex");
    const store = (name: string, label: string, value: string) =>
      createAppCredential({
        handle: `code-github-app-${name}-${suffix}`,
        label,
        value,
        hosts: ["api.github.com", "github.com"],
        inject: { as: "header", name: "Authorization", format: "Bearer {value}" },
        tools: ["github"],
      });
    const key = await store("key", "Code: GitHub App private key", input.privateKey);
    const secret = await store("webhook", "Code: GitHub App webhook secret", input.webhookSecret);
    await kv.set("settings", {
      ...before,
      app: { appId: input.appId, keyHandle: key.handle, webhookSecretHandle: secret.handle },
    });
  } else {
    await kv.set("settings", { ...before, app: undefined });
  }
  app().codeGitHubApp = undefined;
  for (const handle of [before.app?.keyHandle, before.app?.webhookSecretHandle]) {
    if (!handle) continue;
    const old = await db.query.vaultItems.findFirst({ where: eq(vaultItems.handle, handle) });
    if (old) await deleteItemRow(old, { purge: true });
  }
}

/** The webhook secret, or undefined when no App is set up. */
export async function webhookSecret(): Promise<string | undefined> {
  const { app: config } = await githubSettings();
  return config ? resolveGitHubToken(config.webhookSecretHandle) : undefined;
}
