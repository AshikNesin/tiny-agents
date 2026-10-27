/**
 * The `web` toolkit: search and read public pages through TinyFish.
 * Search (`GET https://api.search.tinyfish.ai`) and Fetch
 * (`POST https://api.fetch.tinyfish.ai`) are free; a key is still required
 * (`TINYFISH_API_KEY`, sent as `X-API-Key`). Until it is set, the toolkit
 * offers the model no tools.
 */
import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool, type ToolExecutionResult } from "@earendil-works/pi-durable";
import type { Capability } from "../capabilities";

export interface WebToolkitOptions {
  /** TinyFish API key. Search and Fetch stay hidden without it. */
  apiKey?: string;
  /** Override for tests. */
  fetch?: typeof fetch;
  /** Alternate Search API origin. */
  searchBase?: string;
  /** Alternate Fetch API origin. */
  fetchBase?: string;
}

/** Longest page text handed to the model. */
const MAX_PAGE_CHARS = 20_000;
const SEARCH_TIMEOUT_MS = 30_000;
/** Fetch's CDN ceiling is 120s; wait long enough to receive that error. */
const FETCH_TIMEOUT_MS = 150_000;

export type WebSource = { url: string; title: string };

const fail = (text: string): ToolExecutionResult => ({
  output: [{ type: "text", text }],
  isError: true,
});

/** Only public http(s) URLs: no credentials, localhost, private or link-local literals. */
export function checkPublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Not a valid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http(s) URLs can be fetched.");
  }
  if (url.username || url.password) throw new Error("URLs with credentials are not allowed.");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const privateHost =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^(127|10|0)\./.test(host) ||
    host.startsWith("192.168.") ||
    host.startsWith("169.254.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === "::1" ||
    /^f[cd][0-9a-f]{2}:/.test(host) ||
    host.startsWith("fe80:");
  if (privateHost) throw new Error("Private and local addresses can't be fetched.");
  return url;
}

type TinyFishError = { code?: string; message?: string };

function describeFailure(response: Response, json: unknown): string {
  const error =
    json && typeof json === "object" && "error" in json
      ? (json as { error?: TinyFishError | string }).error
      : undefined;
  if (error && typeof error === "object" && error.message) {
    const code = error.code ? ` (${error.code})` : "";
    return `TinyFish ${response.status}${code}: ${error.message}`;
  }
  if (typeof error === "string" && error) return `TinyFish ${response.status}: ${error}`;
  return `TinyFish ${response.status}: ${response.statusText || "request failed"}`;
}

export function createWebToolkit(options: WebToolkitOptions): Capability {
  const doFetch = options.fetch ?? fetch;
  const searchBase = (options.searchBase || "https://api.search.tinyfish.ai").replace(/\/+$/, "");
  const fetchBase = (options.fetchBase || "https://api.fetch.tinyfish.ai").replace(/\/+$/, "");
  const apiKey = options.apiKey?.trim() || undefined;
  const configured = Boolean(apiKey);

  async function tinyfish(url: string, init: { method: string; body?: string; timeoutMs: number }) {
    const response = await doFetch(url, {
      method: init.method,
      headers: {
        ...(apiKey ? { "X-API-Key": apiKey } : {}),
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body,
      signal: AbortSignal.timeout(init.timeoutMs),
    });
    const json = (await response.json().catch(() => undefined)) as unknown;
    if (!response.ok) throw new Error(describeFailure(response, json));
    if (!json || typeof json !== "object")
      throw new Error(`TinyFish ${response.status}: empty response`);
    return json;
  }

  const notConfigured = () => fail("Web tools are not configured: set TINYFISH_API_KEY.");

  const webSearch = defineTool({
    name: "web_search",
    description:
      "Search the web. Returns the top results with title, URL and a snippet. Use web_fetch to read a result.",
    parameters: Type.Object({
      query: Type.String({ minLength: 1, maxLength: 2000 }),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
    }),
    replay: "safe",
    execute: async (args) => {
      if (!configured) return notConfigured();
      try {
        const endpoint = new URL(searchBase);
        endpoint.searchParams.set("query", args.query);
        const result = (await tinyfish(endpoint.toString(), {
          method: "GET",
          timeoutMs: SEARCH_TIMEOUT_MS,
        })) as { results?: { url?: string; title?: string; snippet?: string }[] };
        const items = (result.results ?? []).filter((item) => item.url).slice(0, args.limit ?? 5);
        if (items.length === 0) return { output: [{ type: "text", text: "No results." }] };
        const sources: WebSource[] = items.map((item) => ({
          url: item.url!,
          title: item.title || item.url!,
        }));
        const text = items
          .map((item, i) =>
            `${i + 1}. ${item.title ?? item.url}\n${item.url}\n${item.snippet ?? ""}`.trim(),
          )
          .join("\n\n");
        return { output: [{ type: "text", text }], details: { sources } };
      } catch (error) {
        return fail(`Search failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  });

  const webFetch = defineTool({
    name: "web_fetch",
    description: "Read a public web page as markdown.",
    parameters: Type.Object({ url: Type.String({ minLength: 1 }) }),
    replay: "safe",
    execute: async (args) => {
      if (!configured) return notConfigured();
      let url: URL;
      try {
        url = checkPublicUrl(args.url);
      } catch (error) {
        return fail((error as Error).message);
      }
      try {
        const result = (await tinyfish(fetchBase, {
          method: "POST",
          // ttl 0 skips TinyFish's cache so the page is the one live now.
          body: JSON.stringify({ urls: [url.href], format: "markdown", ttl: 0 }),
          timeoutMs: FETCH_TIMEOUT_MS,
        })) as {
          results?: {
            url?: string;
            final_url?: string;
            title?: string | null;
            text?: string | null;
          }[];
          errors?: { url?: string; error?: string; status?: number }[];
        };
        const page = result.results?.find((item) => item.text) ?? result.results?.[0];
        const text = typeof page?.text === "string" ? page.text : "";
        if (!text.trim()) {
          const failure = result.errors?.[0];
          const why = failure?.error
            ? `${failure.error}${failure.status ? ` (${failure.status})` : ""}`
            : "no page text";
          return fail(`Fetch failed: ${why}`);
        }
        const clipped =
          text.length > MAX_PAGE_CHARS
            ? `${text.slice(0, MAX_PAGE_CHARS)}\n\n[truncated: ${text.length - MAX_PAGE_CHARS} more characters]`
            : text;
        const pageUrl = page?.final_url || url.href;
        const title = page?.title?.trim() || pageUrl;
        return {
          output: [{ type: "text", text: clipped }],
          details: { sources: [{ url: pageUrl, title }] },
        };
      } catch (error) {
        return fail(`Fetch failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  });

  return {
    id: "web",
    kind: "toolkit",
    name: "Web",
    description: "Search and read web pages",
    // Every bot has the web toolkit; until it is configured it offers the
    // model nothing rather than tools that can only fail.
    extension: defineExtension({ name: "web", tools: configured ? [webSearch, webFetch] : [] }),
    tools: [
      {
        name: "web_search",
        label: "Searched the web",
        description: "Search the web",
        readOnly: true,
      },
      {
        name: "web_fetch",
        label: "Read page",
        description: "Read a URL as markdown",
        readOnly: true,
      },
    ],
    ...(configured ? {} : { setupHint: "Set TINYFISH_API_KEY to enable web search." }),
  };
}
