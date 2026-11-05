/**
 * Claude Code messages → transcript rows. One function for both sources:
 * live SDK messages (`SDKMessage`, relayed by the worker) and history
 * (`getSessionMessages` entries), which share `type`, `uuid`,
 * `parent_tool_use_id` and an Anthropic API `message`.
 *
 * Wire facts (Agent SDK 0.3.x `sdk.d.ts`, `sdk-tools.d.ts`):
 * - Assistant `message.content` holds `text`, `thinking`, `tool_use` blocks;
 *   tool results come back in `user` messages as `tool_result` blocks, and
 *   live ones also carry the tool's structured output in `tool_use_result`
 *   (`structuredPatch` for Edit/Write).
 * - Subagent traffic has `parent_tool_use_id` set; it is not shown here.
 * - A turn ends with a `result` (live only). The worker adds `turn_cost_usd`,
 *   `after_uuid`, `usage_limit` and `interrupted`; the driver keeps a compact
 *   copy in the thread index so history shows the same `turn` rows.
 * - API errors are assistant messages with `error` (live) and/or the model
 *   `<synthetic>` (transcript).
 *
 * Ids are stable across both sources: `<uuid>:<block index>` for text,
 * thinking and user rows, the `tool_use_id` for tools, the approval id for
 * requests, the result's uuid for turns.
 */
import { ATTACHMENTS_HEADER } from "@tiny-agents/claude-worker";
import type {
  ApprovalRequest,
  AssetRef,
  ToolItem,
  ToolKind,
  TranscriptItem,
} from "../../contracts";
import { excerpt, firstLine, record } from "../../server/items";

/** A live SDK message or a history entry. */
export interface ClaudeEntry {
  type: string;
  subtype?: string;
  uuid?: string;
  message?: unknown;
  parent_tool_use_id?: string | null;
  [key: string]: unknown;
}

/** An approval the worker relayed, with where it stands. */
export interface ApprovalRecord {
  approvalId: string;
  toolUseId?: string;
  toolName: string;
  input: unknown;
  reason?: string;
  title?: string;
  status: "open" | "allowed" | "denied" | "answered" | "expired";
}

export interface NormalizeContext {
  requests?: readonly ApprovalRecord[];
}

const MAX_OUTPUT = 20_000;
const COMPACT_SUMMARY = /^This session is being continued from a previous conversation/;
const INTERRUPTED = /^\[Request interrupted by user[^\]]*\]$/;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg)$/i;

export function toolKindOf(name: string): ToolKind {
  if (name.startsWith("mcp__")) return "mcp";
  switch (name) {
    case "Bash":
    case "BashOutput":
    case "KillShell":
      return "bash";
    case "Edit":
    case "Write":
    case "MultiEdit":
    case "NotebookEdit":
      return "edit";
    case "Read":
      return "read";
    case "Grep":
    case "Glob":
      return "search";
    case "WebFetch":
    case "WebSearch":
      return "web";
    case "TodoWrite":
      return "todo";
    case "Task":
    case "Agent":
      return "subagent";
    default:
      return "other";
  }
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function toolSummary(name: string, input: unknown): string {
  const args = record(input) ?? {};
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = str(args[key]);
      if (value) return value;
    }
    return undefined;
  };
  if (name.startsWith("mcp__")) {
    const [, server = "", ...tool] = name.split("__");
    return `${server}: ${tool.join("__")}`;
  }
  switch (name) {
    case "Bash":
      return firstLine(pick("command") ?? "");
    case "Edit":
    case "Write":
    case "MultiEdit":
    case "Read":
      return pick("file_path") ?? "";
    case "NotebookEdit":
      return pick("notebook_path") ?? "";
    case "Grep":
    case "Glob": {
      const pattern = pick("pattern") ?? "";
      const where = pick("path", "glob");
      return firstLine(where ? `${pattern} in ${where}` : pattern);
    }
    case "WebFetch":
      return pick("url") ?? "";
    case "WebSearch":
      return firstLine(pick("query") ?? "");
    case "TodoWrite": {
      const todos = Array.isArray(args.todos) ? args.todos : [];
      const active = todos.map(record).find((todo) => todo?.status === "in_progress");
      return firstLine(str(active?.activeForm) ?? `${todos.length} todos`);
    }
    case "Task":
    case "Agent":
      return firstLine(pick("description", "subagent_type", "name") ?? "Subagent");
    case "AskUserQuestion": {
      const questions = Array.isArray(args.questions) ? args.questions : [];
      return firstLine(str(record(questions[0])?.question) ?? "Question");
    }
    case "ExitPlanMode":
      return "Plan ready for review";
    default: {
      const first = Object.values(args).find((value) => typeof value === "string");
      return firstLine(typeof first === "string" ? first : "");
    }
  }
}

