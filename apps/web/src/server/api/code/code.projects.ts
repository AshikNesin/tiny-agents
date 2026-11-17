/**
 * Code projects (issue #297 §6, ADR 0021): a GitHub repository bound to a
 * checkout on the sandbox, with defaults and scripts. A thread started in a
 * project gets its own worktree on a new branch, cut from the freshly
 * fetched base branch, and the harness runs there as it would in any
 * directory, so this works for every harness whose `cwd` is on the sandbox
 * without a driver change. Threads without a project are untouched.
 */
import { randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { Boom } from "@groot/core/errors";
import { logger } from "@groot/core/logger";
import { parseRepo, repoSlug, type RepoRef } from "@tiny-agents/github";
import { threadIdOf, type CreateThreadInput, type HarnessInstance } from "@tiny-agents/code/server";
import {
  codeCheckpoints,
  codeProjects,
  codeThreads,
  db,
  type CodeProjectRow,
  type CodeThreadRow,
} from "../../db";
import type {
  ProjectCreateBody,
  ProjectSettings,
  ProjectUpdateBody,
  ProjectView,
} from "../../../shared/api/code";
import { DEFAULT_AUTOFIX } from "./code.autofix";
import { codeGitHub } from "./code.github";
import { applyTitle, threadNames } from "./code.naming";
import {
  branchName,
  checkpointRef,
  cleanBranchPrefix,
  DEFAULT_BRANCH_PREFIX,
  type ProjectScripts,
  type Workspace,
} from "./code.workspace";
import { PROJECT_RULE, projectHeader } from "../../../shared/code-messages";

const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  scripts: {},
  archiveOnMerge: true,
  branchPrefix: DEFAULT_BRANCH_PREFIX,
  protectedPaths: [".github/workflows/**"],
  autofix: {
    triggers: { ...DEFAULT_AUTOFIX.triggers },
    trustedBots: [],
    hourlyLimit: DEFAULT_AUTOFIX.hourlyLimit,
    noOwnerLimit: DEFAULT_AUTOFIX.noOwnerLimit,
    passMinutes: DEFAULT_AUTOFIX.passMinutes,
    onByDefault: false,
    finalCheck: false,
    autoMergeByDefault: false,
  },
};

/** A project's stored settings over the defaults; anything malformed falls back. */
export function projectSettings(raw: string): ProjectSettings {
  let value: Partial<ProjectSettings> = {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") value = parsed as Partial<ProjectSettings>;
  } catch {
    // Defaults.
  }
  const d = DEFAULT_PROJECT_SETTINGS;
  return {
    scripts: { ...d.scripts, ...value.scripts },
    archiveOnMerge: value.archiveOnMerge ?? d.archiveOnMerge,
    branchPrefix:
      (typeof value.branchPrefix === "string" ? cleanBranchPrefix(value.branchPrefix) : null) ??
      d.branchPrefix,
    protectedPaths: Array.isArray(value.protectedPaths) ? value.protectedPaths : d.protectedPaths,
    autofix: {
      ...d.autofix,
      ...value.autofix,
      triggers: { ...d.autofix.triggers, ...value.autofix?.triggers },
    },
  };
}

export const repoOf = (project: Pick<CodeProjectRow, "repoOwner" | "repoName">): RepoRef => ({
  owner: project.repoOwner,
  name: project.repoName,
});

