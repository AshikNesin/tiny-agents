import type { ChatToolCall } from "./chat-types";
import { viewOf } from "./tool-call-view";

export type ToolLabels = Record<string, string>;

export interface ToolLabelCatalog {
  done: ToolLabels;
  ask: ToolLabels;
}

export const NO_TOOL_LABELS: ToolLabelCatalog = { done: {}, ask: {} };

export function toolLabelCatalog(
  capabilities: { tools: { name: string; label: string; askLabel?: string }[] }[],
): ToolLabelCatalog {
  const tools = capabilities.flatMap((capability) => capability.tools);
  return {
    done: Object.fromEntries(tools.map((tool) => [tool.name, tool.label])),
    ask: Object.fromEntries(
      tools.flatMap((tool) => (tool.askLabel ? [[tool.name, tool.askLabel]] : [])),
    ),
  };
}

export function toolLabel(labels: ToolLabelCatalog, name: string): string {
  if (labels.done[name]) return labels.done[name];
  const via = name.match(/^mcp__([a-z0-9-]+)__(.+)$/);
  if (via) {
    const pretty = via[2].replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    return `${pretty} via ${via[1]}`;
  }
  return name.replace(/_/g, " ");
}

export function toolAskLabel(labels: ToolLabelCatalog, name: string): string {
  return labels.ask[name] ?? `use ${toolLabel(labels, name)}`;
}

const SUMMARY_LENGTH = 60;

export function argSummary(call: ChatToolCall): string {
  const args = call.args ?? {};
  for (const key of ["title", "query", "url", "name", "id", "to", "text"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim().slice(0, SUMMARY_LENGTH);
    }
  }
  const first = Object.values(args)[0];
  return typeof first === "string" ? first.slice(0, SUMMARY_LENGTH) : "";
}

export function stepTitle(call: ChatToolCall, labels: ToolLabelCatalog): string {
  const summary = argSummary(call);
  if (call.name === "load_skill") return `Using skill ${summary}`;
  return `${toolLabel(labels, call.name)}${summary ? ` “${summary}”` : ""}`;
}

const PAYLOAD_FOLD = 120;

