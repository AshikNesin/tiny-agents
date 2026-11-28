import type {
  CodingAsset,
  CodingDirectoryListing,
  CodingFileMatch,
  CodingGitFile,
  CodingGitFileDiff,
  CodingGitLogResult,
  CodingGitStamp,
  CodingOp,
} from "@tiny-agents/claude-worker";
import type { HarnessInstance } from "../../contracts";

type WorkspaceOps = Required<
  Pick<
    HarnessInstance,
    | "findFiles"
    | "upload"
    | "asset"
    | "browse"
    | "validateCwd"
    | "diffs"
    | "diffFiles"
    | "fileDiff"
    | "changeStamp"
  >
>;

export function workspaceOps(op: <T>(body: CodingOp) => Promise<T>): WorkspaceOps {
  return {
    findFiles(dir, query, content) {
      return op<CodingFileMatch[]>({
        op: "find_files",
        dir,
        query,
        ...(content ? { content } : {}),
      });
    },

    async upload(file, filename) {
      const data = Buffer.from(await file.arrayBuffer()).toString("base64");
      const result = await op<{ ref: string }>({ op: "upload", filename, data });
      return { ref: result.ref };
    },

    async asset(ref) {
      const asset = await op<CodingAsset>({ op: "read_asset", ref });
      return new Response(Buffer.from(asset.data, "base64"), {
        headers: {
          "content-type": asset.mimeType,
          "content-disposition": `inline; filename="${asset.name.replace(/["\\\r\n]/g, "_")}"`,
          "cache-control": "private, max-age=3600",
        },
      });
    },

    browse(path) {
      return op<CodingDirectoryListing>({ op: "list_dir", ...(path ? { path } : {}) });
    },

    validateCwd(path) {
      return op<{ valid: boolean; error?: string }>({ op: "validate_cwd", path });
    },

    async diffs(cwd) {
      const result = await op<CodingGitLogResult>({ op: "git_log", cwd });
      return { diffs: result.diffs, gitRoot: result.gitRoot };
    },

    diffFiles(cwd, diffId) {
      return op<CodingGitFile[]>({ op: "git_files", cwd, diffId });
    },

    fileDiff(cwd, diffId, path) {
      return op<CodingGitFileDiff>({ op: "git_file", cwd, diffId, path });
    },

    async changeStamp(cwd) {
      return (await op<CodingGitStamp>({ op: "git_stamp", cwd })).stamp;
    },
  };
}
