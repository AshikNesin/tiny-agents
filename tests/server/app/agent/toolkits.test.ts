/** Built-in toolkits (issue #1 D15/D16): web search/fetch via TinyFish (faked), today's date. */
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ToolExecutionApi, ToolExecutionResult } from "@earendil-works/pi-durable";
import { describe, expect, it } from "vite-plus/test";
import type { Capability } from "../../../../packages/agent/src/capabilities";
import { createTodayCapability } from "../../../../packages/agent/src/toolkits/today";
import { checkPublicUrl } from "../../../../packages/agent/src/toolkits/public-url";
import { createWebToolkit } from "../../../../packages/agent/src/toolkits/web";

async function run(capability: Capability, name: string, args: Record<string, unknown>) {
  const tool = capability.extension.tools!.find((t) => t.name === name)!;
  const result = (await tool.execute(
    args as never,
    {} as ToolExecutionApi,
    BACKGROUND_CONTEXT,
  )) as ToolExecutionResult;
  const text = (result.output ?? []).map((b) => (b.type === "text" ? b.text : "")).join("");
  return { ...result, text };
}

type TinyFishCall = { url: string; method: string; body: unknown; apiKey: string };

function fakeTinyFish(result: unknown, calls: TinyFishCall[], status = 200) {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      apiKey: new Headers(init?.headers).get("x-api-key") ?? "",
    });
    return new Response(JSON.stringify(result), { status, statusText: "Payment Required" });
  }) as typeof fetch;
}

describe("web toolkit", () => {
  it("searches through TinyFish and returns sources", async () => {
    const calls: TinyFishCall[] = [];
    const web = createWebToolkit({
      apiKey: "tok",
      fetch: fakeTinyFish(
        {
          query: "pi durable",
          results: [
            {
              position: 1,
              site_name: "a.dev",
              title: "A",
              url: "https://a.dev",
              snippet: "about a",
            },
            {
              position: 2,
              site_name: "b.dev",
              title: "B",
              url: "https://b.dev",
              snippet: "about b",
            },
          ],
          total_results: 2,
          page: 0,
        },
        calls,
      ),
    });
    const result = await run(web, "web_search", { query: "pi durable", limit: 1 });
    expect(calls[0]).toMatchObject({
      url: "https://api.search.tinyfish.ai/?query=pi+durable",
      method: "GET",
      apiKey: "tok",
    });
    expect(result.text).toContain("https://a.dev");
    expect(result.text).not.toContain("https://b.dev");
    expect(result.details).toEqual({ sources: [{ url: "https://a.dev", title: "A" }] });
    expect(web.setupHint).toBeUndefined();
  });

  it("reports TinyFish's error code when search is rejected", async () => {
    const web = createWebToolkit({
      apiKey: "tok",
      fetch: fakeTinyFish(
        { error: { code: "FREE_ALLOWANCE_EXHAUSTED", message: "Daily free allowance used" } },
        [],
        402,
      ),
    });
    const result = await run(web, "web_search", { query: "iroh" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("FREE_ALLOWANCE_EXHAUSTED");
    expect(result.text).toContain("Daily free allowance used");
  });

  it("reads a page as markdown through TinyFish Fetch", async () => {
    const calls: TinyFishCall[] = [];
    const web = createWebToolkit({
      apiKey: "tok",
      fetch: fakeTinyFish(
        {
          results: [
            {
              url: "https://hello.dev/",
              final_url: "https://hello.dev/welcome",
              title: "Hello",
              text: "# Hello",
            },
          ],
          errors: [],
        },
        calls,
      ),
    });
    const result = await run(web, "web_fetch", { url: "https://hello.dev/" });
    expect(calls[0]).toMatchObject({
      url: "https://api.fetch.tinyfish.ai",
      method: "POST",
      body: { urls: ["https://hello.dev/"], format: "markdown", ttl: 0 },
      apiKey: "tok",
    });
    expect(result.text).toContain("# Hello");
    expect(result.details).toEqual({
      sources: [{ url: "https://hello.dev/welcome", title: "Hello" }],
    });
  });

  it("reports a per-URL fetch failure", async () => {
    const web = createWebToolkit({
      apiKey: "tok",
      fetch: fakeTinyFish(
        { results: [], errors: [{ url: "https://hello.dev/", error: "bot_blocked" }] },
        [],
      ),
    });
    const result = await run(web, "web_fetch", { url: "https://hello.dev/" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("bot_blocked");
  });

  it("refuses private URLs and reports missing configuration", async () => {
    expect(() => checkPublicUrl("http://localhost:3000")).toThrow(/Private/);
    expect(() => checkPublicUrl("http://192.168.1.4")).toThrow(/Private/);
    expect(() => checkPublicUrl("file:///etc/passwd")).toThrow(/http/);
    const calls: TinyFishCall[] = [];
    const web = createWebToolkit({
      apiKey: "tok",
      fetch: fakeTinyFish({}, calls),
    });
    const blocked = await run(web, "web_fetch", { url: "http://127.0.0.1/secret" });
    expect(blocked.isError).toBe(true);
    expect(calls).toEqual([]);
    const unconfigured = createWebToolkit({});
    expect(unconfigured.setupHint).toMatch(/TINYFISH_API_KEY/);
    // Every bot has the toolkit: unconfigured, it offers the model no tools.
    expect(unconfigured.extension.tools).toEqual([]);
  });
});

describe("today capability", () => {
  const render = (today: Capability) =>
    today.extension.sections![0]!.render({ conversationId: 1 } as never, BACKGROUND_CONTEXT);

  it("puts today's date in the owner's zone in the prompt, with no tools", async () => {
    const late = new Date("2026-10-23T20:00:00Z"); // already the 24th in India
    const today = createTodayCapability({ timeZone: "Asia/Kolkata", now: () => late });
    expect(today.extension.tools ?? []).toEqual([]);
    expect(today.auto).toBe(true);
    expect(await render(today)).toBe("Today is Saturday, 24 October 2026 (Asia/Kolkata).");
    const utc = createTodayCapability({ timeZone: "UTC", now: () => late });
    expect(await render(utc)).toBe("Today is Friday, 23 October 2026 (UTC).");
  });

  it("falls back to UTC for an unknown zone", async () => {
    const today = createTodayCapability({ timeZone: "Mars/Base", now: () => new Date(0) });
    expect(await render(today)).toContain("(UTC)");
  });
});
