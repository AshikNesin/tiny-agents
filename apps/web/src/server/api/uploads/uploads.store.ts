/**
 * VisionStore adapter: see_image resolves upload ids to prepared bytes.
 * An id is valid only for sends into that conversation (issue #17), so a
 * bot cannot reach into another chat's images.
 */
import type { VisionStore } from "@tiny-agents/agent";
import { modelImage } from "./uploads.service";

export function createVisionStore(rt: {
  attachmentIds(conversationId: number): Promise<string[]>;
}): VisionStore {
  return {
    image: async (conversationId, uploadId) => {
      const ids = await rt.attachmentIds(conversationId);
      if (!ids.includes(uploadId)) return undefined;
      return modelImage(uploadId);
    },
  };
}
