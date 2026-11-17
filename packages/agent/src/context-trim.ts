/**
 * Context trim: what each model request leaves out of the stored
 * transcript, so a long conversation does not pay for the same bytes on
 * every request. The transcript itself is untouched (the chat still shows
 * every screenshot); only the copy sent to the model is trimmed.
 *
 * Old screenshots: a browser or computer session takes a screenshot on
 * almost every step, and each one would otherwise ride along on every later
 * request until compaction. Only the newest `KEEP_IMAGES` tool-result images
 * are sent; older ones become a one-line note. Images are dropped oldest
 * first in steps of `DROP_STEP`, so the request prefix changes once every
 * few screenshots instead of every step, and the provider's prompt cache
 * keeps working between drops. The approach of Anthropic's computer-use
 * reference loop (`only_n_most_recent_images`). Images the owner attached
 * to their own messages are never dropped.
 *
 * Old page reads: a browser snapshot is up to 20k characters (about 5k
 * tokens), and the agent takes one after nearly every action. Once the page
 * has been read again, the old one's refs are stale and its text rode along
 * on every request until compaction: 20 steps of browsing re-sent about
 * 100k tokens a request. Only the newest `KEEP_PAGE_READS` long reads are
 * sent; older ones become a one-line note, dropped in steps like images.
 */
import type { ImageContent, Message, TextContent } from "@earendil-works/pi-ai";
import { defineExtension, GenerationTask, hook, type Extension } from "@earendil-works/pi-durable";

/** Tool-result images every request keeps, newest first. */
const KEEP_IMAGES = 3;
/** Older images are dropped in steps of this many, so the prefix stays put between drops. */
const DROP_STEP = 10;

/** Long page reads (`PAGE_READ_TOOLS`) every request keeps, newest first. */
const KEEP_PAGE_READS = 2;
/** Older page reads are dropped in steps of this many. */
const PAGE_READ_STEP = 5;
/** Tools whose result is a read of the page as it was, superseded by the next read. */
const PAGE_READ_TOOLS = new Set(["browser_snapshot", "browser_read_text"]);
/** A read shorter than this costs less than the cache miss its drop would cause. */
const LONG_READ_CHARS = 2_000;

/** The extension name conversations select it by. */
export const CONTEXT_TRIM = "context-trim";

const DROPPED_NOTE: TextContent = {
  type: "text",
  text: "[Older screenshot left out to save context. Take a new one if you need to see the screen.]",
};

/**
 * The request's messages with all but the newest tool-result images
 * replaced by a note. Returns the input itself when nothing is dropped.
 */
function trimOldImages(
  messages: readonly Message[],
  keep: number = KEEP_IMAGES,
  step: number = DROP_STEP,
): readonly Message[] {
  let total = 0;
  for (const message of messages) {
    if (message.role !== "toolResult") continue;
    for (const block of message.content) if (block.type === "image") total++;
  }
  const over = total - keep;
  if (over < step) return messages;
  let drop = over - (over % step);
  return messages.map((message) => {
    if (drop === 0 || message.role !== "toolResult") return message;
    if (!message.content.some((block) => block.type === "image")) return message;
    const content: (TextContent | ImageContent)[] = [];
    for (const block of message.content) {
      if (block.type === "image" && drop > 0) {
        drop--;
        content.push(DROPPED_NOTE);
      } else content.push(block);
    }
    return { ...message, content };
  });
}

const READ_DROPPED_NOTE: TextContent = {
  type: "text",
  text: "[Older page read left out to save context; its refs are stale. Read the page again if you need it.]",
};

const isLongPageRead = (message: Message): boolean =>
  message.role === "toolResult" &&
  PAGE_READ_TOOLS.has(message.toolName) &&
  message.content.reduce((n, block) => n + (block.type === "text" ? block.text.length : 0), 0) >=
    LONG_READ_CHARS;

/**
 * The request's messages with all but the newest long page reads replaced
 * by a note, dropped oldest first in steps of `step` so the prompt prefix
 * stays put between drops. Returns the input itself when nothing is dropped.
 */
function trimOldPageReads(
  messages: readonly Message[],
  keep: number = KEEP_PAGE_READS,
  step: number = PAGE_READ_STEP,
): readonly Message[] {
  const total = messages.filter(isLongPageRead).length;
  const over = total - keep;
  if (over < step) return messages;
  let drop = over - (over % step);
  return messages.map((message) => {
    if (drop === 0 || !isLongPageRead(message)) return message;
    drop--;
    return { ...message, content: [READ_DROPPED_NOTE] } as Message;
  });
}

/** The always-on extension that applies the trim before every model request. */
export function createContextTrimExtension(): Extension {
  return defineExtension({
    name: CONTEXT_TRIM,
    hooks: [
      hook(GenerationTask, {
        beforeRequest: ({ messages }) => {
          const trimmed = trimOldPageReads(trimOldImages(messages));
          return trimmed === messages ? undefined : { messages: trimmed };
        },
      }),
    ],
  });
}
