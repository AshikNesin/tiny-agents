/**
 * Only SHELLEY_URL is configured. Every request carries the headers a
 * Shelley run with `-require-header X-Exedev-Userid` (exe.dev's default)
 * demands, so it works over Tailscale without any other setting.
 */
import { describe, expect, it } from "vite-plus/test";
import {
  shelleyConfig,
  shelleyFetch,
  type FetchLike,
} from "../../../../apps/web/src/server/api/shelley/shelley.client";

/** Shelley's RequireHeaderMiddleware: any non-empty value passes. */
function requireHeader(name: string): { fetch: FetchLike; sent: Headers[] } {
  const sent: Headers[] = [];
  const fetch: FetchLike = async (_url, init) => {
    const headers = new Headers(init?.headers);
    sent.push(headers);
    return headers.get(name)
      ? new Response("{}", { status: 200 })
      : new Response(`missing required header: ${name}\n`, { status: 403 });
  };
  return { fetch, sent };
}

describe("Shelley client", () => {
  it("needs only SHELLEY_URL", () => {
    expect(shelleyConfig({})).toBeUndefined();
    expect(shelleyConfig({ SHELLEY_URL: " http://100.100.200.200:9999/ " })).toEqual({
      url: "http://100.100.200.200:9999",
    });
  });

  it("passes an exe.dev Shelley's require-header guard without any setting", async () => {
    const shelley = requireHeader("X-Exedev-Userid");
    const config = shelleyConfig({ SHELLEY_URL: "http://vm:9999" })!;
    const response = await shelleyFetch("/conversations", {}, { config, fetch: shelley.fetch });
    expect(response.status).toBe(200);
    expect(shelley.sent[0].get("x-exedev-userid")).toBeTruthy();
    expect(shelley.sent[0].get("x-shelley-request")).toBe("1");
  });
});
