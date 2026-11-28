import type { HarnessInstance } from "../../contracts";
import { badGateway, badRequest } from "../../server/errors";
import { encodePath, qs, shelleyFetch, type ShelleyDeps } from "./client";
import { assetPath } from "./normalize";
import {
  cwdCheckSchema,
  fileDiffSchema,
  uploadedSchema,
  worktreeSchema,
  type ShelleyJson,
  type ShelleyLists,
} from "./schemas";

type WorkspaceOps = Required<
  Pick<
    HarnessInstance,
    | "findFiles"
    | "upload"
    | "browse"
    | "validateCwd"
    | "repos"
    | "createWorktree"
    | "diffs"
    | "diffFiles"
    | "fileDiff"
    | "asset"
  >
>;

export function workspaceOps(
  json: ShelleyJson,
  lists: ShelleyLists,
  deps: ShelleyDeps,
): WorkspaceOps {
  return {
    async findFiles(dir, query, content) {
      const result = await json(
        lists.foundFiles,
        `/find-files${qs({
          dir,
          q: query || undefined,
          content,
          include_dirs: content ? undefined : "true",
        })}`,
      );
      const searched = (result.search_dir ?? dir).replace(/\/$/, "");
      const base = dir.replace(/\/$/, "");
      const prefix =
        searched === base
          ? ""
          : searched.startsWith(`${base}/`)
            ? `${searched.slice(base.length + 1)}/`
            : `${searched}/`;
      return (result.matches ?? []).map((m) => ({
        path: `${prefix}${m.path}`,
        ...(m.is_dir ? { isDir: true } : {}),
        ...(m.line !== undefined ? { line: m.line } : {}),
        ...(m.text !== undefined ? { text: m.text } : {}),
      }));
    },

    async upload(file, filename) {
      const result = await json(uploadedSchema, `/upload/raw${qs({ filename })}`, {
        method: "POST",
        body: file,
        headers: { "Content-Type": file.type || "application/octet-stream" },
        timeoutMs: 120_000,
      });
      if (!result.path) throw badGateway("Shelley did not return the uploaded path");
      return { ref: `file:${result.path}` };
    },

    async browse(path) {
      const listing = await json(lists.listing, `/list-directory${qs({ path })}`);
      return {
        path: listing.path,
        ...(listing.parent ? { parent: listing.parent } : {}),
        entries: (listing.entries ?? []).map((e) => ({ name: e.name, isDir: e.is_dir })),
        ...(listing.git_repo_root ? { repoRoot: listing.git_repo_root } : {}),
        ...(listing.git_head_subject ? { headSubject: listing.git_head_subject } : {}),
      };
    },

    async validateCwd(path) {
      return json(cwdCheckSchema, `/validate-cwd${qs({ path })}`);
    },

    async repos() {
      const result = await json(lists.repos, "/git/repos");
      return result.repos ?? [];
    },

    async createWorktree(cwd) {
      const created = await json(worktreeSchema, "/git/create-worktree", {
        method: "POST",
        json: { cwd },
      });
      const path = created.path ?? created.worktree ?? created.cwd;
      if (!path) throw badGateway("Shelley could not create a worktree here.");
      return { path };
    },

    async diffs(cwd) {
      const result = await json(lists.diffs, `/git/diffs${qs({ cwd })}`);
      return {
        diffs: result.diffs,
        gitRoot: result.gitRoot ?? cwd,
      };
    },

    async diffFiles(cwd, diffId) {
      return json(lists.gitFiles, `/git/diffs/${encodeURIComponent(diffId)}/files${qs({ cwd })}`);
    },

    async fileDiff(cwd, diffId, path) {
      return json(
        fileDiffSchema,
        `/git/file-diff/${encodeURIComponent(diffId)}/${encodePath(path)}${qs({ cwd })}`,
      );
    },

    async asset(ref) {
      const path = assetPath(ref);
      if (!path) throw badRequest("Unknown asset");
      return shelleyFetch(path, {}, deps);
    },
  };
}