export function approvalPayload(call: ChatToolCall): string {
  const args = call.args ?? {};
  for (const key of ["instructions", "append"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return argSummary(call);
}

interface ApprovalFact {
  label: string;
  value: string;
}

function newBotFacts(args: Record<string, unknown>): ApprovalFact[] {
  const text = (key: string) => {
    const value = args[key];
    return typeof value === "string" ? value.trim() : "";
  };
  const instructions = text("instructions");
  return [
    ...(text("description") ? [{ label: "Description", value: text("description") }] : []),
    { label: "Model", value: text("model") || "default model" },
    ...(instructions.length > PAYLOAD_FOLD
      ? []
      : [{ label: "Instructions", value: instructions || "(none)" }]),
  ];
}

export interface ApprovalText {
  title: string;
  facts?: ApprovalFact[];
  alwaysAllowHint: string;
  foldedPayload?: string;
}

export function approvalText(
  call: ChatToolCall,
  botName: string,
  labels: ToolLabelCatalog,
): ApprovalText {
  const ask = toolAskLabel(labels, call.name);
  const summary = argSummary(call);
  const payload = approvalPayload(call);
  return {
    title: `${botName} wants to ${ask}${summary ? `: “${summary}”` : ""}`,
    alwaysAllowHint: `Approve, and let ${botName} ${ask} without asking`,
    ...(call.name === "create_bot" ? { facts: newBotFacts(call.args ?? {}) } : {}),
    ...(payload.length > PAYLOAD_FOLD ? { foldedPayload: payload } : {}),
  };
}

export function expiryText(expiresAt: number | undefined, now = Date.now()): string {
  if (expiresAt === undefined) return "";
  const minutes = Math.max(0, Math.ceil((expiresAt - now) / 60_000));
  return ` Expires in ${minutes === 1 ? "1 minute" : `${minutes} minutes`}.`;
}

const VAULT_VERB: Record<string, string> = {
  browser_fill_secret: "fill",
  browser_enter_code: "enter a code from",
  computer_fill_secret: "type",
  http_request: "send",
};

export interface VaultApprovalText {
  title: string;
  command?: string;
  description: string;
  grantHint: string;
}

export function vaultApprovalText(
  call: ChatToolCall & { vault: NonNullable<ChatToolCall["vault"]> },
  botName: string,
  now = Date.now(),
): VaultApprovalText {
  const { vault } = call;
  const what = vault.card ? `${vault.card.brand} ••${vault.card.last4}` : vault.label;
  const expiry = expiryText(call.expiresAt, now);
  const grantHint = `Approve and stop asking about ${vault.handle} in this chat`;
  if (vault.tool === "run_command") {
    const env = vault.env ?? [];
    return {
      title: `${botName} wants to run a command with ${what}`,
      command: vault.target,
      description: `${env.join(", ")} ${vault.env?.length === 1 ? "is" : "are"} set for this command only, and it can reach only ${vault.hosts?.join(", ") || "nothing"}. ${botName} never sees the value, but the command can use it: check what it does.${expiry}`,
      grantHint,
    };
  }
  const verb = VAULT_VERB[vault.tool] ?? "use";
  const where = vault.tool === "http_request" ? `to ${vault.target}` : `on ${vault.target}`;
  const into =
    vault.tool === "http_request"
      ? "into the request"
      : vault.tool === "computer_fill_secret"
        ? "into that window on the computer, and only if it is in front"
        : "into the page";
  return {
    title: `${botName} wants to ${verb} ${what} ${where}`,
    description: `${vault.username ? `As ${vault.username}. ` : ""}The value goes straight ${into}; ${botName} never sees it.${expiry}`,
    grantHint,
  };
}

export function credentialRequestText(
  call: ChatToolCall & { credentials: NonNullable<ChatToolCall["credentials"]> },
  botName: string,
  now = Date.now(),
): { title: string; description: string } {
  const { credentials } = call;
  let host = credentials.origin;
  try {
    host = new URL(credentials.origin).host;
  } catch {}
  return {
    title: `${botName} needs you on ${host}`,
    description: `${credentials.title}. What you type is filled into the page and never shown to ${botName}.${expiryText(call.expiresAt, now)}`,
  };
}

export function approvalNote(
  note: string | undefined,
  approval: ChatToolCall["approval"],
): string | undefined {
  if (!note && approval !== "approved" && approval !== "auto" && approval !== "yolo") {
    return undefined;
  }
  const lead = note ?? "";
  const sep = note ? " · " : "";
  if (approval === "approved") return note ? `${note} · approved by you` : lead;
  if (approval === "auto") return `${lead}${sep}auto-approved`;
  if (approval === "yolo") return `${lead}${sep}auto-approved (YOLO)`;
  return lead;
}

export function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.max(1, Math.round(ms))}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function formatWait(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${Math.max(1, seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return seconds % 60 ? `${minutes}m ${seconds % 60}s` : `${minutes}m`;
  return minutes % 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes / 60}h`;
}

export function durationText(call: ChatToolCall): string | undefined {
  if (call.durationMs === undefined) return undefined;
  const waited = call.waitedMs ? ` · waited ${formatWait(call.waitedMs)} for you` : "";
  return `${formatDuration(call.durationMs)}${waited}`;
}

export type ToolStep =
  | { kind: "call"; call: ChatToolCall; i: number }
  | { kind: "group"; calls: ChatToolCall[]; i: number };

export function toolSteps(calls: ChatToolCall[]): ToolStep[] {
  const steps: ToolStep[] = [];
  let run: ChatToolCall[] = [];
  let start = 0;
  const flush = () => {
    if (run.length >= 2) steps.push({ kind: "group", calls: run, i: start });
    else run.forEach((call, k) => steps.push({ kind: "call", call, i: start + k }));
    run = [];
  };
  calls.forEach((call, i) => {
    if (!viewOf(call).foldable) {
      flush();
      steps.push({ kind: "call", call, i });
      return;
    }
    if (run.length === 0) start = i;
    run.push(call);
  });
  flush();
  return steps;
}

export function describeCalls(calls: ChatToolCall[], labels: ToolLabelCatalog): string {
  const counts = new Map<string, number>();
  for (const call of calls) {
    const label = call.name === "load_skill" ? "Used a skill" : toolLabel(labels, call.name);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const parts = [...counts].map(([label, n]) => (n > 1 ? `${label} ×${n}` : label));
  return parts
    .map((part, i) => (i === 0 ? part : part.charAt(0).toLowerCase() + part.slice(1)))
    .join(", ");
}

export function groupText(
  calls: ChatToolCall[],
  labels: ToolLabelCatalog,
): { title: string; failed?: string; duration?: string } {
  const failed = calls.filter((call) => viewOf(call).phase === "failed").length;
  const duration = calls.reduce((sum, call) => sum + (call.durationMs ?? 0), 0);
  return {
    title: describeCalls(calls, labels),
    ...(failed > 0 ? { failed: `· ${failed} failed` } : {}),
    ...(duration > 0 ? { duration: formatDuration(duration) } : {}),
  };
}

export function workFold(
  message: { status: string; toolCalls?: ChatToolCall[]; reasoning?: string },
  labels: ToolLabelCatalog,
): { title: string; failed?: string; duration?: string } | null {
  if (message.status === "streaming") return null;
  const calls = message.toolCalls ?? [];
  if (calls.length === 0 || calls.some((call) => !viewOf(call).foldable)) return null;
  if (toolSteps(calls).length + (message.reasoning ? 1 : 0) < 2) return null;
  const text = groupText(calls, labels);
  return { ...text, title: `Worked: ${text.title.charAt(0).toLowerCase()}${text.title.slice(1)}` };
}
