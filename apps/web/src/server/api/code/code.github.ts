import { createHash, createSign, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { Boom } from "@groot/core/errors";
import { createNamespaceKv } from "@groot/core/kv";
import {
  convertManifest,
  createAppAuth,
  createGhTransport,
  createGitHubClient,
  createHttpsTransport,
  type AppAuth,
  type ManifestApp,
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

interface ProjectTransport {
  transport: "gh" | "app";
  installationId: number | null;
}

export interface CodeGitHub {
  client(project?: ProjectTransport): Promise<GitHubClient>;
  workspace(project?: ProjectTransport): Promise<Workspace>;
  credential(): Promise<"token" | "gh">;
  installationFor(repo: RepoRef): Promise<number>;
  appRepositories(): Promise<Array<{ fullName: string; installationId: number; private: boolean }>>;
  convertManifest(code: string): Promise<ManifestApp>;
}

interface GitHubSettings {
  tokenHandle?: string;
  app?: {
    appId: string;
    slug: string;
    name: string;
    keyHandle: string;
    webhookSecretHandle: string | null;
  };
}

const settingsKv = () => createNamespaceKv("CODE_GITHUB");

async function githubSettings(): Promise<GitHubSettings> {
  return (await settingsKv().get<GitHubSettings>("settings")) ?? {};
}

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

function rsaSign(pem: string, data: string): string {
  return createSign("RSA-SHA256").update(data).sign(pem).toString("base64url");
}

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
    async appRepositories() {
      return (await gitHubApp()).repositories();
    },
    convertManifest: (code) => convertManifest(code),
  };
}

export function codeGitHub(): CodeGitHub {
  return app().codeGitHub ?? defaultServices();
}

export interface GitHubStatusView {
  credential: "token" | "gh";
  tokenHandle: string | null;
  app: { slug: string; name: string; webhooks: boolean } | null;
  sandbox: boolean;
  tools: { git: boolean; gh: boolean } | null;
  login: string | null;
  error: string | null;
}

export async function githubStatus(): Promise<GitHubStatusView> {
  const { tokenHandle } = await githubSettings();
  const services = codeGitHub();
  const view: GitHubStatusView = {
    credential: await services.credential(),
    tokenHandle: tokenHandle ?? null,
    app: await githubSettings().then(({ app: config }) =>
      config
        ? { slug: config.slug, name: config.name, webhooks: config.webhookSecretHandle !== null }
        : null,
    ),
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

async function setGitHubApp(
  input: {
    appId: string;
    slug: string;
    name: string;
    privateKey: string;
    webhookSecret: string | null;
  } | null,
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
    const key = await store("key", `Code: GitHub App ${input.name} private key`, input.privateKey);
    const secret = input.webhookSecret
      ? await store("webhook", `Code: GitHub App ${input.name} webhook secret`, input.webhookSecret)
      : null;
    await kv.set("settings", {
      ...before,
      app: {
        appId: input.appId,
        slug: input.slug,
        name: input.name,
        keyHandle: key.handle,
        webhookSecretHandle: secret?.handle ?? null,
      },
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

export async function disconnectGitHubApp(): Promise<void> {
  await setGitHubApp(null);
}

export async function webhookSecret(): Promise<string | undefined> {
  const { app: config } = await githubSettings();
  return config?.webhookSecretHandle ? resolveGitHubToken(config.webhookSecretHandle) : undefined;
}

export const FLOW_COOKIE = "tiny_agents_github_flow";
const FLOW_TTL_MS = 10 * 60_000;
const flowKv = () => createNamespaceKv("CODE_GITHUB_FLOW");
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

const APP_EVENTS = [
  "pull_request",
  "pull_request_review",
  "pull_request_review_comment",
  "pull_request_review_thread",
  "check_run",
  "check_suite",
  "status",
  "issue_comment",
];
const APP_PERMISSIONS = {
  contents: "write",
  pull_requests: "write",
  issues: "write",
  checks: "read",
  statuses: "read",
  actions: "read",
  metadata: "read",
};

async function beginFlow(kind: "manifest" | "install") {
  const state = randomBytes(24).toString("base64url");
  const binding = randomBytes(24).toString("base64url");
  await flowKv().set(sha256(state), { binding: sha256(binding), kind }, FLOW_TTL_MS);
  return { state, binding };
}

async function claimFlow(state: string, binding: string, kind: "manifest" | "install") {
  const flow = await flowKv().take<{ binding: string; kind: string }>(sha256(state));
  if (!flow || flow.kind !== kind || flow.binding !== sha256(binding)) {
    throw Boom.badRequest("The GitHub setup expired or did not start here. Start it again.");
  }
}

export async function startManifest(origin: string, organization?: string) {
  if ((await githubSettings()).app) {
    throw Boom.conflict("Disconnect the GitHub App before creating another.");
  }
  const flow = await beginFlow("manifest");
  const base = origin.replace(/\/+$/, "");
  const webhooks = base.startsWith("https://");
  const url = organization
    ? `https://github.com/organizations/${encodeURIComponent(organization)}/settings/apps/new`
    : "https://github.com/settings/apps/new";
  return {
    binding: flow.binding,
    webhooks,
    url: `${url}?state=${flow.state}`,
    manifest: {
      name: `tiny-agents-${randomBytes(4).toString("hex")}`,
      url: base,
      redirect_url: `${base}/api/v1/code/github/callback`,
      setup_url: `${base}/api/v1/code/github/installed`,
      setup_on_update: true,
      public: false,
      ...(webhooks
        ? { hook_attributes: { url: `${base}/api/v1/code/github/webhook`, active: true } }
        : {}),
      default_permissions: APP_PERMISSIONS,
      default_events: webhooks ? APP_EVENTS : [],
    },
  };
}

export async function completeManifest(
  state: string,
  binding: string,
  code: string,
): Promise<void> {
  await claimFlow(state, binding, "manifest");
  if ((await githubSettings()).app) throw Boom.conflict("A GitHub App is already connected.");
  const created = await codeGitHub().convertManifest(code);
  await setGitHubApp({
    appId: String(created.id),
    slug: created.slug,
    name: created.name,
    privateKey: created.pem,
    webhookSecret: created.webhookSecret,
  });
}

export async function startInstall() {
  const { app: config } = await githubSettings();
  if (!config) throw Boom.badRequest("Create the GitHub App first.");
  const flow = await beginFlow("install");
  return {
    binding: flow.binding,
    url: `https://github.com/apps/${encodeURIComponent(config.slug)}/installations/new?state=${flow.state}`,
  };
}

export async function completeInstall(state: string, binding: string, installationId: number) {
  await claimFlow(state, binding, "install");
  const repositories = await codeGitHub().appRepositories();
  if (!repositories.some((r) => r.installationId === installationId)) {
    throw Boom.badRequest("That installation reaches no repository this App can use.");
  }
}
