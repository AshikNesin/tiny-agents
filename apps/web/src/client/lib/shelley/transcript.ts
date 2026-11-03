/**
 * Shelley messages → the rows the Code page renders (issue #143).
 *
 * Wire facts (verified against Shelley 6c48a83): `llm_data` is a JSON string
 * `{Role, Content[], EndOfTurn, ErrorType, ErrorRetryable}`; a content
 * block's `Type` is a number (2 text, 3 thinking, 4 redacted thinking, 5 tool
 * use, 6 tool result, 7 server tool use); tool results arrive in `user`-typed
 * messages, and so do messages the harness injects (a subagent reporting
 * back, a background job finishing), told apart by `user_data`.
 */
import type { ShelleyMessage } from "./api";

const TEXT = 2;
const THINKING = 3;
const TOOL_USE = 5;
const TOOL_RESULT = 6;
const SERVER_TOOL_USE = 7;

interface Block {
  ID?: string;
  Type?: number;
  Text?: string;
  Thinking?: string;
  MediaType?: string;
  ToolName?: string;
  ToolInput?: unknown;
  ToolUseID?: string;
  ToolError?: boolean;
  ToolResult?: Block[];
  ToolUseStartTime?: string | null;
  ToolUseEndTime?: string | null;
  Display?: unknown;
  DisplayImageURL?: string;
}

interface LlmData {
  Content?: Block[];
  EndOfTurn?: boolean;
  ErrorType?: string;
  ErrorRetryable?: boolean;
}

export type ToolKind =
  | "bash"
  | "patch"
  | "subagent"
  | "browser"
  | "image"
  | "message_user"
  | "message_parent"
  | "change_dir"
  | "other";

export interface ToolItem {
  kind: "tool";
  key: string;
  toolKind: ToolKind;
  name: string;
  input: unknown;
  /** One-line gist: the bash command, the file path, the subagent slug… */
  summary: string;
  status: "running" | "done" | "error";
  /** Result text, or the live tail while it runs. */
  output?: string;
  live?: boolean;
  durationMs?: number;
  /** `patch`: the unified diff Shelley produced. */
  diff?: { path: string; diff: string };
  /** `subagent`: the child to open. */
  subagent?: { slug: string; conversationId: string };
  /** `bash`: exit code and background flag. */
  exitCode?: number;
  background?: boolean;
  /** Image URLs as Shelley serves them (map with `shelleyApi.imageUrl`). */
  images: string[];
}

export type TranscriptItem =
  | { kind: "user"; key: string; messageId: string; text: string; attachments: string[] }
  | { kind: "assistant"; key: string; messageId: string; text: string }
  | { kind: "thinking"; key: string; text: string }
  | { kind: "report"; key: string; from: string; text: string }
  | { kind: "job"; key: string; text: string; exitCode?: number }
  | {
      kind: "notice";
      key: string;
      level: "error" | "warning" | "info";
      text: string;
      retryable?: boolean;
      refusal?: boolean;
    }
  | { kind: "turn"; key: string; durationMs?: number; costUsd?: number }
  | ToolItem;

export interface LiveState {
  /** Live output tails of running tools, by tool_use_id. */
  progress?: Record<string, string>;
}

