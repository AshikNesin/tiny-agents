import { posix } from "node:path";
import type { Context } from "@earendil-works/chord/context";
import {
  section,
  type ToolExecutionApi,
  type ToolExecutionResult,
} from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { shQuote, type SandboxConnection } from "@tiny-agents/sandbox";
import type { Capability, CapabilitySelection, ToolPermission } from "../capabilities";
import { defineToolkit, tool } from "../toolkit";
import { unifiedDiff } from "./coding-diff";
import {
  errorText,
  execCapped,
  fail,
  OUTPUT_CHARS,
  sandboxOrThrow,
  utf8TextOf,
} from "./sandbox-io";

export const CODING_TOOLKIT = "coding";

export type CodingPermissionMode = "default" | "acceptEdits" | "plan" | "bypassPermissions";

type ChangingTool = "write" | "edit" | "bash";

const CHANGING_TOOLS: readonly ChangingTool[] = ["write", "edit", "bash"];

const MODE_PERMISSIONS: Record<CodingPermissionMode, Record<ChangingTool, ToolPermission>> = {
  default: { write: "ask", edit: "ask", bash: "ask" },
  acceptEdits: { write: "allow", edit: "allow", bash: "ask" },
  plan: { write: "off", edit: "off", bash: "off" },
  bypassPermissions: { write: "allow", edit: "allow", bash: "allow" },
};

export function codingSelection(mode: CodingPermissionMode): CapabilitySelection {
  return {
    enabled: [CODING_TOOLKIT, "questions"],
    permissions: {
      read: "allow",
      find: "allow",
      ...MODE_PERMISSIONS[mode],
      message_owner: "off",
    },
  };
}

export interface CodingResult {
  exitCode?: number;
  diff?: { path: string; diff: string };
}

export function codingResultOf(details: unknown): CodingResult {
  if (!details || typeof details !== "object") return {};
  const { exitCode, diff } = details as { exitCode?: unknown; diff?: unknown };
  const patch = diff && typeof diff === "object" ? (diff as Record<string, unknown>) : undefined;
  return {
    ...(typeof exitCode === "number" ? { exitCode } : {}),
    ...(typeof patch?.path === "string" && typeof patch.diff === "string"
      ? { diff: { path: patch.path, diff: patch.diff } }
      : {}),
  };
}

export interface CodingToolkitOptions {
  connection?: SandboxConnection;
  defaultTimeoutSecs?: number;
}

const FILE_BYTES = 1_000_000;
const READ_LINES = 2000;
const FIND_LIMIT = 200;
const NO_CWD = "This thread has no working directory.";

const said = (text: string): ToolExecutionResult => ({ output: [{ type: "text", text }] });

const clipped = (text: string) =>
  text.length > OUTPUT_CHARS ? `${text.slice(0, OUTPUT_CHARS)}\n… (truncated)` : text;

function windowOf(text: string, offset: number, limit: number, cut: boolean): string {
  const lines = text.split("\n");
  if (text.endsWith("\n")) lines.pop();
  const total = lines.length;
  if (offset === 1 && total <= limit && text.length <= OUTPUT_CHARS && !cut) return text;
  if (offset > total) return `[The file has ${total} lines.]`;
  const taken: string[] = [];
  let chars = 0;
  for (const line of lines.slice(offset - 1, offset - 1 + limit)) {
    if (taken.length > 0 && chars + line.length > OUTPUT_CHARS) break;
    taken.push(line.length > OUTPUT_CHARS ? `${line.slice(0, OUTPUT_CHARS)}…` : line);
    chars += line.length + 1;
  }
  const last = offset + taken.length - 1;
  const body = taken.join("\n");
  if (last < total) {
    return `${body}\n\n[Lines ${offset}-${last} of ${total}. Pass offset ${last + 1} to read on.]`;
  }
  if (cut) return `${body}\n\n[Lines ${offset}-${last}. The file is over 1 MB: read on with bash.]`;
  return body;
}

