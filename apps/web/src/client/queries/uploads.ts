import { keepPreviousData } from "@tanstack/react-query";
import { botsApi } from "../lib/bots-api";
import { useResource } from "./resource";

const POLL_MS = 2_000;
const MAX_POLLS = 90;

export const useUploadExtraction = (uploadId: string, options: { enabled: boolean }) =>
  useResource(
    ["uploads", "status", uploadId],
    () => botsApi.uploadStatus(uploadId),
    "Failed to load the file status",
    {
      ...options,
      refetchInterval: ({ state }) => {
        const settled = state.data !== undefined && state.data.status !== "pending";
        const polls = state.dataUpdateCount + state.errorUpdateCount;
        return settled || polls >= MAX_POLLS ? false : POLL_MS;
      },
    },
  );

export const useUploadText = (uploadId: string, page: number, sheet: number) =>
  useResource(
    ["uploads", "text", uploadId, page, sheet],
    () => botsApi.uploadText(uploadId, { page, sheet }),
    "The preview could not be loaded.",
    { placeholderData: keepPreviousData },
  );
