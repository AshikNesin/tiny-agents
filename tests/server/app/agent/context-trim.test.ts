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
});
