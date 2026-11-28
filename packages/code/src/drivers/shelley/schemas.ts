import { z } from "zod";
import type { GitDiff, GitFile, GitFileDiff } from "../../contracts";
import type { shelleyJson } from "./client";
import {
  detailSchemaOf,
  listOf,
  modelSchema,
  opt,
  rowSchema,
  subagentUsageSchemaOf,
  type ReportInvalid,
} from "./wire";

export const createdSchema = z.looseObject({ conversation_id: opt(z.string()) });

export const cwdCheckSchema = z.looseObject({ valid: z.boolean(), error: opt(z.string()) });

export const sentSchema = z.looseObject({ status: opt(z.string()) });

export const uploadedSchema = z.looseObject({ path: opt(z.string()) });

export const worktreeSchema = z.looseObject({
  path: opt(z.string()),
  worktree: opt(z.string()),
  cwd: opt(z.string()),
});

const gitDiffSchema: z.ZodType<GitDiff> = z.looseObject({
  id: z.string(),
  message: z.string(),
  author: z.string(),
  timestamp: z.string(),
  filesCount: z.number(),
  additions: z.number(),
  deletions: z.number(),
  refs: opt(z.array(z.string())),
});

const gitFileSchema: z.ZodType<GitFile> = z.looseObject({
  path: z.string(),
  status: z.enum(["added", "modified", "deleted"]),
  additions: z.number(),
  deletions: z.number(),
  isGenerated: z.boolean(),
  binary: opt(z.boolean()),
});

export const fileDiffSchema: z.ZodType<GitFileDiff> = z.looseObject({
  path: z.string(),
  oldContent: z.string(),
  newContent: z.string(),
  unshowable: opt(z.enum(["binary", "tooLarge"])),
});

export function listSchemas(report: ReportInvalid) {
  return {
    rows: listOf("a Shelley conversation", rowSchema, report),
    models: listOf("a Shelley model", modelSchema, report),
    jobs: listOf(
      "a Shelley background job",
      z.looseObject({ id: z.string(), command: opt(z.string()), started_at: opt(z.string()) }),
      report,
    ),
    detail: detailSchemaOf(report),
    subagentUsage: subagentUsageSchemaOf(report),
    skills: z.looseObject({
      skills: listOf(
        "a Shelley skill",
        z.looseObject({ name: z.string(), description: opt(z.string()) }),
        report,
      ),
    }),
    foundFiles: z.looseObject({
      search_dir: opt(z.string()),
      matches: listOf(
        "a Shelley file match",
        z.looseObject({
          path: z.string(),
          is_dir: opt(z.boolean()),
          line: opt(z.number()),
          text: opt(z.string()),
        }),
        report,
      ),
    }),
    listing: z.looseObject({
      path: z.string(),
      parent: opt(z.string()),
      entries: listOf(
        "a Shelley directory entry",
        z.looseObject({ name: z.string(), is_dir: z.boolean() }),
        report,
      ),
      git_repo_root: opt(z.string()),
      git_head_subject: opt(z.string()),
    }),
    repos: z.looseObject({
      repos: listOf(
        "a Shelley repository",
        z.looseObject({ path: z.string(), name: opt(z.string()) }),
        report,
      ),
    }),
    diffs: z.looseObject({
      diffs: listOf("a Shelley diff", gitDiffSchema, report),
      gitRoot: opt(z.string()),
    }),
    gitFiles: listOf("a Shelley changed file", gitFileSchema, report),
  };
}

export type ShelleyLists = ReturnType<typeof listSchemas>;

export type ShelleyJson = <T>(
  schema: z.ZodType<T>,
  path: string,
  init?: Parameters<typeof shelleyJson>[1],
) => Promise<T>;
