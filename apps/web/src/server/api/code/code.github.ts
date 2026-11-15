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
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { Boom } from "@groot/core/errors";
import { createNamespaceKv } from "@groot/core/kv";
import {
  createGhTransport,
  createGitHubClient,
  createHttpsTransport,
  type ExecPort,
  type GitHubClient,
} from "@tiny-agents/github";
import type { SandboxConnection } from "@tiny-agents/sandbox";
import { db, vaultItems } from "../../db";
import { app } from "../../app-root";
import { sandboxConnection } from "../bots/sandbox-host";
import { createAppCredential, deleteItemRow } from "../vault/vault.admin.service";
import { resolveGitHubToken } from "../vault/vault.service";
import { createWorkspace, type Workspace } from "./code.workspace";

export interface CodeGitHub {
  /** The client for GitHub's API (HTTPS with the token, else `gh` on the sandbox). */
  client(): Promise<GitHubClient>;
  /** Git on the sandbox, authenticated the same way. */
  workspace(): Promise<Workspace>;
  /** A vault token, or `gh` signed in on the sandbox. */
  credential(): Promise<"token" | "gh">;
}

interface GitHubSettings {
  /** The `app` vault item holding the token; unset means `gh auth login` on the sandbox. */
  tokenHandle?: string;
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

/** The services as Settings → GitHub configures them now. */
function defaultServices(): CodeGitHub {
  return {
    async client() {
      const { tokenHandle } = await githubSettings();
      if (tokenHandle) {
        return createGitHubClient(
          createHttpsTransport({ token: () => resolveGitHubToken(tokenHandle) }),
        );
      }
      return createGitHubClient(createGhTransport(requireSandbox()));
    },
    async workspace() {
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
  };
}

export function codeGitHub(): CodeGitHub {
  return app().codeGitHub ?? defaultServices();
}

export interface GitHubStatusView {
  credential: "token" | "gh";
  tokenHandle: string | null;
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
