/**
 * Shelley messages → transcript rows.
 *
 * Wire facts (verified against Shelley 6c48a83): `llm_data` is a JSON string
 * `{Role, Content[], EndOfTurn, ErrorType, ErrorRetryable}`; a content
 * block's `Type` is a number (2 text, 3 thinking, 4 redacted thinking, 5 tool
 * use, 6 tool result, 7 server tool use); tool results arrive in `user`-typed
 * messages, and so do messages the harness injects (a subagent reporting
 * back, a background job finishing), told apart by `user_data`.
 */
import {
  threadIdOf,
  type AssetRef,
  type QueuedMessage,
  type ToolItem,
  type ToolKind,
  type TranscriptItem,
} from "../../contracts";
import { firstLine, isImageFile, pick as pickFrom, record } from "../../server/items";
import type { ShelleyMessage, ShelleyRow } from "./wire";

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

function toolKind(name: string): ToolKind {
  if (name === "bash") return "bash";
  if (name === "patch" || name === "apply_patch") return "edit";
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
  const pick = (...keys: string[]) => pickFrom(args, ...keys);
  if (name === "subagent") return pick("slug") ?? "";
  if (name.startsWith("browser")) {
    const action = pick("action") ?? "";
    const target = pick("url", "selector", "expression") ?? "";
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

function basename(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

/** A file on Shelley's machine as an asset. */
function fileAsset(path: string): AssetRef {
  return { ref: `file:${path}`, name: basename(path), image: isImageFile(path) };
}

/** Shelley serves images at /api/message/<id>/image/<c>/<t> and files at /api/read?path=. */
export function assetFromUrl(url: string): AssetRef | undefined {
  const image = /\/api\/message\/([A-Za-z0-9_-]+)\/image\/(-?\d+)\/(-?\d+)/.exec(url);
  if (image) {
    return { ref: `img:${image[1]}:${image[2]}:${image[3]}`, name: "image", image: true };
  }
  const read = /\/api\/read\?path=([^&]+)/.exec(url);
  if (read) {
    const path = decodeURIComponent(read[1]!);
    return { ...fileAsset(path), image: true };
  }
  return undefined;
}

/** The Shelley API path that serves an asset ref, or undefined for a ref this driver did not make. */
export function assetPath(ref: string): string | undefined {
  const image = /^img:([A-Za-z0-9_-]+):(-?\d{1,4}):(-?\d{1,4})$/.exec(ref);
  if (image) return `/message/${image[1]}/image/${image[2]}/${image[3]}`;
  if (ref.startsWith("file:/")) {
    const path = ref.slice(5);
    if (path.split("/").includes("..")) return undefined;
    return `/read?path=${encodeURIComponent(path)}`;
  }
  return undefined;
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
 * `instanceId` names subagent threads.
 */
export function buildTranscript(
  messages: Iterable<ShelleyMessage>,
  instanceId: string,
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
            id: message.message_id,
            from: String(userData.sender_slug ?? "subagent"),
            text,
          });
          break;
        }
        if (userData && "background_job_id" in userData) {
          items.push({
            kind: "job",
            id: message.message_id,
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
            id: message.message_id,
            text: body,
            attachments: attachments.map(fileAsset),
            forkAt: message.message_id,
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
          attachResult(call, block, displays.get(block.ToolUseID) ?? block.Display, instanceId);
        }
        break;
      }
      case "agent": {
        const usage = parse<{ cost_usd?: number }>(message.usage_data);
        if (usage?.cost_usd) turnCost += usage.cost_usd;
        blocks.forEach((block, i) => {
          const id = `${message.message_id}:${i}`;
          if (block.Type === TEXT && block.Text?.trim()) {
            items.push({ kind: "assistant", id, text: block.Text });
          } else if (block.Type === THINKING && block.Thinking?.trim()) {
            items.push({ kind: "thinking", id, text: block.Thinking });
          } else if ((block.Type === TOOL_USE || block.Type === SERVER_TOOL_USE) && block.ID) {
            const name = block.ToolName ?? "tool";
            const call: ToolItem = {
              kind: "tool",
              id: block.ID,
              tool: toolKind(name),
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
            if (call.tool === "bash" && args?.background === true) call.background = true;
            calls.set(block.ID, call);
            items.push(call);
          }
        });
        if (message.end_of_turn || data.EndOfTurn) {
          items.push({
            kind: "turn",
            id: `turn:${message.message_id}`,
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
          id: message.message_id,
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
          id: message.message_id,
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

function attachResult(call: ToolItem, block: Block, display: unknown, instanceId: string) {
  call.status = block.ToolError ? "error" : "done";
  call.live = false;
  const text = textOf(block.ToolResult);
  if (text) call.output = text;
  for (const part of block.ToolResult ?? []) {
    if (part.MediaType?.startsWith("image/") && part.DisplayImageURL) {
      const asset = assetFromUrl(part.DisplayImageURL);
      if (asset) call.images.push(asset);
    }
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
    call.child = { threadId: threadIdOf(instanceId, d.conversation_id), title: d.slug };
  }
  if (typeof d.exitCode === "number") call.exitCode = d.exitCode;
  if (typeof d.url === "string" && d.type === "screenshot" && call.images.length === 0) {
    const asset = assetFromUrl(d.url);
    if (asset) call.images.push(asset);
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

/** Queued messages from a conversation row (`queued_messages` is a JSON string). */
export function queuedMessages(
  row: Pick<ShelleyRow, "queued_messages"> | undefined,
): QueuedMessage[] {
  if (!row?.queued_messages) return [];
  try {
    const items = JSON.parse(row.queued_messages) as Array<{
      id: string;
      created_at?: string;
      llm?: { Content?: Array<{ Type?: number; Text?: string }> };
      user_data?: { sender_slug?: string; sender_relationship?: string };
    }>;
    if (!Array.isArray(items)) return [];
    return items.map((item): QueuedMessage => ({
      id: item.id,
      text: (item.llm?.Content ?? [])
        .filter((c) => c.Type === TEXT && c.Text)
        .map((c) => c.Text)
        .join("\n"),
      createdAt: item.created_at ?? "",
      ...(item.user_data?.sender_slug ? { from: item.user_data.sender_slug } : {}),
    }));
  } catch {
    return [];
  }
}

/** The `text` of a `message_user` tool call in an agent message's llm_data. */
export function messageUserText(llmData: string): string | undefined {
  const parsed = parse<LlmData>(llmData);
  const call = (parsed?.Content ?? []).find(
    (c) =>
      c.Type === TOOL_USE &&
      c.ToolName === "message_user" &&
      typeof record(c.ToolInput)?.text === "string",
  );
  return call ? String(record(call.ToolInput)?.text) : undefined;
}

/**
 * When Shelley last wrote to the conversation (ms): its newest agent or error
 * message, on Shelley's clock. The turn outcome's `endedAt`
 * (`server/outcome.ts`); undefined before Shelley answered anything.
 */
export function lastWriteAt(messages: Iterable<ShelleyMessage>): number | undefined {
  let newest: ShelleyMessage | undefined;
  for (const m of messages) {
    if (m.type !== "agent" && m.type !== "error") continue;
    if (!newest || m.sequence_id > newest.sequence_id) newest = m;
  }
  const at = newest ? Date.parse(newest.created_at) : Number.NaN;
  return Number.isFinite(at) ? at : undefined;
}