export function createCodingToolkit(options: CodingToolkitOptions = {}): Capability {
  const sandbox = () => sandboxOrThrow(options.connection);

  const inCwd = async (
    api: ToolExecutionApi,
    context: Context,
    run: (cwd: string) => Promise<ToolExecutionResult>,
  ): Promise<ToolExecutionResult> => {
    const { cwd } = await api.agent(context);
    if (!cwd) return fail(NO_CWD);
    try {
      return await run(cwd);
    } catch (error) {
      return fail(errorText(error));
    }
  };

  const read = tool({
    name: "read",
    label: "Read a file",
    askLabel: "read a file",
    summary: "Read a file in the thread's working directory",
    policy: { readOnly: true },
    description:
      "Read a text file. A relative path is under the working directory. Long files come in " +
      `windows of ${READ_LINES} lines: pass offset (first line, from 1) and limit to read on.`,
    parameters: Type.Object({
      path: Type.String({ minLength: 1, maxLength: 4096 }),
      offset: Type.Optional(Type.Integer({ minimum: 1 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: READ_LINES })),
    }),
    replay: "safe",
    execute: (args, api, context) =>
      inCwd(api, context, async (cwd) => {
        const file = await sandbox().readFile(posix.resolve(cwd, args.path), {
          maxBytes: FILE_BYTES,
        });
        const text = utf8TextOf(file);
        if (text === undefined) return said(`[binary file, ${file.size} bytes]`);
        return said(windowOf(text, args.offset ?? 1, args.limit ?? READ_LINES, file.truncated));
      }),
  });

  const write = tool({
    name: "write",
    label: "Wrote a file",
    askLabel: "write a file",
    summary: "Create or overwrite a file in the thread's working directory",
    description:
      "Create or overwrite a file with UTF-8 content, making its folders. A relative path is " +
      "under the working directory. To change part of a file, use edit.",
    parameters: Type.Object({
      path: Type.String({ minLength: 1, maxLength: 4096 }),
      content: Type.String({ maxLength: 500_000 }),
    }),
    replay: "unsafe",
    execute: (args, api, context) =>
      inCwd(api, context, async (cwd) => {
        const path = posix.resolve(cwd, args.path);
        const folder = await execCapped(sandbox(), `mkdir -p -- ${shQuote(posix.dirname(path))}`, {
          timeoutMs: 30_000,
        });
        if (folder.exitCode !== 0) {
          return fail(folder.output || `Could not make the folder for ${args.path}.`);
        }
        await sandbox().writeFile(path, args.content);
        return said(`Wrote ${args.path} (${Buffer.byteLength(args.content)} bytes)`);
      }),
  });

  const edit = tool({
    name: "edit",
    label: "Edited a file",
    askLabel: "edit a file",
    summary: "Replace exact text in a file in the thread's working directory",
    description:
      "Replace old_text with new_text in a file. old_text must match the file exactly, " +
      "whitespace included, and only once unless replace_all is true. Returns the diff.",
    parameters: Type.Object({
      path: Type.String({ minLength: 1, maxLength: 4096 }),
      old_text: Type.String({ minLength: 1, maxLength: 200_000 }),
      new_text: Type.String({ maxLength: 200_000 }),
      replace_all: Type.Optional(Type.Boolean()),
    }),
    replay: "unsafe",
    execute: (args, api, context) =>
      inCwd(api, context, async (cwd) => {
        const path = posix.resolve(cwd, args.path);
        const file = await sandbox().readFile(path, { maxBytes: FILE_BYTES });
        const before = file.truncated ? undefined : utf8TextOf(file);
        if (before === undefined) {
          return fail(`${args.path} is binary or over 1 MB. Change it with bash instead.`);
        }
        const pieces = before.split(args.old_text);
        const matches = pieces.length - 1;
        if (matches === 0) {
          return fail(`old_text was not found in ${args.path}. Nothing was written.`);
        }
        if (matches > 1 && !args.replace_all) {
          return fail(
            `old_text matches ${matches} places in ${args.path}. Add surrounding lines to pick one, or pass replace_all. Nothing was written.`,
          );
        }
        const after = pieces.join(args.new_text);
        if (after === before) return fail("new_text is the same as old_text. Nothing was written.");
        await sandbox().writeFile(path, after);
        const diff = clipped(unifiedDiff(args.path, before, after));
        return { ...said(diff), details: { diff: { path: args.path, diff } } };
      }),
  });

  const bash = tool({
    name: "bash",
    label: "Ran a command",
    askLabel: "run a command",
    summary: "Run a shell command in the thread's working directory",
    description:
      "Run a shell command in the working directory on the sandbox; returns stdout, stderr and " +
      "the exit code. Chain steps with && or ;.",
    parameters: Type.Object({
      command: Type.String({ minLength: 1, maxLength: 20_000 }),
      timeout_secs: Type.Optional(Type.Integer({ minimum: 1, maximum: 600 })),
    }),
    replay: "unsafe",
    execute: (args, api, context) =>
      inCwd(api, context, async (cwd) => {
        const timeoutSecs = args.timeout_secs ?? options.defaultTimeoutSecs ?? 120;
        const result = await execCapped(
          sandbox(),
          `cd ${shQuote(cwd)} && eval ${shQuote(args.command)}`,
          { timeoutMs: timeoutSecs * 1000 },
        );
        const details = { exitCode: result.exitCode };
        if (result.exitCode !== 0) {
          return {
            ...said(`exit ${result.exitCode}\n${result.output}`),
            isError: true,
            details,
          };
        }
        return { ...said(result.output), details };
      }),
  });

  const find = tool({
    name: "find",
    label: "Looked for files",
    askLabel: "look for files",
    summary: "Find files by name in the thread's working directory",
    policy: { readOnly: true },
    description:
      "List the files under the working directory whose path contains the query, ignoring " +
      "case. An empty query lists every file. Search file contents with bash (rg).",
    parameters: Type.Object({
      query: Type.String({ maxLength: 500 }),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
    }),
    replay: "safe",
    execute: (args, api, context) =>
      inCwd(api, context, async (cwd) => {
        const names =
          "if command -v rg >/dev/null 2>&1; then rg --files; " +
          "else find . -type f -not -path '*/.git/*' -not -path '*/node_modules/*' | sed 's|^\\./||'; fi";
        const result = await execCapped(
          sandbox(),
          `cd ${shQuote(cwd)} && ${names} | grep -i -F -- ${shQuote(args.query)} | head -n ${args.limit ?? FIND_LIMIT}`,
          { timeoutMs: 60_000 },
        );
        if (result.exitCode !== 0) return fail(result.output || `exit ${result.exitCode}`);
        return said(result.output || `No file name contains "${args.query}".`);
      }),
  });

  const prompt = section("coding", (input) => {
    const { cwd, tools } = input.agent;
    if (!cwd) return undefined;
    const offered = new Set(tools.map((offer) => offer.name));
    return [
      `You are a coding agent working in ${cwd} on the owner's sandbox. Paths you give read, write, edit and find resolve against it, and bash starts there.`,
      "Read a file before you change it, make the smallest change that does the job, and say what you changed and how you checked it.",
      ...(CHANGING_TOOLS.some((name) => offered.has(name))
        ? []
        : [
            "Plan mode: do not change files. Read what you need, then lay out the steps you would take.",
          ]),
    ].join("\n");
  });

  return defineToolkit({
    id: CODING_TOOLKIT,
    name: "Coding",
    description: "Reads, edits and runs code in a Code thread's working directory on the sandbox",
    auto: true,
    tools: [read, write, edit, bash, find],
    sections: [prompt],
    setupHint: options.connection
      ? undefined
      : "Set SANDBOX_HOST to give the coding agent a sandbox.",
  });
}
