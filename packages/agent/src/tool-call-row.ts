/**
 * A tool call's row in the chat, from what its engine knows about it: a
 * finished call's result, or a running call's live slot. Both engines
 * project through here (pi in `transcript.ts`, the Claude plan as its calls
 * run), so a status, a card (approval, Question, credential request,
 * takeover) or a result field reads the same whichever engine ran the call.
 * Each Owner wait kind parses its own details; this only puts them together.
 */
import { approvalOf } from "./approvals";
import { credentialsOf } from "./credentials";
import { secretRedactor } from "./redact";
import { takeoverOf } from "./toolkits/computer-sessions";
import { questionsOf } from "./toolkits/questions";
import type { ChatToolCall, ChatToolStatus } from "./types";

/** A row's fields besides the call itself (its id, tool name and arguments). */
export type ToolCallRow = Omit<ChatToolCall, "id" | "name" | "args">;

/** A finished tool call, as either engine has it. */
export interface ToolOutcome {
  /** The result's text, as the model read it. */
  output: string;
  /** The result's details: the gate's card around the tool's own, or the tool's. */
  details?: unknown;
  isError?: boolean;
  /** The tool's clock, any owner wait included. Absent where the engine does not time calls. */
  durationMs?: number;
  /** Notes recorded with the result; `interrupted` and `aborted` codes set the status. */
  diagnostics?: readonly { code?: string; message?: string }[];
}

/** A running tool call (`pi.live` presents the current round's this way). */
export interface LiveTool {
  status: "pending" | "running" | "done";
  taskId?: number;
  output?: string;
  /** The newest details the call published: a pending card, while it waits on the owner. */
  details?: unknown;
}

/** Longest tool output kept for the user. */
const MAX_TOOL_OUTPUT = 4000;

/** The row of a finished call: its status, output, timing, answered card and result cards. */
export function finishedToolRow(outcome: ToolOutcome): ToolCallRow {
  const { details } = outcome;
  const diagnostics = outcome.diagnostics ?? [];
  const output =
    outcome.output ||
    diagnostics
      .map((d) => d.message ?? "")
      .filter(Boolean)
      .join("\n");
  const approved = approvalOf(details);
  const approval = approved?.state;
  const sources = sourcesOf(details);
  const code = codeOf(details);
  const { questions, answers } = questionsOf(details);
  const credentials = credentialsOf(details);
  const takeover = takeoverOf(approved?.result ?? details);
  // The tool's clock includes any wait for the owner's approval: report
  // the run and the wait apart.
  const waitedMs = approved?.waitedMs;
  return {
    status: finishedStatus(outcome, diagnostics),
    ...(output ? { output: clip(output) } : {}),
    ...(outcome.durationMs !== undefined
      ? { durationMs: Math.max(0, outcome.durationMs - (waitedMs ?? 0)) }
      : {}),
    ...(waitedMs ? { waitedMs } : {}),
    ...(approval === "approved" ||
    approval === "denied" ||
    approval === "auto" ||
    approval === "yolo" ||
    approval === "refused"
      ? { approval }
      : {}),
    ...(sources ? { sources } : {}),
    ...(code ? { code } : {}),
    ...(questions ? { questions } : {}),
    ...(answers ? { answers } : {}),
    ...(credentials ? { credentials } : {}),
    ...(takeover ? { takeover } : {}),
  };
}

/** The row of a running call: the card it waits on, if any, else running or pending. */
export function liveToolRow(slot: LiveTool): ToolCallRow {
  const approval = approvalOf(slot.details);
  const waiting = approval?.state === "pending";
  const asked = questionsOf(slot.details);
  const credentials = credentialsOf(slot.details);
  const takeover = takeoverOf(slot.details);
  const vault = approval?.vault;
  const expiresAt = approval?.expiresAt ?? credentialExpiry(slot.details);
  return {
    status: waiting
      ? "awaiting_approval"
      : asked.pending
        ? "awaiting_answer"
        : credentials?.status === "pending"
          ? "awaiting_credentials"
          : takeover?.status === "pending"
            ? "awaiting_takeover"
            : slot.status === "running"
              ? "running"
              : "pending",
    ...(slot.taskId !== undefined ? { taskId: slot.taskId } : {}),
    ...(slot.output ? { output: clip(slot.output) } : {}),
    ...(asked.pending ? { questions: asked.questions } : {}),
    ...(vault ? { vault } : {}),
    ...(credentials ? { credentials } : {}),
    ...(takeover ? { takeover } : {}),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
  };
}

function finishedStatus(
  outcome: ToolOutcome,
  diagnostics: readonly { code?: string }[],
): ChatToolStatus {
  const approval = approvalOf(outcome.details);
  if (approval?.state === "denied") return "denied";
  if (approval?.state === "expired" || credentialsOf(outcome.details)?.status === "expired") {
    return "expired";
  }
  const codes = diagnostics.map((d) => d.code ?? "");
  if (approval?.interrupted || codes.includes("interrupted")) return "interrupted";
  if (codes.includes("aborted")) return "aborted";
  return outcome.isError ? "error" : "done";
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Bounded, and scrubbed of vault values (a backstop: the gate already scrubbed results). */
function clip(raw: string): string {
  const text = secretRedactor.scrub(raw);
  return text.length > MAX_TOOL_OUTPUT ? `${text.slice(0, MAX_TOOL_OUTPUT)}…` : text;
}

function sourcesOf(details: unknown): ChatToolCall["sources"] {
  const sources = record(details)?.sources ?? record(record(details)?.result)?.sources;
  if (!Array.isArray(sources)) return undefined;
  const valid = sources.filter(
    (s): s is { url: string; title: string } =>
      typeof s?.url === "string" && typeof s?.title === "string",
  );
  return valid.length > 0 ? valid.map(({ url, title }) => ({ url, title })) : undefined;
}

/**
 * A hand-off's thread (issue #143, ADR 0011): the Code page card. Results
 * from before the harness layer carry `shelley: { conversationId, slug }`.
 */
function codeOf(details: unknown): ChatToolCall["code"] {
  const outer = record(details);
  const result = record(outer?.result);
  const code = record(outer?.code ?? result?.code);
  if (code && typeof code.threadId === "string" && typeof code.url === "string") {
    return {
      threadId: code.threadId,
      harness: typeof code.harness === "string" ? code.harness : "Shelley",
      title: typeof code.title === "string" ? code.title : null,
      cwd: typeof code.cwd === "string" ? code.cwd : null,
      url: code.url,
    };
  }
  const legacy = record(outer?.shelley ?? result?.shelley);
  if (!legacy || typeof legacy.conversationId !== "string" || typeof legacy.url !== "string")
    return undefined;
  return {
    threadId: `shelley:${legacy.conversationId}`,
    harness: "Shelley",
    title: typeof legacy.slug === "string" ? legacy.slug : null,
    cwd: typeof legacy.cwd === "string" ? legacy.cwd : null,
    url: legacy.url,
  };
}

/** A pending credential request's deadline rides its own details, like an approval's. */
function credentialExpiry(details: unknown): number | undefined {
  const at = record(details)?.expiresAt;
  return typeof at === "number" ? at : undefined;
}
