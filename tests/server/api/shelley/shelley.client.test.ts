/**
 * Shelley started with `-require-header X-Exedev-Userid` (exe.dev's default)
 * answers 403 to requests without it; SHELLEY_HEADERS supplies it, and the
 * 403 says how.
 */
import { describe, expect, it } from "vite-plus/test";
import {
  parseShelleyHeaders,
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

describe("Shelley request headers", () => {
  it("parses Name: value pairs like Shelley's CLI -H, skipping malformed ones", () => {
    expect(
      parseShelleyHeaders(
        "X-Exedev-Userid: ashik; X-ExeDev-Email: me@example.com\nbad header: x;novalue:",
      ),
    ).toEqual({ "X-Exedev-Userid": "ashik", "X-ExeDev-Email": "me@example.com" });
    expect(parseShelleyHeaders(undefined)).toEqual({});
  });

  it("explains the 403 a require-header Shelley answers, then works once the header is set", async () => {
    const shelley = requireHeader("X-Exedev-Userid");
    const without = shelleyConfig({ SHELLEY_URL: "http://vm:9000" })!;
    await expect(
      shelleyFetch("/conversations", {}, { config: without, fetch: shelley.fetch }),
    ).rejects.toMatchObject({
      statusCode: 403,
      message: expect.stringContaining('Set SHELLEY_HEADERS="X-Exedev-Userid: <any value>"'),
    });

    const withHeader = shelleyConfig({
      SHELLEY_URL: "http://vm:9000",
      SHELLEY_HEADERS: "X-Exedev-Userid: ashik",
    })!;
    const response = await shelleyFetch(
      "/conversations",
      {},
      { config: withHeader, fetch: shelley.fetch },
    );
    expect(response.status).toBe(200);
    expect(shelley.sent.at(-1)?.get("x-exedev-userid")).toBe("ashik");
    expect(shelley.sent.at(-1)?.get("x-shelley-request")).toBe("1");
  });
});
