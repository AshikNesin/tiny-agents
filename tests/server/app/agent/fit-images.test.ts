import { crc32, deflateSync } from "node:zlib";
import type { Context as PiContext } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { describe, expect, it } from "vite-plus/test";
import { until } from "../../fixtures/until";
import { finishedReplyTo } from "../../../../packages/agent/src/replies";
import { defineToolkit, tool } from "../../../../packages/agent/src/toolkit";
import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  openTestRuntime,
  TEST_MODEL,
} from "../../../../packages/agent/src/testing";

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.alloc(1 + width * 3, 0x80);
  row[0] = 0;
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const shotToolkit = defineToolkit({
  id: "shot",
  name: "Shot",
  description: "Screenshots",
  tools: [
    tool({
      name: "shot",
      label: "Took a screenshot",
      askLabel: "take a screenshot",
      summary: "Screenshot",
      description: "Take a screenshot",
      policy: { readOnly: true },
      parameters: Type.Object({}),
      replay: "safe",
      execute: async () => ({
        output: [{ type: "image", data: png(3000, 10).toString("base64"), mimeType: "image/png" }],
      }),
    }),
  ],
});

function widthOf(content: unknown): number {
  if (!Array.isArray(content)) return 0;
  const image = content.find((block) => block.type === "image");
  return image ? Buffer.from(image.data, "base64").readUInt32BE(16) : 0;
}

function respond(context: PiContext) {
  const last = context.messages.at(-1);
  if (last?.role === "user") {
    const width = widthOf(last.content);
    if (width > 0) return fauxAssistantMessage(fauxText(`WIDTH:${width}`));
  }
  if (last?.role !== "toolResult") {
    return { ...fauxAssistantMessage(fauxToolCall("shot", {})), stopReason: "toolUse" as const };
  }
  return fauxAssistantMessage(fauxText(`WIDTH:${widthOf(last.content)}`));
}

describe("images entering a conversation", () => {
  it("fits a tool's oversized screenshot to the model's limits before the model sees it", async () => {
    const runtime = await openTestRuntime({
      storePath: ":memory:",
      capabilities: [shotToolkit],
      respondWith: respond,
    });
    try {
      const ref = await runtime.createConversation({
        modelId: TEST_MODEL,
        systemPrompt: "",
        capabilities: { enabled: ["shot"], permissions: {} },
      });
      await runtime.submit(ref, { requestId: "one", text: "take a screenshot" });
      const reply = await until(async () => {
        const found = finishedReplyTo(await runtime.readChat(ref), "one");
        return found.status === "answered" ? found : undefined;
      }, "the reply");
      expect(reply.reply.text).toBe("WIDTH:2000");
    } finally {
      await runtime.close();
    }
  });

  it("fits an oversized photo the owner sends before the model sees it", async () => {
    const runtime = await openTestRuntime({ storePath: ":memory:", respondWith: respond });
    try {
      const ref = await runtime.createConversation({ modelId: TEST_MODEL, systemPrompt: "" });
      await runtime.submit(ref, {
        requestId: "photo",
        text: "what is this?",
        images: [{ data: png(3000, 10).toString("base64"), mimeType: "image/png" }],
      });
      const reply = await until(async () => {
        const found = finishedReplyTo(await runtime.readChat(ref), "photo");
        return found.status === "answered" ? found : undefined;
      }, "the reply");
      expect(reply.reply.text).toBe("WIDTH:2000");
    } finally {
      await runtime.close();
    }
  });
});
