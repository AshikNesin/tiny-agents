import type { ToolExecutionResult } from "@earendil-works/pi-durable";
import { Type } from "@earendil-works/pi-ai";
import type { Capability } from "../capabilities";
import { defineToolkit, tool } from "../toolkit";
import type { Transcriber } from "./vision-transcribe";

export interface VisionStore {
  image(
    conversationId: number,
    uploadId: string,
  ): Promise<
    { data: string; mimeType: string; name: string; width?: number; height?: number } | undefined
  >;
}

export { createTranscriber, type Transcriber } from "./vision-transcribe";

const ok = (text: string): ToolExecutionResult => ({ output: [{ type: "text", text }] });
const fail = (text: string): ToolExecutionResult => ({
  output: [{ type: "text", text }],
  isError: true,
});

export function createVisionToolkit(store: VisionStore, transcriber: Transcriber): Capability {
  const seeImage = tool({
    name: "see_image",
    label: "Looked at an image",
    askLabel: "look at an image",
    summary: "Transcribe an attached image through a vision model",
    policy: { readOnly: true },
    description:
      "See an image the owner attached. The image reaches you only as a filename and an id; " +
      "this tool sends it to a vision model and returns a faithful transcription you can reason about. " +
      "Call it for every image the owner asks about, before answering. Returns an error (you keep your " +
      "turn) when no vision model is available: then say plainly that you cannot see images.",
    parameters: Type.Object({
      uploadId: Type.String({
        minLength: 1,
        maxLength: 64,
        description:
          "Attachment id from the message, e.g. the id inside [image attached: name (id)]",
      }),
      question: Type.Optional(
        Type.String({
          maxLength: 2000,
          description: "Optional focus for the transcription; omit for a full description",
        }),
      ),
    }),
    replay: "unsafe",
    execute: async (args, api) => {
      const conversationId = Number(api.conversationId);
      const image = await store.image(conversationId, args.uploadId);
      if (!image) {
        return fail(
          `No image found for "${args.uploadId}". Use an attachment id from the owner's message.`,
        );
      }
      const question = args.question?.trim() || undefined;
      try {
        const answer = await transcriber.transcribe(
          {
            data: image.data,
            mimeType: image.mimeType,
            name: image.name,
            width: image.width,
            height: image.height,
          },
          question ? { question } : {},
        );
        return ok(answer || "(the vision model returned an empty description)");
      } catch (error) {
        return fail(
          `Could not see the image: ${error instanceof Error ? error.message : String(error)}. ` +
            "Tell the owner you cannot see images right now.",
        );
      }
    },
  });

  return defineToolkit({
    id: "vision",
    name: "Vision",
    description: "See attached images through a vision model (for models without native vision)",
    auto: true,
    tools: [seeImage],
    sections: [
      {
        key: "vision",
        render: () =>
          `## Vision\n\nYour model cannot see images. When the owner attaches one, their message lists it as ` +
          `[image attached: <name> (<uploadId>)]. Call see_image with that uploadId before answering anything ` +
          `about that image. If the tool errors, say plainly you cannot see images.`,
      },
    ],
  });
}