function parse<T>(raw: string | null | undefined): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function textOf(blocks: Block[] | undefined): string {
  return (blocks ?? [])
    .filter((b) => b.Type === TEXT && b.Text)
    .map((b) => b.Text)
    .join("\n");
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function firstLine(value: string, max = 140): string {
  const line = value.split("\n")[0].trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function toolKind(name: string): ToolKind {
  if (name === "bash") return "bash";
  if (name === "patch" || name === "apply_patch") return "patch";
  if (name === "subagent") return "subagent";
  if (name === "read_image") return "image";
  if (name === "message_user") return "message_user";
  if (name === "message_parent") return "message_parent";
  if (name === "change_dir") return "change_dir";
  if (name.startsWith("browser")) return "browser";
  return "other";
}

/** The one-line gist of a tool call's input. */
export function summarizeInput(name: string, input: unknown): string {
  const args = record(input);
  if (!args) return "";
  const pick = (key: string) => (typeof args[key] === "string" ? String(args[key]) : undefined);
  if (name === "subagent") return pick("slug") ?? "";
  if (name.startsWith("browser")) {
    const action = pick("action") ?? "";
    const target = pick("url") ?? pick("selector") ?? pick("expression") ?? "";
    return firstLine([action, target].filter(Boolean).join(" "));
  }
  if (name === "apply_patch") {
    const patch = pick("input") ?? "";
    const files = [...patch.matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm)].map(
      (m) => m[1],
    );
    return firstLine(files.join(", "));
  }
  const preferred = ["command", "path", "text", "prompt", "query", "url", "pattern", "thoughts"];
  const key =
    preferred.find((k) => typeof args[k] === "string") ??
    Object.keys(args).find((k) => typeof args[k] === "string");
  return key ? firstLine(String(args[key])) : "";
}

/** `[path]` tokens the composer appends for uploads; returns text without them and the paths. */
export function splitAttachments(text: string): { text: string; attachments: string[] } {
  const attachments: string[] = [];
  const stripped = text.replace(/\[(\/[^\]\n]+)\]/g, (whole, path: string) => {
    if (!/^\/tmp\/shelley-(uploads|screenshots)\//.test(path)) return whole;
    attachments.push(path);
    return "";
  });
  return { text: stripped.trim(), attachments };
}

interface DisplayEntry {
  tool_use_id: string;
  display: unknown;
}

/**
 * Fold messages (any order; duplicates are fine) into rows. Tool results
 * attach to their call; running calls show the live tail from `live`.
 */
export function buildTranscript(
  messages: Iterable<ShelleyMessage>,
  live: LiveState = {},
): TranscriptItem[] {
  const sorted = [...new Map([...messages].map((m) => [m.sequence_id, m])).values()].sort(
    (a, b) => a.sequence_id - b.sequence_id,
  );
  const items: TranscriptItem[] = [];
  const calls = new Map<string, ToolItem>();
  let turnStart: number | undefined;
  let turnCost = 0;

  for (const message of sorted) {
    const data = parse<LlmData>(message.llm_data) ?? {};
    const blocks = data.Content ?? [];
    const at = Date.parse(message.created_at);

    switch (message.type) {
      case "user": {
        const userData = record(parse(message.user_data));
        const text = textOf(blocks);
        if (userData?.sender_relationship === "subagent") {
          items.push({
            kind: "report",
            key: message.message_id,
            from: String(userData.sender_slug ?? "subagent"),
            text,
          });
          break;
        }
        if (userData && "background_job_id" in userData) {
          items.push({
            kind: "job",
            key: message.message_id,
            text: firstLine(text, 300),
            ...(typeof userData.exit_code === "number" ? { exitCode: userData.exit_code } : {}),
          });
          break;
        }
        if (text.trim()) {
          if (turnStart === undefined) {
            turnStart = at;
            turnCost = 0;
          }
          const { text: body, attachments } = splitAttachments(text);
          items.push({
            kind: "user",
            key: message.message_id,
            messageId: message.message_id,
            text: body,
            attachments,
          });
        }
        // Tool results (and their display data) for calls made earlier.
        // display_data is a list of {tool_use_id, display} on tool results
        // (an object on other rows, e.g. the system prompt's skills).
        const rawDisplays = parse<unknown>(message.display_data);
        const displays = new Map(
          (Array.isArray(rawDisplays) ? (rawDisplays as DisplayEntry[]) : [])
            .filter((d) => d && typeof d.tool_use_id === "string")
            .map((d) => [d.tool_use_id, d.display]),
        );
        for (const block of blocks) {
          if (block.Type !== TOOL_RESULT || !block.ToolUseID) continue;
          const call = calls.get(block.ToolUseID);
          if (!call) continue;
          attachResult(call, block, displays.get(block.ToolUseID) ?? block.Display);
        }
        break;
      }
      case "agent": {
        const usage = parse<{ cost_usd?: number }>(message.usage_data);
        if (usage?.cost_usd) turnCost += usage.cost_usd;
        blocks.forEach((block, i) => {
          const key = `${message.message_id}:${i}`;
          if (block.Type === TEXT && block.Text?.trim()) {
            items.push({ kind: "assistant", key, messageId: message.message_id, text: block.Text });
          } else if (block.Type === THINKING && block.Thinking?.trim()) {
            items.push({ kind: "thinking", key, text: block.Thinking });
          } else if ((block.Type === TOOL_USE || block.Type === SERVER_TOOL_USE) && block.ID) {
            const name = block.ToolName ?? "tool";
            const call: ToolItem = {
              kind: "tool",
              key: block.ID,
              toolKind: toolKind(name),
              name,
              input: block.ToolInput,
              summary: summarizeInput(name, block.ToolInput),
              status: "running",
              images: [],
            };
            const tail = live.progress?.[block.ID];
            if (tail) {
              call.output = tail;
              call.live = true;
            }
            const args = record(block.ToolInput);
            if (call.toolKind === "bash" && args?.background === true) call.background = true;
            calls.set(block.ID, call);
            items.push(call);
          }
        });
        if (message.end_of_turn || data.EndOfTurn) {
          items.push({
            kind: "turn",
            key: `turn:${message.message_id}`,
            // Shelley's timestamps have second precision: shorter turns show no duration.
            ...(turnStart !== undefined && Number.isFinite(at) && at - turnStart >= 1000
              ? { durationMs: at - turnStart }
              : {}),
            ...(turnCost > 0 ? { costUsd: turnCost } : {}),
          });
          turnStart = undefined;
          turnCost = 0;
        }
        break;
      }
      case "error":
      case "warning": {
        const text =
          textOf(blocks) || (message.type === "error" ? "The model request failed." : "");
        if (!text) break;
        items.push({
          kind: "notice",
          key: message.message_id,
          level: message.type === "error" ? "error" : "warning",
          text,
          ...(data.ErrorRetryable ? { retryable: true } : {}),
          ...(data.ErrorType === "refusal" ? { refusal: true } : {}),
        });
        turnStart = undefined;
        break;
      }
      case "gitinfo":
      case "modelchange":
      case "inplacecompaction": {
        const text =
          textOf(blocks) ||
          (message.type === "inplacecompaction" ? "Context compacted" : message.type);
        items.push({
          kind: "notice",
          key: message.message_id,
          level: "info",
          text: firstLine(text, 300),
        });
        break;
      }
      default:
        // system, slug, profileturn, live transcripts: not shown.
        break;
    }
  }
  return items;
}

function attachResult(call: ToolItem, block: Block, display: unknown) {
  call.status = block.ToolError ? "error" : "done";
  call.live = false;
  const text = textOf(block.ToolResult);
  if (text) call.output = text;
  for (const part of block.ToolResult ?? []) {
    if (part.MediaType?.startsWith("image/") && part.DisplayImageURL)
      call.images.push(part.DisplayImageURL);
  }
  if (block.ToolUseStartTime && block.ToolUseEndTime) {
    const ms = Date.parse(block.ToolUseEndTime) - Date.parse(block.ToolUseStartTime);
    if (Number.isFinite(ms) && ms >= 0) call.durationMs = ms;
  }
  const d = record(display);
  if (!d) return;
  if (typeof d.diff === "string" && typeof d.path === "string") {
    call.diff = { path: d.path, diff: d.diff };
  }
  if (typeof d.conversation_id === "string" && typeof d.slug === "string") {
    call.subagent = { slug: d.slug, conversationId: d.conversation_id };
  }
  if (typeof d.exitCode === "number") call.exitCode = d.exitCode;
  if (typeof d.url === "string" && d.type === "screenshot" && call.images.length === 0) {
    call.images.push(d.url);
  }
}

/** The newest `sequence_id` in a set of messages. */
export function maxSequence(messages: Iterable<ShelleyMessage>): number {
  let max = 0;
  for (const m of messages) max = Math.max(max, m.sequence_id);
  return max;
}

/** Total cost of agent messages (USD). */
export function totalCost(messages: Iterable<ShelleyMessage>): number {
  let sum = 0;
  for (const m of messages) {
    if (m.type !== "agent") continue;
    sum += parse<{ cost_usd?: number }>(m.usage_data)?.cost_usd ?? 0;
  }
  return sum;
}

/** Whether the conversation's last message is a retryable error, a refusal, or neither. */
export function lastError(
  messages: ShelleyMessage[],
): { retryable: boolean; refusal: boolean } | undefined {
  const last = [...messages]
    .sort((a, b) => b.sequence_id - a.sequence_id)
    .find((m) => ["agent", "error", "user"].includes(m.type));
  if (!last || last.type !== "error") return undefined;
  const data = parse<LlmData>(last.llm_data) ?? {};
  return { retryable: Boolean(data.ErrorRetryable), refusal: data.ErrorType === "refusal" };
}

/** A run of finished tool calls shown as one "Ran 3 commands, edited 2 files" line. */
export interface ToolGroup {
  kind: "tool-group";
  key: string;
  tools: ToolItem[];
  /** The tools with the thinking between them, in order. */
  items: Array<ToolItem | Extract<TranscriptItem, { kind: "thinking" }>>;
}

export type DisplayItem = TranscriptItem | ToolGroup;

/** Tools that stand on their own: cards, messages, and steps whose screenshots matter. */
function standsAlone(item: ToolItem): boolean {
  return (
    item.status === "running" ||
    item.toolKind === "subagent" ||
    item.toolKind === "message_user" ||
    item.toolKind === "message_parent" ||
    item.images.length > 0
  );
}

/**
 * Folds runs of two or more finished tool calls (and the thinking between
 * them) into one collapsible group, so a long turn reads as its messages;
 * running tools, subagents and screenshots stay in view.
 */
export function groupTools(items: TranscriptItem[]): DisplayItem[] {
  const out: DisplayItem[] = [];
  let run: ToolGroup["items"] = [];
  const flush = () => {
    // Thinking after the last tool belongs to what follows, not the group.
    let end = run.length;
    while (end > 0 && run[end - 1].kind === "thinking") end--;
    const body = run.slice(0, end);
    const tools = body.filter((i): i is ToolItem => i.kind === "tool");
    if (tools.length >= 2) {
      out.push({ kind: "tool-group", key: `group:${tools[0].key}`, tools, items: body });
    } else {
      out.push(...body);
    }
    out.push(...run.slice(end));
    run = [];
  };
  for (const item of items) {
    if (item.kind === "tool" && !standsAlone(item)) {
      run.push(item);
    } else if (item.kind === "thinking" && run.length > 0) {
      run.push(item);
    } else {
      flush();
      out.push(item);
    }
  }
  flush();
  return out;
}

/** "Ran 3 commands, edited 2 files" for a group's summary line. */
export function describeTools(tools: ToolItem[]): string {
  const count = (kind: ToolKind) => tools.filter((t) => t.toolKind === kind).length;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const parts: string[] = [];
  const bash = count("bash");
  const patch = count("patch");
  const browser = count("browser");
  const other = tools.length - bash - patch - browser;
  if (bash) parts.push(`ran ${plural(bash, "command", "commands")}`);
  if (patch) parts.push(`edited ${plural(patch, "file", "files")}`);
  if (browser) parts.push(`used the browser ${plural(browser, "time", "times")}`);
  if (other) parts.push(`used ${plural(other, "tool", "tools")}`);
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
