import { eq } from "drizzle-orm";
import { logger } from "@groot/core/logger";
import { stripAttachmentNotes } from "@tiny-agents/agent";
import { stripPeerEnvelope } from "@tiny-agents/agent/peer-envelope";
import { db, botChats } from "../../db";
import type { SideCaller } from "./side-call";
import { app } from "../../app-root";

export const CHAT_TITLE_MAX = 80;

const EXCERPT_CHARS = 4_000;
const TITLE_TIMEOUT_MS = 30_000;

export interface TitleMessage {
  role: string;
  text: string;
  status?: string;
}

export interface ChatTitler {
  sideCaller: SideCaller;
}

export function setChatTitler(next: ChatTitler | undefined): void {
  app().chatTitler = next;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function firstMessageTitle(messages: ReadonlyArray<TitleMessage>): string | null {
  for (const m of messages) {
    if (m.role !== "user") continue;
    const text = oneLine(stripAttachmentNotes(stripPeerEnvelope(m.text)));
    if (text) return text.slice(0, CHAT_TITLE_MAX);
  }
  return null;
}

export function titleExcerpt(messages: ReadonlyArray<TitleMessage>, botName: string): string {
  const lines: string[] = [];
  let size = 0;
  for (const m of messages) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    if (m.role === "assistant" && m.status === "error") continue;
    const text = oneLine(
      m.role === "user" ? stripAttachmentNotes(stripPeerEnvelope(m.text)) : m.text,
    ).slice(0, 600);
    if (!text) continue;
    const line = `${m.role === "user" ? "Owner" : botName}: ${text}`;
    size += line.length + 1;
    if (size > EXCERPT_CHARS && lines.length > 0) break;
    lines.push(line);
  }
  return lines.join("\n");
}

export function cleanTitle(raw: string): string | null {
  const firstLine = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return null;
  const title = oneLine(
    firstLine
      .replace(/^(title|chat title)\s*:\s*/i, "")
      .replace(/^[*_#"'`“‘\s]+|[*_"'`”’\s]+$/g, "")
      .replace(/[.。]+$/, ""),
  );
  return title ? title.slice(0, CHAT_TITLE_MAX) : null;
}

export async function titlePastChat(
  chatId: string,
  input: {
    botId?: string;
    botName: string;
    botModelId: string | null;
    messages: ReadonlyArray<TitleMessage>;
  },
  deps: ChatTitler | undefined = app().chatTitler,
): Promise<void> {
  if (!deps) return;
  try {
    const excerpt = titleExcerpt(input.messages, input.botName);
    if (!excerpt) return;
    const text = await deps.sideCaller.complete({
      role: "chat_title",
      ...(input.botModelId ? { botModelId: input.botModelId } : {}),
      system:
        "You name chat conversations. Reply with a title of at most 6 words that says what " +
        "the conversation is about. Plain text only: no quotes, no trailing period, no preamble.",
      user: `Conversation:\n${excerpt}\n\nTitle:`,
      timeoutMs: TITLE_TIMEOUT_MS,
      label: "Chat title",
      ...(input.botId ? { botId: input.botId } : {}),
      context: { chatId },
    });
    if (text === undefined) return;
    const title = cleanTitle(text);
    if (!title) return;
    await db.update(botChats).set({ title }).where(eq(botChats.id, chatId));
  } catch (error) {
    logger.warn({ error, chatId }, "Chat title skipped after error");
  }
}
