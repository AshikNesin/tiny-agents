/**
 * Past-chat titles (issue #101): after "New chat", one short side-call names
 * the chat that ended. Off the reset path: the row is recorded with the
 * first owner message as its title, and a model title replaces it when it
 * arrives. Every failure keeps that provisional title.
 */
import { eq } from "drizzle-orm";
import { logger } from "@groot/core/logger";
import { stripAttachmentNotes } from "@tiny-agents/agent";
import { stripPeerEnvelope } from "@tiny-agents/agent/peer-envelope";
import { db, botChats } from "../../db";
import type { SideCaller } from "./side-call";

/** Longest stored title; also the provisional (first message) title's cap. */
export const CHAT_TITLE_MAX = 80;

/** Transcript excerpt the title call reads: the start of the chat says what it is about. */
const EXCERPT_CHARS = 4_000;
const TITLE_TIMEOUT_MS = 30_000;

export interface TitleMessage {
  role: string;
  text: string;
  status?: string;
}

/** What naming a chat needs: the side-caller (on the `chat_title` model role). */
export interface ChatTitler {
  sideCaller: SideCaller;
}

let titler: ChatTitler | undefined;

/**
 * Boot wiring (entry.node.ts), so the Past-chat recorder can name chats
 * without carrying the port. Unset (tests, faux mode) means no title calls.
 */
export function setChatTitler(next: ChatTitler | undefined): void {
  titler = next;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** The provisional title: the first owner message, on one line. */
export function firstMessageTitle(messages: ReadonlyArray<TitleMessage>): string | null {
  for (const m of messages) {
    if (m.role !== "user") continue;
    const text = oneLine(stripAttachmentNotes(stripPeerEnvelope(m.text)));
    if (text) return text.slice(0, CHAT_TITLE_MAX);
  }
  return null;
}

/** "Owner: …" / "Bot: …" lines from the start of the chat, capped. */
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

/** The model's answer as a title: one line, no quotes, label or trailing period. */
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

/**
 * Name a past chat with the title model and store it. Best effort: never
 * throws, and leaves the provisional title in place on any failure.
 */
export async function titlePastChat(
  chatId: string,
  input: { botName: string; botModelId: string | null; messages: ReadonlyArray<TitleMessage> },
  deps: ChatTitler | undefined = titler,
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
      context: { chatId },
    });
    // No title (no model, a failed call): the first message stays.
    if (text === undefined) return;
    const title = cleanTitle(text);
    if (!title) return;
    // The chat may have been continued or deleted meanwhile: then nothing to name.
    await db.update(botChats).set({ title }).where(eq(botChats.id, chatId));
  } catch (error) {
    logger.warn({ error, chatId }, "Chat title skipped after error");
  }
}
