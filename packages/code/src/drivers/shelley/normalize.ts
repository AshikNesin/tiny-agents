import { parseJson } from "@tiny-agents/std";
import { z } from "zod";
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
  progress?: Record<string, string>;
}

function orAbsent<T>(value: T | null | undefined): T | undefined {
  return value ?? undefined;
}

const optionalText = z.string().nullish().transform(orAbsent);
const optionalFlag = z.boolean().nullish().transform(orAbsent);
const optionalNumber = z.number().nullish().transform(orAbsent);

const blockSchema: z.ZodType<Block> = z.object({
  ID: optionalText,
  Type: optionalNumber,
  Text: optionalText,
  Thinking: optionalText,
  MediaType: optionalText,
  ToolName: optionalText,
  ToolInput: z.unknown().optional(),
  ToolUseID: optionalText,
  ToolError: optionalFlag,
  ToolResult: z
    .lazy(() => z.array(blockSchema))
    .nullish()
    .transform(orAbsent),
  ToolUseStartTime: z.string().nullish(),
  ToolUseEndTime: z.string().nullish(),
  Display: z.unknown().optional(),
  DisplayImageURL: optionalText,
});

const llmDataSchema: z.ZodType<LlmData> = z.object({
  Content: z.array(blockSchema).nullish().transform(orAbsent),
  EndOfTurn: optionalFlag,
  ErrorType: optionalText,
  ErrorRetryable: optionalFlag,
});

const costSchema = z.looseObject({ cost_usd: z.number().optional() });

const queuedSchema = z.array(
  z.looseObject({
    id: z.string(),
    created_at: optionalText,
    llm: z
      .looseObject({
        Content: z
          .array(z.looseObject({ Type: optionalNumber, Text: optionalText }))
          .nullish()
          .transform(orAbsent),
      })
      .nullish(),
    user_data: z.looseObject({ sender_slug: optionalText }).nullish(),
  }),
);

function parse<T>(
  what: string,
  raw: string | null | undefined,
  schema: z.ZodType<T>,
): T | undefined {
  if (!raw) return undefined;
  try {
    return parseJson(what, raw, schema);
  } catch {
    return undefined;
  }
}

function shortGitInfo(text: string): string {
  const match = /^.+? \(([^()\s]+)\) (now at .*)$/s.exec(text);
  return match ? `${match[1]} ${match[2]}` : text;
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
  return path.split("/").findLast(Boolean) ?? path;
}

function fileAsset(path: string): AssetRef {
  return { ref: `file:${path}`, name: basename(path), image: isImageFile(path) };
}

function decodePathPart(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function assetFromUrl(url: string): AssetRef | undefined {
  const image = /\/api\/message\/([A-Za-z0-9_-]+)\/image\/(-?\d+)\/(-?\d+)/.exec(url);
  if (image) {
    return { ref: `img:${image[1]}:${image[2]}:${image[3]}`, name: "image", image: true };
  }
  const read = /\/api\/read\?path=([^&]+)/.exec(url);
  if (read) {
    const path = decodePathPart(read[1]!);
    return { ...fileAsset(path), image: true };
  }
  return undefined;
}

export function assetPath(ref: string): string | undefined {
  const image = /^img:([A-Za-z0-9_-]+):(-?\d+):(-?\d+)$/.exec(ref);
  if (image) return `/message/${image[1]}/image/${image[2]}/${image[3]}`;
  if (ref.startsWith("file:/")) {
    const path = ref.slice(5);
    if (path.split("/").includes("..")) return undefined;
    return `/read?path=${encodeURIComponent(path)}`;
  }
  return undefined;
}

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
    const data = parse("A Shelley message", message.llm_data, llmDataSchema) ?? {};
    const blocks = data.Content ?? [];
    const at = Date.parse(message.created_at);

    switch (message.type) {
      case "user": {
        const userData = record(
          parse("A Shelley message's sender", message.user_data, z.unknown()),
        );
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
        const rawDisplays = parse(
          "A Shelley message's displays",
          message.display_data,
          z.unknown(),
        );
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
        const usage = parse("A Shelley message's usage", message.usage_data, costSchema);
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
          text: firstLine(message.type === "gitinfo" ? shortGitInfo(text) : text, 300),
        });
        break;
      }
      default:
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

export function maxSequence(messages: Iterable<ShelleyMessage>): number {
  let max = 0;
  for (const m of messages) max = Math.max(max, m.sequence_id);
  return max;
}

export function totalCost(messages: Iterable<ShelleyMessage>): number {
  let sum = 0;
  for (const m of messages) {
    if (m.type !== "agent") continue;
    sum += parse("A Shelley message's usage", m.usage_data, costSchema)?.cost_usd ?? 0;
  }
  return sum;
}

export function queuedMessages(
  row: Pick<ShelleyRow, "queued_messages"> | undefined,
): QueuedMessage[] {
  if (!row?.queued_messages) return [];
  try {
    const items = parseJson("Shelley's queued messages", row.queued_messages, queuedSchema);
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

export function messageUserText(llmData: string): string | undefined {
  const parsed = parse("A Shelley message", llmData, llmDataSchema);
  const call = (parsed?.Content ?? []).find(
    (c) =>
      c.Type === TOOL_USE &&
      c.ToolName === "message_user" &&
      typeof record(c.ToolInput)?.text === "string",
  );
  return call ? String(record(call.ToolInput)?.text) : undefined;
}

export function lastWriteAt(messages: Iterable<ShelleyMessage>): number | undefined {
  let newest: ShelleyMessage | undefined;
  for (const m of messages) {
    if (m.type !== "agent" && m.type !== "error") continue;
    if (!newest || m.sequence_id > newest.sequence_id) newest = m;
  }
  const at = newest ? Date.parse(newest.created_at) : Number.NaN;
  return Number.isFinite(at) ? at : undefined;
}
