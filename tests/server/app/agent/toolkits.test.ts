/** Built-in toolkits (issue #1 D15/D16): web search/fetch via Cloudflare (faked), today's date. */
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ToolExecutionApi, ToolExecutionResult } from "@earendil-works/pi-durable";
import { describe, expect, it } from "vite-plus/test";
import type { Capability } from "../../../../packages/agent/src/capabilities";
import { createTodayCapability } from "../../../../packages/agent/src/toolkits/today";
import { checkPublicUrl, createWebToolkit } from "../../../../packages/agent/src/toolkits/web";

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

function fakeCloudflare(result: unknown, calls: { url: string; body: unknown; auth: string }[]) {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body)),
      auth: new Headers(init?.headers).get("authorization") ?? "",
    });
    return new Response(JSON.stringify({ success: true, result }), { status: 200 });
  }) as typeof fetch;
}

describe("web toolkit", () => {
  it("searches through the Cloudflare Web Search API and returns sources", async () => {
    const calls: { url: string; body: unknown; auth: string }[] = [];
    const web = createWebToolkit({
      accountId: "acc",
      apiToken: "tok",
      gatewayId: "gw",
      fetch: fakeCloudflare(
        { items: [{ url: "https://a.dev", title: "A", description: "about a" }] },
        calls,
      ),
    });
    const result = await run(web, "web_search", { query: "pi durable" });
    expect(calls[0]).toMatchObject({
      url: "https://api.cloudflare.com/client/v4/accounts/acc/ai/websearch/",
      body: { query: "pi durable", limit: 5, options: { gateway: { id: "gw" } } },
      auth: "Bearer tok",
    });
    expect(result.text).toContain("https://a.dev");
    expect(result.details).toEqual({ sources: [{ url: "https://a.dev", title: "A" }] });
    expect(web.setupHint).toBeUndefined();
  });

  it("reads a page as markdown through Browser Rendering", async () => {
    const calls: { url: string; body: unknown; auth: string }[] = [];
    const web = createWebToolkit({
      accountId: "acc",
      apiToken: "tok",
      fetch: fakeCloudflare("---\ntitle: Hello\n---\n# Hello", calls),
    });
    const result = await run(web, "web_fetch", { url: "https://hello.dev/" });
    expect(calls[0].url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acc/browser-rendering/markdown",
    );
    expect(result.text).toContain("# Hello");
    expect(result.details).toEqual({ sources: [{ url: "https://hello.dev/", title: "Hello" }] });
  });

  it("refuses private URLs and reports missing configuration", async () => {
    expect(() => checkPublicUrl("http://localhost:3000")).toThrow(/Private/);
    expect(() => checkPublicUrl("http://192.168.1.4")).toThrow(/Private/);
    expect(() => checkPublicUrl("file:///etc/passwd")).toThrow(/http/);
    const web = createWebToolkit({});
    expect(web.setupHint).toMatch(/CLOUDFLARE_API_KEY/);
    // Every bot has the toolkit: unconfigured, it offers the model no tools.
    expect(web.extension.tools).toEqual([]);
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
