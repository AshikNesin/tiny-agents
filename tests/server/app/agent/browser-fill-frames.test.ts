import { describe, expect, it } from "vite-plus/test";
import type { Frame, Page } from "playwright-core";
import { fillSecretFields } from "../../../../packages/sandbox/src/browser-fill";
import { SecretValue } from "../../../../packages/agent/src/vault";

const CANARY = "canary-pw-frames-31";

interface Sent {
  frameUrl: string;
  value: string;
  allowed: string[];
}

function fakePage(frames: { url: string; result: "filled" | "origin" | "missing" }[]) {
  const sent: Sent[] = [];
  const asFrame = (url: string, result: "filled" | "origin" | "missing"): Frame =>
    ({
      url: () => url,
      evaluate: async (_fn: unknown, args: { value: string; allowed: string[] }) => {
        sent.push({ frameUrl: url, value: args.value, allowed: args.allowed });
        return result;
      },
    }) as unknown as Frame;
  const frameObjects = frames.map((frame) => asFrame(frame.url, frame.result));
  const page = {
    evaluate: async () => frames[0]!.url.replace(/\/page$/, ""),
    mainFrame: () => frameObjects[0],
    frames: () => frameObjects,
  } as unknown as Page;
  return { page, sent, origin: frames[0]!.url.replace(/\/page$/, "") };
}

describe("fillPass hands the secret only to frames the item allows", () => {
  const field = {
    key: "password",
    autocomplete: "current-password" as const,
    value: new SecretValue(CANARY),
  };

  it("never evaluates in a cross-origin frame the item does not allow", async () => {
    const { page, sent, origin } = fakePage([
      { url: "https://shop.example/page", result: "missing" },
      { url: "https://evil.example/frame", result: "filled" },
    ]);
    const result = await fillSecretFields(page, {
      origin,
      fields: [field],
    });
    expect(result.filled).toEqual([]);
    expect(sent.map((entry) => entry.frameUrl)).toEqual(["https://shop.example/page"]);
    expect(sent[0]!.value).toBe(CANARY);
  });

  it("fills an allowlisted frame origin and passes the secret only there", async () => {
    const { page, sent, origin } = fakePage([
      { url: "https://shop.example/page", result: "missing" },
      { url: "https://id.shop.example/frame", result: "filled" },
    ]);
    const result = await fillSecretFields(page, {
      origin,
      frameOrigins: ["https://id.shop.example"],
      fields: [field],
    });
    expect(result.filled).toEqual(["password"]);
    expect(sent.map((entry) => entry.frameUrl)).toEqual([
      "https://shop.example/page",
      "https://id.shop.example/frame",
    ]);
  });
});