function prefixLines(text: string, prefix: string): string {
  if (!text) return "";
  const lines = text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
  return lines.map((line) => `${prefix}${line}`).join("\n");
}

function lineCount(text: string): number {
  if (!text) return 0;
  return (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n").length;
}

function hunk(oldText: string, newText: string): string {
  const removed = prefixLines(oldText, "-");
  const added = prefixLines(newText, "+");
  const oldCount = lineCount(oldText);
  const newCount = lineCount(newText);
  const header = `@@ -${oldCount ? 1 : 0},${oldCount} +${newCount ? 1 : 0},${newCount} @@`;
  return [header, removed, added].filter(Boolean).join("\n");
}

function unified(path: string, body: string, created = false): string {
  const label = (side: "a" | "b") => (path.startsWith("/") ? path : `${side}/${path}`);
  return `--- ${created ? "/dev/null" : label("a")}\n+++ ${label("b")}\n${body}`;
}

/** A unified diff from the tool's input (works for history too). */
export function diffFromInput(name: string, input: unknown): ToolItem["diff"] {
  const args = record(input);
  if (!args) return undefined;
  const path = str(args.file_path) ?? str(args.notebook_path);
  if (!path) return undefined;
  if (name === "Edit") {
    return {
      path,
      diff: unified(path, hunk(str(args.old_string) ?? "", str(args.new_string) ?? "")),
    };
  }
  if (name === "MultiEdit" && Array.isArray(args.edits)) {
    const body = args.edits
      .map(record)
      .map((edit) => hunk(str(edit?.old_string) ?? "", str(edit?.new_string) ?? ""))
      .join("\n");
    return { path, diff: unified(path, body) };
  }
  if (name === "Write") {
    return { path, diff: unified(path, hunk("", str(args.content) ?? ""), true) };
  }
  if (name === "NotebookEdit") {
    return { path, diff: unified(path, hunk("", str(args.new_source) ?? "")) };
  }
  return undefined;
}

/** A unified diff from Edit/Write output (`structuredPatch`), when the SDK sent it. */
export function diffFromPatch(result: unknown, fallbackPath?: string): ToolItem["diff"] {
  const output = record(result);
  const patch = output?.structuredPatch;
  if (!Array.isArray(patch) || patch.length === 0) return undefined;
  const path = str(output?.filePath) ?? fallbackPath;
  if (!path) return undefined;
  const body = patch
    .map(record)
    .filter((h): h is Record<string, unknown> => !!h)
    .map((h) => {
      const lines = Array.isArray(h.lines) ? h.lines.filter((l) => typeof l === "string") : [];
      return `@@ -${Number(h.oldStart ?? 0)},${Number(h.oldLines ?? 0)} +${Number(
        h.newStart ?? 0,
      )},${Number(h.newLines ?? 0)} @@\n${lines.join("\n")}`;
    })
    .join("\n");
  const created = output?.type === "create" || output?.originalFile === null;
  return { path, diff: unified(path, body, created) };
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map(record)
    .map((block) => (block?.type === "text" ? (str(block.text) ?? "") : ""))
    .filter(Boolean)
    .join("\n");
}

function cap(text: string): string {
  return text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT - 1)}…` : text;
}

/** Split the worker's attachment block back off a prompt. */
export function splitAttachments(text: string): { text: string; attachments: AssetRef[] } {
  const at = text.lastIndexOf(ATTACHMENTS_HEADER);
  if (at < 0) return { text, attachments: [] };
  const tail = text.slice(at + ATTACHMENTS_HEADER.length).split("\n");
  const paths = tail.map((line) => line.trim()).filter((line) => line.startsWith("- "));
  if (paths.length === 0) return { text, attachments: [] };
  const attachments = paths.map((line): AssetRef => {
    const path = line.slice(2).trim();
    return { ref: path, name: path.slice(path.lastIndexOf("/") + 1), image: IMAGE_EXT.test(path) };
  });
  return { text: text.slice(0, at).trimEnd(), attachments };
}

/** `Claude AI usage limit reached|1700000000` and friends. */
export function usageLimitOf(text: string, error?: unknown): { resetsAt?: string } | undefined {
  const limitError = error === "rate_limit" || error === "billing_error";
  const limitText =
    /(usage limit|limit reached|limit will reset|hit your (usage )?limit|out of (extra )?usage)/i;
  if (!limitError && !limitText.test(text)) {
    return undefined;
  }
  const epoch = /\|(\d{9,13})\b/.exec(text)?.[1];
  if (!epoch) return {};
  const value = Number(epoch);
  return { resetsAt: new Date(value < 1e12 ? value * 1000 : value).toISOString() };
}

function errorCodeOf(text: string, error?: unknown): "usage_limit" | "auth" | "harness" {
  if (usageLimitOf(text, error)) return "usage_limit";
  if (
    error === "authentication_failed" ||
    error === "oauth_org_not_allowed" ||
    /authenticat|log ?in|oauth|credential/i.test(text)
  ) {
    return "auth";
  }
  return "harness";
}

function commandText(text: string): string | undefined {
  const name = /<command-name>([\s\S]*?)<\/command-name>/.exec(text)?.[1]?.trim();
  if (!name) return undefined;
  const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1]?.trim();
  return args ? `${name} ${args}` : name;
}

interface TurnFlags {
  usageLimit: boolean;
  interrupted: boolean;
  error: boolean;
}

export function normalizeEntries(
  entries: readonly ClaudeEntry[],
  context: NormalizeContext = {},
): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const tools = new Map<string, ToolItem>();
  const openTools: ToolItem[] = [];
  let flags: TurnFlags = { usageLimit: false, interrupted: false, error: false };
  const seen = new Set<string>();

  const push = (item: TranscriptItem) => {
    if (seen.has(item.id)) {
      const index = items.findIndex((existing) => existing.id === item.id);
      if (index >= 0) items[index] = item;
      return;
    }
    seen.add(item.id);
    items.push(item);
  };

  for (const entry of entries) {
    if (entry.parent_tool_use_id) continue;
    const uuid = entry.uuid ?? "";
    const message = record(entry.message);
    if (entry.type === "user") {
      if (entry.isSynthetic === true || entry.isMeta === true) continue;
      const content = message?.content;
      const blocks: unknown[] =
        typeof content === "string"
          ? [{ type: "text", text: content }]
          : Array.isArray(content)
            ? content
            : [];
      blocks.forEach((raw, index) => {
        const block = record(raw);
        if (!block) return;
        if (block.type === "tool_result") {
          const tool = tools.get(str(block.tool_use_id) ?? "");
          if (!tool) return;
          const text = resultText(block.content);
          tool.output = cap(text);
          tool.live = false;
          if (tool.status !== "denied") tool.status = block.is_error === true ? "error" : "done";
          const patch = diffFromPatch(entry.tool_use_result, tool.diff?.path);
          if (patch) tool.diff = patch;
          const at = openTools.indexOf(tool);
          if (at >= 0) openTools.splice(at, 1);
          return;
        }
        if (block.type !== "text") return;
        const text = str(block.text) ?? "";
        const id = `${uuid}:${index}`;
        const trimmed = text.trim();
        if (!trimmed) return;
        if (COMPACT_SUMMARY.test(trimmed) || entry.isCompactSummary === true) {
          push({ kind: "notice", id, level: "info", text: "Earlier conversation was compacted." });
          return;
        }
        if (INTERRUPTED.test(trimmed)) {
          if (!flags.interrupted) {
            flags.interrupted = true;
            push({ kind: "notice", id, level: "info", text: "Stopped." });
          }
          return;
        }
        if (
          trimmed.startsWith("<local-command-caveat>") ||
          trimmed.startsWith("<system-reminder>")
        ) {
          return;
        }
        const stdout = /<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/.exec(trimmed);
        const stderr = /<local-command-stderr>([\s\S]*?)<\/local-command-stderr>/.exec(trimmed);
        if (stdout || stderr) {
          const body = (stdout?.[1] ?? stderr?.[1] ?? "").trim();
          if (body) {
            push({ kind: "notice", id, level: stderr ? "warning" : "info", text: excerpt(body) });
          }
          return;
        }
        const command = commandText(trimmed);
        const split = splitAttachments(command ?? text);
        push({
          kind: "user",
          id,
          text: split.text,
          attachments: split.attachments,
          ...(uuid ? { forkAt: uuid } : {}),
        });
      });
      continue;
    }

    if (entry.type === "assistant") {
      const content = Array.isArray(message?.content) ? message.content : [];
      const synthetic = entry.error !== undefined || message?.model === "<synthetic>";
      content.forEach((raw, index) => {
        const block = record(raw);
        if (!block) return;
        const id = `${uuid}:${index}`;
        if (block.type === "text") {
          const text = str(block.text) ?? "";
          if (!text.trim()) return;
          if (synthetic) {
            if (text.trim() === "No response requested.") return;
            const code = errorCodeOf(text, entry.error);
            const limit = code === "usage_limit" ? usageLimitOf(text, entry.error) : undefined;
            if (code === "usage_limit") flags.usageLimit = true;
            flags.error = true;
            push({
              kind: "notice",
              id,
              level: "error",
              text: excerpt(text.replace(/\|\d{9,13}\b/, "")),
              code,
              ...(limit?.resetsAt ? { resetsAt: limit.resetsAt } : {}),
            });
            return;
          }
          push({ kind: "assistant", id, text });
          return;
        }
        if (block.type === "thinking") {
          const text = str(block.thinking) ?? "";
          if (text.trim()) push({ kind: "thinking", id, text });
          return;
        }
        if (block.type === "tool_use" || block.type === "server_tool_use") {
          const toolId = str(block.id) ?? id;
          const name = str(block.name) ?? "tool";
          const input = block.input ?? {};
          const existing = tools.get(toolId);
          const tool: ToolItem = existing ?? {
            kind: "tool",
            id: toolId,
            tool: toolKindOf(name),
            name,
            input,
            summary: toolSummary(name, input),
            status: "running",
            live: true,
            images: [],
          };
          tool.input = input;
          tool.summary = toolSummary(name, input);
          const diff = diffFromInput(name, input);
          if (diff && !tool.diff) tool.diff = diff;
          if (record(input)?.run_in_background === true) tool.background = true;
          if (!existing) {
            tools.set(toolId, tool);
            openTools.push(tool);
            push(tool);
          }
        }
      });
      continue;
    }

    if (entry.type === "system") {
      const subtype = entry.subtype ?? str(message?.subtype);
      if (subtype === "compact_boundary") {
        const meta = record(entry.compact_metadata) ?? record(entry.compactMetadata);
        const before = typeof meta?.pre_tokens === "number" ? meta.pre_tokens : undefined;
        push({
          kind: "notice",
          id: uuid,
          level: "info",
          text: before
            ? `Context compacted (${before.toLocaleString("en-US")} tokens before).`
            : "Context compacted.",
        });
      } else if (subtype === "tiny_notice") {
        const level = entry.level === "warning" || entry.level === "info" ? entry.level : "error";
        push({ kind: "notice", id: uuid, level, text: excerpt(str(entry.content) ?? "") });
      }
      continue;
    }

    if (entry.type === "result") {
      for (const tool of openTools.splice(0)) {
        if (tool.status === "running") {
          tool.status = "error";
          tool.live = false;
          tool.output = tool.output || "Stopped before it finished.";
        }
      }
      const limit = record(entry.usage_limit);
      const interrupted = entry.interrupted === true;
      const errors = Array.isArray(entry.errors)
        ? entry.errors.filter((e): e is string => typeof e === "string")
        : [];
      if (limit) {
        if (!flags.usageLimit) {
          const resetsAt = str(limit.resetsAt);
          push({
            kind: "notice",
            id: `${uuid}:limit`,
            level: "error",
            code: "usage_limit",
            text:
              "Claude plan limit reached: this turn stopped and will not be retried, " +
              "so nothing is charged to usage credits.",
            ...(resetsAt ? { resetsAt } : {}),
          });
        }
      } else if (interrupted) {
        if (!flags.interrupted)
          push({ kind: "notice", id: `${uuid}:stop`, level: "info", text: "Stopped." });
      } else if (entry.is_error === true && !flags.error) {
        const text =
          errors.join("\n") || str(entry.result) || "Claude Code ended the turn with an error.";
        push({
          kind: "notice",
          id: `${uuid}:error`,
          level: "error",
          text: excerpt(text),
          code: errorCodeOf(text),
          retryable: false,
        });
      }
      const duration = typeof entry.duration_ms === "number" ? entry.duration_ms : undefined;
      const cost =
        typeof entry.turn_cost_usd === "number"
          ? entry.turn_cost_usd
          : typeof entry.total_cost_usd === "number"
            ? entry.total_cost_usd
            : undefined;
      push({
        kind: "turn",
        id: uuid,
        ...(duration !== undefined ? { durationMs: duration } : {}),
        ...(cost !== undefined ? { costUsd: cost } : {}),
      });
      flags = { usageLimit: false, interrupted: false, error: false };
    }
  }

  for (const approval of context.requests ?? []) {
    const row = requestRow(approval);
    const tool = approval.toolUseId ? tools.get(approval.toolUseId) : undefined;
    if (tool && approval.status === "denied") {
      tool.status = "denied";
      tool.live = false;
    }
    const at = tool ? items.indexOf(tool) : -1;
    if (at >= 0) items.splice(at + 1, 0, row);
    else items.push(row);
  }
  return items;
}

export function approvalRequestOf(approval: ApprovalRecord): ApprovalRequest {
  const input = record(approval.input) ?? {};
  if (approval.toolName === "AskUserQuestion") {
    const questions = Array.isArray(input.questions) ? input.questions : [];
    return {
      kind: "question",
      questions: questions
        .map(record)
        .filter((q): q is Record<string, unknown> => !!q)
        .map((q) => ({
          question: str(q.question) ?? "",
          ...(str(q.header) ? { header: str(q.header) } : {}),
          ...(typeof q.multiSelect === "boolean" ? { multiSelect: q.multiSelect } : {}),
          options: (Array.isArray(q.options) ? q.options : [])
            .map(record)
            .filter((o): o is Record<string, unknown> => !!o)
            .map((o) => ({
              label: str(o.label) ?? "",
              ...(str(o.description) ? { description: str(o.description) } : {}),
            })),
        })),
    };
  }
  const reason = approval.title ?? approval.reason;
  return {
    kind: "tool",
    tool: toolKindOf(approval.toolName),
    name: approval.toolName,
    input: approval.input,
    summary: toolSummary(approval.toolName, approval.input),
    ...(reason ? { reason } : {}),
  };
}

function requestRow(approval: ApprovalRecord): TranscriptItem {
  return {
    kind: "request",
    id: approval.approvalId,
    request: approvalRequestOf(approval),
    status: approval.status,
  };
}

/** The last assistant answer (or the last error) of a transcript. */
export function lastAnswer(items: readonly TranscriptItem[]): { text: string; failed: boolean } {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    if (item.kind === "assistant") return { text: item.text, failed: false };
    if (item.kind === "notice" && item.level === "error") return { text: item.text, failed: true };
    if (item.kind === "user") break;
  }
  return { text: "", failed: false };
}
