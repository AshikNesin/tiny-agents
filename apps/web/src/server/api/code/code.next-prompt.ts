/**
 * The next prompt the owner is likely to send in a Code thread: one short
 * line the composer offers as its placeholder (Tab fills it in), modeled on
 * t3code's prompt suggestions.
 *
 * Token budget (a hard requirement): one small call on the `chat_title`
 * model role per finished turn, at most, and only when a browser asks for
 * it (an open thread whose turn ended). The context is the turn alone: the
 * thread's title, the owner's last message and the agent's answer, each cut
 * short, never the transcript. Answers are kept by thread and newest row,
 * in flight too, so reopening the thread or a second tab never calls again.
 * A failed turn, a turn still working or no model gives no suggestion.
 */
import { turnAnswer, type HarnessInstance, type TranscriptItem } from "@tiny-agents/code/server";
import { app } from "../../app-root";

/** Answers kept (one per thread's newest turn); the oldest goes first. */
const KEEP = 200;
const TIMEOUT_MS = 10_000;
const ASKED_CHARS = 600;
const ANSWER_CHARS = 1_200;
const TITLE_CHARS = 120;
const MAX_CHARS = 200;

const SYSTEM = [
  "You predict the next message a developer will send to their coding agent.",
  "Reply with only that message, written as the developer would type it, in under 20 words.",
  "Make it a concrete next step that follows from the agent's answer: answer its question,",
  "approve its plan, or ask for the obvious follow-up (run the tests, open a PR, fix what it found).",
  "No quotes, no preamble. If there is no clear next step, reply with NONE.",
].join("\n");

/** The model's line, clean, or null when it has none to offer. */
function cleanNextPrompt(raw: string): string | null {
  const text = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean)
    ?.replace(/^(next (prompt|message)|user|developer)\s*:\s*/i, "")
    .replace(/^["'`“”]+|["'`“”]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || text.length < 2 || /^none\.?$/i.test(text)) return null;
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS - 1)}…` : text;
}

/** The newest user message and the turn's answer, or null when the turn has nothing to follow. */
function turnDigest(items: readonly TranscriptItem[]): { asked: string; answer: string } | null {
  const answer = turnAnswer(items);
  if (answer.failed || !answer.text) return null;
  let asked = "";
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    if (item.kind === "user") {
      asked = item.text;
      break;
    }
  }
  return { asked, answer: answer.text };
}

/** The browser's newest row is not the thread's yet (or it works): ask again later, nothing kept. */
class NotYet extends Error {}

async function generate(
  instance: HarnessInstance,
  nativeId: string,
  after: string,
): Promise<string | null> {
  const namer = app().codeBranchNamer;
  if (!namer) return null;
  const snapshot = await instance.getThread(nativeId);
  if (snapshot.thread.working || snapshot.items.at(-1)?.id !== after) throw new NotYet();
  // A question waiting on the owner is answered in its card, not the composer.
  if (snapshot.items.some((i) => i.kind === "request" && i.status === "open")) return null;
  const digest = turnDigest(snapshot.items);
  if (!digest) return null;
  const user = [
    `Thread: ${snapshot.thread.title.slice(0, TITLE_CHARS)}`,
    ...(digest.asked ? ["", "Developer:", digest.asked.trim().slice(-ASKED_CHARS)] : []),
    "",
    "Agent:",
    digest.answer.slice(-ANSWER_CHARS),
  ].join("\n");
  const answer = await namer.sideCaller.complete({
    role: "chat_title",
    system: SYSTEM,
    user,
    timeoutMs: TIMEOUT_MS,
    label: "Code next prompt",
  });
  return answer === undefined ? null : cleanNextPrompt(answer);
}

/**
 * The suggestion for a thread whose newest row is `after`: kept from the
 * first ask, so every later one is free. `after` is what the browser shows
 * as the newest row; a new row (a new turn) is a new suggestion.
 */
export function nextPrompt(
  instance: HarnessInstance,
  nativeId: string,
  threadId: string,
  after: string,
): Promise<string | null> {
  const kept = (app().codeNextPrompts ??= new Map());
  const key = `${threadId}\u0000${after}`;
  const hit = kept.get(key);
  if (hit) return hit;
  const pending = generate(instance, nativeId, after).catch((error: unknown) => {
    if (error instanceof NotYet) kept.delete(key);
    return null;
  });
  kept.set(key, pending);
  while (kept.size > KEEP) kept.delete(kept.keys().next().value!);
  return pending;
}
