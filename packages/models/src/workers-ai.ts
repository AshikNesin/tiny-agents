import type { SystemOneTransport } from "@earendil-works/pi-ai/api/system-one-shared";

const LABEL = "Cloudflare AI Gateway (Workers AI)";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const workersAiTransport: SystemOneTransport = {
  api: "cloudflare-workers-ai-system-one",
  label: LABEL,
  detectCompat: (model) => ({
    imageInput: model.id.startsWith("@cf/cloudflare/clef") ? "images" : "assets",
    sendImageOptInHeader: false,
  }),
  url: (model) => new URL(`${model.baseUrl}/run`),
  payload: (model, request) => ({ model: model.id, input: request }),
  output: (body) => {
    if (!isRecord(body)) throw new Error(`${LABEL} returned an unexpected response`);
    if (body.success === false) {
      const messages = Array.isArray(body.errors)
        ? body.errors.flatMap((e) =>
            isRecord(e) && typeof e.message === "string" ? [e.message] : [],
          )
        : [];
      throw new Error(
        messages.length ? `${LABEL} error: ${messages.join("; ")}` : `${LABEL} request failed`,
      );
    }
    const result = body.result;
    if (!isRecord(result)) throw new Error(`${LABEL} returned an unexpected response`);
    if ("answers" in result) return result;
    if (result.state !== "Completed") {
      throw new Error(`${LABEL} run did not complete (state: ${String(result.state)})`);
    }
    if (!isRecord(result.result)) throw new Error(`${LABEL} returned an unexpected response`);
    return result.result;
  },
};
