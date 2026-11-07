/**
 * What a tool call says, in pure functions: its label and the imperative
 * phrase on its approval card, the short argument phrase beside it, the
 * approval and vault cards' sentences, the note on how it was approved, its
 * duration and Owner wait, and how a run of finished calls folds into one
 * "Read the page ×3, searched the web" step. `viewOf` (tool-call-view.ts)
 * decides a call's phase and card; this module words it; ChatMessageView
 * only draws. Labels come from the capability catalog (`toolLabelCatalog`,
 * loaded once per page by `useToolLabels`).
 */
import type { ChatToolCall } from "./chat-types";
import { viewOf } from "./tool-call-view";

/** Tool name → label. */
export type ToolLabels = Record<string, string>;

/** The capability catalog's labels for every tool. */
export interface ToolLabelCatalog {
  /** Past tense, for transcript rows ("Opened a page"). */
  done: ToolLabels;
  /** Imperative, completing "<bot> wants to …" ("open a page"); connection tools have none. */
  ask: ToolLabels;
}

export const NO_TOOL_LABELS: ToolLabelCatalog = { done: {}, ask: {} };

/** The label catalog from the capabilities route's tools. */
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

/**
 * A tool's label: the catalog's, else a connection tool's prettified name
 * ("Create Issue via linear" for `mcp__linear__create_issue`), else the
 * name with spaces.
 */
export function toolLabel(labels: ToolLabelCatalog, name: string): string {
  if (labels.done[name]) return labels.done[name];
  const via = name.match(/^mcp__([a-z0-9-]+)__(.+)$/);
  if (via) {
    const pretty = via[2].replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    return `${pretty} via ${via[1]}`;
  }
  return name.replace(/_/g, " ");
}

/**
 * What a tool call asks to do, completing "<bot> wants to …": the tool's
 * imperative label from the catalog, else "use <display name>" (connection
 * tools have no imperative label).
 */
export function toolAskLabel(labels: ToolLabelCatalog, name: string): string {
  return labels.ask[name] ?? `use ${toolLabel(labels, name)}`;
}

/** Longest argument phrase shown beside a call. */
const SUMMARY_LENGTH = 60;

/**
 * Short argument phrase for a tool row ("Fix SSE", "pi-durable"): the first
 * non-blank of a few telling arguments, else the first argument if it is
 * text; at most 60 characters.
 */
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

/** A trace row's title: `Opened a page “https://…”`, or `Using skill pdf` for `load_skill`. */
export function stepTitle(call: ChatToolCall, labels: ToolLabelCatalog): string {
  const summary = argSummary(call);
  if (call.name === "load_skill") return `Using skill ${summary}`;
  return `${toolLabel(labels, call.name)}${summary ? ` “${summary}”` : ""}`;
}

/**
 * Beyond this many characters the approval card folds the payload behind
 * "Read more": approving from a 60-char slice of a 700-word change is
 * rubber-stamping, and the one-line title can't hold it anyway.
 */
const PAYLOAD_FOLD = 120;

/**
 * The payload behind an approval: `instructions`/`append` for a
 * self-improve change, else the argument summary.
 */
export function approvalPayload(call: ChatToolCall): string {
  const args = call.args ?? {};
  for (const key of ["instructions", "append"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return argSummary(call);
}

/** A labelled line under an approval card's title. */
export interface ApprovalFact {
  label: string;
  value: string;
}

/**
 * Everything a new bot will be (create_bot, issue #149): approval is the
 * only gate, so the card shows the description, the model and the
 * instructions, not just the name. Instructions long enough to fold go
 * behind Read more instead.
 */
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

/** An approval card's sentences. */
export interface ApprovalText {
  /** `<bot> wants to <ask> — “<summary>”`. */
  title: string;
  /** Labelled lines the owner must read before approving; only create_bot has them. */
  facts?: ApprovalFact[];
  /** The "Always allow" button's tooltip. */
  alwaysAllowHint: string;
  /** The full payload, when it is long enough to fold behind "Read more". */
  foldedPayload?: string;
}

/** What an approval card says (issue #85): "<bot> wants to <ask>", never the done-label. */
export function approvalText(
  call: ChatToolCall,
  botName: string,
  labels: ToolLabelCatalog,
): ApprovalText {
  const ask = toolAskLabel(labels, call.name);
  const summary = argSummary(call);
  const payload = approvalPayload(call);
  return {
    title: `${botName} wants to ${ask}${summary ? ` — “${summary}”` : ""}`,
    alwaysAllowHint: `Approve, and let ${botName} ${ask} without asking`,
    ...(call.name === "create_bot" ? { facts: newBotFacts(call.args ?? {}) } : {}),
    ...(payload.length > PAYLOAD_FOLD ? { foldedPayload: payload } : {}),
  };
}

/** "Expires in 3 minutes." for a call that expires, rounded up. */
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

/** A vault use's approval card (issue #56): the item and where it goes, never the value. */
export interface VaultApprovalText {
  title: string;
  /** `run_command`: the command the secrets are set for. */
  command?: string;
  description: string;
  /** The "For this chat" button's tooltip. */
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

/** A credential request's card (issue #56): where the owner signs in. */
export function credentialRequestText(
  call: ChatToolCall & { credentials: NonNullable<ChatToolCall["credentials"]> },
  botName: string,
  now = Date.now(),
): { title: string; description: string } {
  const { credentials } = call;
  let host = credentials.origin;
  try {
    host = new URL(credentials.origin).host;
  } catch {
    // keep the raw origin
  }
  return {
    title: `${botName} needs you on ${host}`,
    description: `${credentials.title}. What you type is filled into the page and never shown to ${botName}.${expiryText(call.expiresAt, now)}`,
  };
}

/**
 * The note beside a trace line (`viewOf`'s), with how the call was let
 * through: "denied by you", "nobody answered in time · approved by you",
 * "auto-approved", "auto-approved (YOLO)". Undefined: no note line.
 */
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

/** A step's duration: "340ms", "1.2s" (seconds past a minute: "125.0s"). */
export function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.max(1, Math.round(ms))}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** A human wait: "40s", "1m 40s", "2h 5m". */
export function formatWait(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${Math.max(1, seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return seconds % 60 ? `${minutes}m ${seconds % 60}s` : `${minutes}m`;
  return minutes % 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes / 60}h`;
}

/** How long a finished call took, and how long it waited on the owner: "1.2s · waited 40s for you". */
export function durationText(call: ChatToolCall): string | undefined {
  if (call.durationMs === undefined) return undefined;
  const waited = call.waitedMs ? ` · waited ${formatWait(call.waitedMs)} for you` : "";
  return `${formatDuration(call.durationMs)}${waited}`;
}

/** One transcript step: a call on its own row, or a run of finished calls folded into one. */
export type ToolStep =
  | { kind: "call"; call: ChatToolCall; i: number }
  | { kind: "group"; calls: ChatToolCall[]; i: number };

/** Runs of two or more foldable calls (`viewOf`) become one group; the rest stay rows. */
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

/** "Read the page ×3, searched the web": what a run of calls did, by label. */
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

/** A folded run's line: what it did, how many calls failed ("· 2 failed"), its total time. */
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
