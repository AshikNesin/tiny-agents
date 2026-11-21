import type { ImageContent, Message, TextContent } from "@earendil-works/pi-ai";
import { defineExtension, GenerationTask, hook, type Extension } from "@earendil-works/pi-durable";

const KEEP_IMAGES = 3;
const DROP_STEP = 10;

const KEEP_PAGE_READS = 2;
const PAGE_READ_STEP = 5;
const PAGE_READ_TOOLS = new Set([
  "browser_snapshot",
  "browser_read_text",
  "browser_navigate",
  "browser_back",
  "browser_click",
  "browser_type",
  "browser_press_key",
  "browser_wait_for",
  "browser_tabs",
]);
const SNAPSHOT_TOOLS = new Set(["browser_snapshot", "browser_read_text"]);
const LONG_READ_CHARS = 2_000;

export const CONTEXT_TRIM = "context-trim";

const DROPPED_NOTE: TextContent = {
  type: "text",
  text: "[Older screenshot left out to save context. Take a new one if you need to see the screen.]",
};

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
    if (drop === 0 || message.role !== "toolResult" || !isLongPageRead(message)) return message;
    drop--;
    const text = message.content.find((block): block is TextContent => block.type === "text");
    const first = text?.text.split("\n")[0];
    const kept: TextContent[] =
      first && !SNAPSHOT_TOOLS.has(message.toolName) ? [{ type: "text", text: first }] : [];
    return { ...message, content: [...kept, READ_DROPPED_NOTE] };
  });
}

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