export function projectView(row: CodeProjectRow): ProjectView {
  return {
    id: row.id,
    name: row.name,
    repo: repoOf(row),
    transport: row.transport,
    baseBranch: row.baseBranch,
    checkoutPath: row.checkoutPath,
    defaultInstanceId: row.defaultInstanceId,
    defaultModel: row.defaultModel,
    settings: projectSettings(row.settings),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listProjects(): Promise<CodeProjectRow[]> {
  return db.select().from(codeProjects).orderBy(desc(codeProjects.updatedAt));
}

export async function getProject(id: string): Promise<CodeProjectRow> {
  const row = await db.query.codeProjects.findFirst({ where: eq(codeProjects.id, id) });
  if (!row) throw Boom.notFound("No such project");
  return row;
}

/** Where a project's checkout and worktrees live on the sandbox. */
function projectRoot(home: string, repo: RepoRef): string {
  return `${home.replace(/\/$/, "")}/tiny-agents-code/${repo.owner}--${repo.name}`;
}

const worktreePath = (project: CodeProjectRow, branch: string) =>
  `${project.checkoutPath.replace(/\/checkout$/, "")}/worktrees/${branch.replaceAll("/", "_")}`;

/**
 * Create a project: check the sandbox has what it needs and the credential
 * reaches the repository, then clone it (or reuse a checkout already there).
 */
export async function createProject(input: ProjectCreateBody): Promise<CodeProjectRow> {
  const repo = parseRepo(input.repo);
  if (!repo) throw Boom.badRequest("Give a GitHub repository as owner/name or its URL.");
  const taken = await db.query.codeProjects.findFirst({
    where: and(eq(codeProjects.repoOwner, repo.owner), eq(codeProjects.repoName, repo.name)),
  });
  if (taken) throw Boom.conflict(`${repoSlug(repo)} is already a project.`);

  const services = codeGitHub();
  const app = input.transport === "app";
  const installationId = app
    ? await services.installationFor(repo).catch((error: unknown) => {
        throw Boom.badRequest(
          `The GitHub App is not installed on ${repoSlug(repo)}: ${error instanceof Error ? error.message : String(error)}`,
        );
      })
    : null;
  const transport = { transport: app ? ("app" as const) : ("gh" as const), installationId };
  const ws = await services.workspace(transport);
  const tools = await ws.tools();
  const credential = await services.credential();
  const missing = [
    ...(tools.git ? [] : ["git"]),
    ...(tools.gh || credential === "token" || app ? [] : ["gh"]),
  ];
  if (missing.length) {
    throw Boom.badRequest(
      `The sandbox has no ${missing.join(" or ")}. Install ${missing.length > 1 ? "them" : "it"} there first.`,
    );
  }
  const github = await services.client(transport);
  const info = await github.repository(repo).catch((error: unknown) => {
    throw Boom.badRequest(
      `Cannot reach ${repoSlug(repo)} on GitHub: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
  const checkout = `${projectRoot(await ws.home(), repo)}/checkout`;
  if (!(await ws.exists(`${checkout}/.git`))) await ws.clone(repo, checkout);

  const [row] = await db
    .insert(codeProjects)
    .values({
      name: input.name?.trim() || repo.name,
      repoOwner: repo.owner,
      repoName: repo.name,
      transport: transport.transport,
      installationId,
      baseBranch: input.baseBranch?.trim() || info.defaultBranch,
      checkoutPath: checkout,
      defaultInstanceId: input.defaultInstanceId ?? null,
      defaultModel: input.defaultModel ?? null,
      settings: JSON.stringify({}),
    })
    .returning();
  return row!;
}

export async function updateProject(
  id: string,
  change: ProjectUpdateBody,
): Promise<CodeProjectRow> {
  const row = await getProject(id);
  const current = projectSettings(row.settings);
  const settings: ProjectSettings | undefined = change.settings
    ? {
        ...current,
        ...change.settings,
        scripts: { ...current.scripts, ...change.settings.scripts },
        autofix: {
          ...current.autofix,
          ...change.settings.autofix,
          triggers: { ...current.autofix.triggers, ...change.settings.autofix?.triggers },
        },
      }
    : undefined;
  const [updated] = await db
    .update(codeProjects)
    .set({
      ...(change.name !== undefined ? { name: change.name.trim() || row.name } : {}),
      ...(change.baseBranch !== undefined ? { baseBranch: change.baseBranch.trim() } : {}),
      ...(change.defaultInstanceId !== undefined
        ? { defaultInstanceId: change.defaultInstanceId }
        : {}),
      ...(change.defaultModel !== undefined ? { defaultModel: change.defaultModel } : {}),
      ...(settings ? { settings: JSON.stringify(settings) } : {}),
      updatedAt: new Date(),
    })
    .where(eq(codeProjects.id, id))
    .returning();
  return updated!;
}

/** Remove a project: its threads keep working without one; the checkout stays on the sandbox. */
export async function deleteProject(id: string): Promise<void> {
  await getProject(id);
  await db.update(codeThreads).set({ projectId: null }).where(eq(codeThreads.projectId, id));
  await db.delete(codeProjects).where(eq(codeProjects.id, id));
}

/** The project thread behind a thread id, or undefined for a thread without a project. */
export async function projectThread(
  threadId: string,
): Promise<{ thread: CodeThreadRow; project: CodeProjectRow } | undefined> {
  const thread = await db.query.codeThreads.findFirst({ where: eq(codeThreads.id, threadId) });
  if (!thread?.projectId) return undefined;
  const project = await db.query.codeProjects.findFirst({
    where: eq(codeProjects.id, thread.projectId),
  });
  return project ? { thread, project } : undefined;
}

/** The scripts that apply: the project's overrides over the checked-in file. */
export async function scriptsFor(
  project: CodeProjectRow,
  ws: Workspace,
  path: string,
): Promise<ProjectScripts> {
  const checkedIn = await ws.readScripts(path).catch(() => ({}));
  return { ...checkedIn, ...projectSettings(project.settings).scripts };
}

/** What the agent is told once, at the top of a project thread's first message. */
function projectPreamble(
  project: CodeProjectRow,
  branch: string,
  scripts: ProjectScripts,
  setupFailure?: string,
): string {
  const lines = [
    projectHeader(repoSlug(repoOf(project)), branch, project.baseBranch),
    PROJECT_RULE,
  ];
  if (scripts.check) lines.push(`Run \`${scripts.check}\` before you report done.`);
  if (setupFailure) {
    lines.push(`Note: the project's setup script failed:\n\`\`\`\n${setupFailure}\n\`\`\``);
  }
  return lines.join("\n");
}

/** `<prefix><slug>`, or `<prefix><slug>-2`, `-3`, … when an earlier thread took the name. */
async function freeBranch(
  ws: Workspace,
  checkout: string,
  prefix: string,
  slug: string,
): Promise<string> {
  for (let n = 1; n <= 20; n += 1) {
    const branch = branchName(prefix, n === 1 ? slug : `${slug}-${n}`);
    if (!(await ws.branchTaken(checkout, branch))) return branch;
  }
  return branchName(prefix, `${slug}-${randomBytes(2).toString("hex")}`);
}

export interface ProjectThreadInput extends CreateThreadInput {
  /** Check out this existing branch (a PR's head) instead of cutting a new one. */
  branch?: string;
}

/**
 * Start a thread in a project: a worktree on a new branch from the freshly
 * fetched base (or on an existing branch), `setup` before the first turn
 * (a failure is reported to the agent, and the turn still starts), then
 * the harness's own `createThread` with that worktree as `cwd`.
 */
export async function startProjectThread(
  project: CodeProjectRow,
  instance: HarnessInstance,
  input: ProjectThreadInput,
): Promise<{ nativeId: string; branch: string; worktree: string }> {
  const ws = await codeGitHub().workspace(project);
  // A new branch and the thread's short title come from one naming call.
  const names = input.branch ? null : await threadNames(input.message);
  const prefix = projectSettings(project.settings).branchPrefix;
  const branch = input.branch ?? (await freeBranch(ws, project.checkoutPath, prefix, names!.slug));
  const path = worktreePath(project, branch);
  const baseSha = input.branch
    ? (await ws.addWorktreeForBranch(project.checkoutPath, path, branch), await ws.headSha(path))
    : await ws.addWorktree(project.checkoutPath, path, branch, project.baseBranch);
  const scripts = await scriptsFor(project, ws, path);
  let setupFailure: string | undefined;
  if (scripts.setup) {
    const result = await ws.runScript(path, scripts.setup);
    if (!result.ok) setupFailure = result.output || "It exited with an error.";
  }
  // The start checkpoint: the worktree as the agent first sees it (seq 0).
  const startCheckpoint = await ws
    .checkpoint(path, checkpointRef(branch, 0))
    .catch(() => undefined);
  const { branch: _branch, ...create } = input;
  let created: { nativeId: string };
  try {
    created = await instance.createThread({
      ...create,
      cwd: path,
      message: `${projectPreamble(project, branch, scripts, setupFailure)}\n\n${input.message}`,
      model: input.model ?? project.defaultModel ?? undefined,
    });
  } catch (error) {
    await ws.removeWorktree(project.checkoutPath, path).catch(() => undefined);
    throw error;
  }
  await applyTitle(instance, created.nativeId, names?.title ?? null);
  const id = threadIdOf(instance.id, created.nativeId);
  const set = { projectId: project.id, branch, baseSha, worktree: path, cwd: path };
  await db
    .insert(codeThreads)
    .values({ id, instanceId: instance.id, nativeId: created.nativeId, ...set })
    .onConflictDoUpdate({ target: codeThreads.id, set });
  if (startCheckpoint) {
    await db
      .insert(codeCheckpoints)
      .values({ threadId: id, seq: 0, sha: startCheckpoint, headSha: baseSha, reason: "start" })
      .onConflictDoNothing();
  }
  await installThreadTrailer(ws, project, branch, path, id);
  return { nativeId: created.nativeId, branch, worktree: path };
}

/**
 * Every commit in the thread's worktree carries `Thread-Id: <thread id>`
 * (issue #297 §6), so `git log` leads back to the conversation. Installed as
 * soon as the harness has named the thread; a failure is logged, not fatal.
 */
async function installThreadTrailer(
  ws: Workspace,
  project: CodeProjectRow,
  branch: string,
  path: string,
  threadId: string,
): Promise<void> {
  const hooks = `${project.checkoutPath.replace(/\/checkout$/, "")}/hooks/${branch.replaceAll("/", "_")}`;
  await ws
    .installTrailer(path, hooks, `Thread-Id: ${threadId}`)
    .catch((error: unknown) =>
      logger.warn({ error, threadId }, "Code: could not install the Thread-Id trailer"),
    );
}

/**
 * A project thread was archived or unarchived (issue #297 §7.6): archive
 * runs the `archive` script and removes the worktree (the branch and the
 * transcript stay); unarchive recreates it from the branch and runs `setup`.
 */
export async function onProjectThreadArchived(threadId: string, archived: boolean): Promise<void> {
  const found = await projectThread(threadId);
  if (!found?.thread.branch) return;
  const { thread, project } = found;
  const ws = await codeGitHub().workspace(project);
  const path = thread.worktree ?? worktreePath(project, thread.branch!);
  if (archived) {
    if (!thread.worktree) return;
    const scripts = await scriptsFor(project, ws, path);
    if (scripts.archive) {
      const result = await ws.runScript(path, scripts.archive);
      if (!result.ok)
        logger.warn({ threadId, output: result.output }, "Code: archive script failed");
    }
    await ws.removeWorktree(project.checkoutPath, path);
    await db.update(codeThreads).set({ worktree: null }).where(eq(codeThreads.id, threadId));
    return;
  }
  if (thread.worktree && (await ws.exists(thread.worktree))) return;
  await ws.addWorktreeForBranch(project.checkoutPath, path, thread.branch!);
  await installThreadTrailer(ws, project, thread.branch!, path, threadId);
  const scripts = await scriptsFor(project, ws, path);
  if (scripts.setup) await ws.runScript(path, scripts.setup);
  await db.update(codeThreads).set({ worktree: path }).where(eq(codeThreads.id, threadId));
}

/** A project thread was deleted: its worktree goes; its branch stays. */
export async function onProjectThreadDeleted(threadId: string): Promise<void> {
  const found = await projectThread(threadId);
  if (!found?.thread.worktree) return;
  const ws = await codeGitHub().workspace(found.project);
  await ws.removeWorktree(found.project.checkoutPath, found.thread.worktree);
}
