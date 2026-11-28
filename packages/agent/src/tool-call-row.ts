import { approvalOf } from "./approvals";
import { credentialsOf } from "./credentials";
import { secretRedactor } from "./redact";
import { takeoverOf } from "@tiny-agents/sandbox/computer";
import { codingResultOf } from "./toolkits/coding";
import { questionsOf } from "./toolkits/questions";
import type { ChatToolCall, ChatToolStatus } from "./types";
import { record } from "@tiny-agents/std";

export type ToolCallRow = Omit<ChatToolCall, "id" | "name" | "args">;

export interface ToolOutcome {
  output: string;
  details?: unknown;
  isError?: boolean;
  durationMs?: number;
  diagnostics?: readonly { code?: string; message?: string }[];
}

export interface LiveTool {
  status: "pending" | "running" | "done";
  taskId?: number;
  output?: string;
  details?: unknown;
}

const MAX_TOOL_OUTPUT = 4000;

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
  const artifact = artifactOf(details);
  const { questions, answers } = questionsOf(details);
  const credentials = credentialsOf(details);
  const takeover = takeoverOf(approved?.result ?? details);
  const limit = limitOf(details);
  const coding = codingResultOf(approved?.result ?? details);
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
    ...(artifact && !outcome.isError ? { artifact } : {}),
    ...(questions ? { questions } : {}),
    ...(answers ? { answers } : {}),
    ...(credentials ? { credentials } : {}),
    ...(takeover ? { takeover } : {}),
    ...(limit ? { limit } : {}),
    ...coding,
  };
}

function limitOf(details: unknown): ChatToolCall["limit"] {
  const outer = record(details);
  if (record(outer?.budget)) return "budget";
  if (record(outer?.runCap)) return "runCap";
  return undefined;
}

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

function artifactOf(details: unknown): ChatToolCall["artifact"] {
  const artifact = record(record(details)?.artifact);
  if (
    !artifact ||
    typeof artifact.id !== "string" ||
    typeof artifact.slug !== "string" ||
    typeof artifact.title !== "string" ||
    typeof artifact.kind !== "string" ||
    typeof artifact.seq !== "number"
  ) {
    return undefined;
  }
  const { id, slug, title, kind, seq } = artifact;
  return { id, slug, title, kind, seq };
}

function credentialExpiry(details: unknown): number | undefined {
  const at = record(details)?.expiresAt;
  return typeof at === "number" ? at : undefined;
}
