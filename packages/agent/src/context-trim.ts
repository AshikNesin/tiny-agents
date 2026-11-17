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
 */
import type { ImageContent, Message, TextContent } from "@earendil-works/pi-ai";
import { defineExtension, GenerationTask, hook, type Extension } from "@earendil-works/pi-durable";

/** Tool-result images every request keeps, newest first. */
const KEEP_IMAGES = 3;
/** Older images are dropped in steps of this many, so the prefix stays put between drops. */
const DROP_STEP = 10;

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

/** The always-on extension that applies the trim before every model request. */
export function createContextTrimExtension(): Extension {
  return defineExtension({
    name: CONTEXT_TRIM,
    hooks: [
      hook(GenerationTask, {
        beforeRequest: ({ messages }) => {
          const trimmed = trimOldImages(messages);
          return trimmed === messages ? undefined : { messages: trimmed };
        },
      }),
    ],
  });
}
