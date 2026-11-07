/** The `vision` toolkit (issue #17): see_image side-call, fail-open, store lookup. */
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ToolExecutionApi, ToolExecutionResult } from "@earendil-works/pi-durable";
import { describe, expect, it, vi } from "vite-plus/test";
import type { Capability } from "../../../../packages/agent/src/capabilities";
import { createVisionToolkit } from "../../../../packages/agent/src/toolkits/vision";
import type { Transcriber } from "../../../../packages/agent/src/toolkits/vision-transcribe";

const IMAGE = {
  data: "aGVsbG8=",
  mimeType: "image/png",
  name: "shot.png",
  width: 800,
  height: 600,
};

function toolkit(
  transcriber: Transcriber,
  image = IMAGE,
): { capability: Capability; seen: { conversationId: number; uploadId: string }[] } {
  const seen: { conversationId: number; uploadId: string }[] = [];
  const capability = createVisionToolkit(
    {
      image: async (conversationId, uploadId) => {
        seen.push({ conversationId, uploadId });
        return uploadId === "missing" ? undefined : image;
      },
    },
    transcriber,
  );
  return { capability, seen };
}

async function run(capability: Capability, args: Record<string, unknown>) {
  const tool = capability.extension.tools!.find((t) => t.name === "see_image")!;
  const api = { conversationId: 42 } as ToolExecutionApi;
  const result = (await tool.execute(
    args as never,
    api,
    BACKGROUND_CONTEXT,
  )) as ToolExecutionResult;
  const text = (result.output ?? []).map((b) => (b.type === "text" ? b.text : "")).join("");
  return { isError: Boolean(result.isError), text };
}

describe("see_image", () => {
  it("returns the transcription for a known upload", async () => {
    const transcriber: Transcriber = {
      transcribe: vi.fn().mockResolvedValue("A screenshot of a settings page."),
      modelId: () => "vision-model",
    };
    const { capability, seen } = toolkit(transcriber);
    const result = await run(capability, { uploadId: "u1" });
    expect(result.isError).toBe(false);
    expect(result.text).toContain("settings page");
    expect(seen).toEqual([{ conversationId: 42, uploadId: "u1" }]);
    expect(transcriber.transcribe).toHaveBeenCalledWith(IMAGE, {});
  });

  it("passes a focused question through", async () => {
    const transcriber: Transcriber = {
      transcribe: vi.fn().mockResolvedValue("An error dialog."),
      modelId: () => undefined,
    };
    const { capability } = toolkit(transcriber);
    await run(capability, { uploadId: "u1", question: "what error is shown?" });
    expect(transcriber.transcribe).toHaveBeenCalledWith(IMAGE, {
      question: "what error is shown?",
    });
  });

  it("fails open with the reason when the transcriber errors", async () => {
    const transcriber: Transcriber = {
      transcribe: vi.fn().mockRejectedValue(new Error("no vision model is configured")),
      modelId: () => undefined,
    };
    const { capability } = toolkit(transcriber);
    const result = await run(capability, { uploadId: "u1" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("no vision model is configured");
    expect(result.text).toContain("cannot see images");
  });

  it("reports unknown attachment ids as an error, not a crash", async () => {
    const transcriber: Transcriber = {
      transcribe: vi.fn(),
      modelId: () => undefined,
    };
    const { capability } = toolkit(transcriber);
    const result = await run(capability, { uploadId: "missing" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("No image found");
    expect(transcriber.transcribe).not.toHaveBeenCalled();
  });

  it("is a read-only toolkit so see_image defaults to allow", () => {
    const transcriber: Transcriber = {
      transcribe: vi.fn(),
      modelId: () => undefined,
    };
    const { capability } = toolkit(transcriber);
    const tool = capability.tools.find((t) => t.name === "see_image")!;
    expect(tool.readOnly).toBe(true);
    expect(tool.askOnly).toBeUndefined();
  });
});
