/**
 * Context trim: a browser or computer session's old screenshots are not
 * re-sent on every later request. Drives a real runtime whose tool returns a
 * screenshot each step and reads what the model was sent.
 */
import { describe, expect, it } from "vite-plus/test";
import type { Context as PiContext } from "@earendil-works/pi-ai";
import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { until } from "../../fixtures/until";
import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  openTestRuntime,
  TEST_MODEL,
} from "../../../../packages/agent/src/testing";

const PIXEL =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const screenshot = defineExtension({
  name: "screens",
  tools: [
    defineTool({
      name: "screenshot",
      description: "Take a screenshot",
      parameters: Type.Object({}),
      replay: "safe",
      execute: async () => ({
        output: [
          { type: "text", text: "Screen:" },
          { type: "image", data: PIXEL, mimeType: "image/png" },
        ],
      }),
    }),
  ],
});

/** A browser that reads a long page each step, as `browser_snapshot` does. */
const pageReads = defineExtension({
  name: "pages",
  tools: [
    defineTool({
      name: "browser_snapshot",
      description: "Read the page",
      parameters: Type.Object({}),
      replay: "safe",
      execute: async () => ({ output: [{ type: "text", text: `- text: ${"x".repeat(5_000)}` }] }),
    }),
  ],
});

/** A click whose result carries the page after it, as `browser_click` does. */
const clicks = defineExtension({
  name: "clicks",
  tools: [
    defineTool({
      name: "browser_click",
      description: "Click",
      parameters: Type.Object({}),
      replay: "safe",
      execute: async () => ({
        output: [
          { type: "text", text: `clicked e3 — https://example.com/\nPage:\n${"x".repeat(5_000)}` },
        ],
      }),
    }),
  ],
});

function counts(context: PiContext) {
  let toolResults = 0;
  let images = 0;
  let userImages = 0;
  for (const message of context.messages) {
    if (message.role === "toolResult") {
      toolResults++;
      images += message.content.filter((block) => block.type === "image").length;
    }
    if (message.role === "user" && typeof message.content !== "string") {
      userImages += message.content.filter((block) => block.type === "image").length;
    }
  }
  return { toolResults, images, userImages };
}

describe("context trim", () => {
  it("sends only the newest screenshots, dropping old ones ten at a time, and keeps the owner's images", async () => {
    const seen: { toolResults: number; images: number; userImages: number }[] = [];
    const runtime = await openTestRuntime({
      storePath: ":memory:",
      extensions: [screenshot],
      respondWith: (context) => {
        const now = counts(context);
        seen.push(now);
        if (now.toolResults < 14) {
          return {
            ...fauxAssistantMessage(fauxToolCall("screenshot", {})),
            stopReason: "toolUse" as const,
          };
        }
        return fauxAssistantMessage(fauxText("done"));
      },
    });
    try {
      const ref = await runtime.createConversation({ modelId: TEST_MODEL, systemPrompt: "" });
      await runtime.submit(ref, {
        requestId: "shots",
        text: "look around",
        images: [{ data: PIXEL, mimeType: "image/png" }],
      });
      await until(() => seen.length === 15 && !runtime.isBusy(ref), "the run to finish");

      // Request n carries n-1 screenshots. Up to 12 (3 kept + fewer than 10
      // over) all are sent; at 13 the oldest 10 drop at once, leaving 3, and
      // the prefix then stays put until 10 more pile up.
      expect(seen.map((s) => s.images)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 3, 4]);
      // Dropped images leave their tool results (and a note) in place.
      expect(seen[14].toolResults).toBe(14);
      // The owner's attached image is never dropped.
      expect(seen.every((s) => s.userImages === 1)).toBe(true);
    } finally {
      await runtime.close();
    }
  });

  it("sends only the newest page reads, dropping old ones five at a time", async () => {
    const seen: number[] = [];
    const runtime = await openTestRuntime({
      storePath: ":memory:",
      extensions: [pageReads],
      respondWith: (context) => {
        const results = context.messages.filter((m) => m.role === "toolResult");
        const full = results.filter((m) =>
          m.content.some((block) => block.type === "text" && block.text.length >= 5_000),
        ).length;
        seen.push(full);
        if (results.length < 9) {
          return {
            ...fauxAssistantMessage(fauxToolCall("browser_snapshot", {})),
            stopReason: "toolUse" as const,
          };
        }
        return fauxAssistantMessage(fauxText("done"));
      },
    });
    try {
      const ref = await runtime.createConversation({ modelId: TEST_MODEL, systemPrompt: "" });
      await runtime.submit(ref, { requestId: "reads", text: "browse" });
      await until(() => seen.length === 10 && !runtime.isBusy(ref), "the run to finish");

      // Request n carries n-1 reads. Up to 6 (2 kept + fewer than 5 over)
      // all are sent; at 7 the oldest 5 drop at once, leaving 2.
      expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6, 2, 3, 4]);
    } finally {
      await runtime.close();
    }
  });

  it("keeps the first line of an old action's result and drops the page it returned", async () => {
    let last: PiContext | undefined;
    const runtime = await openTestRuntime({
      storePath: ":memory:",
      extensions: [clicks],
      respondWith: (context) => {
        last = context;
        if (context.messages.filter((m) => m.role === "toolResult").length < 7) {
          return {
            ...fauxAssistantMessage(fauxToolCall("browser_click", {})),
            stopReason: "toolUse" as const,
          };
        }
        return fauxAssistantMessage(fauxText("done"));
      },
    });
    try {
      const ref = await runtime.createConversation({ modelId: TEST_MODEL, systemPrompt: "" });
      await runtime.submit(ref, { requestId: "clicks", text: "click around" });
      await until(() => !runtime.isBusy(ref) && last !== undefined, "the run to finish");
      const results = last!.messages.filter((m) => m.role === "toolResult");
      const texts = results.map((m) =>
        m.content.map((block) => (block.type === "text" ? block.text : "")).join("|"),
      );
      // 7 results: the oldest 5 dropped at once, the newest 2 whole.
      expect(texts.slice(0, 5)).toEqual(
        Array(5).fill(
          "clicked e3 — https://example.com/|[Older page read left out to save context; its refs are stale. Read the page again if you need it.]",
        ),
      );
      expect(texts.slice(5).every((t) => t.length > 5_000)).toBe(true);
    } finally {
      await runtime.close();
    }
  });
});
