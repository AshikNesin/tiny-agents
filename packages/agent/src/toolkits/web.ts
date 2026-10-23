/**
 * The `web` toolkit (issue #1 D16): search and read the web through the
 * Cloudflare account inference already uses — no new vendor.
 *
 * - `web_search` → Cloudflare Web Search API (default backend Ceramic),
 *   `POST /accounts/{id}/ai/websearch/`.
 * - `web_fetch` → Browser Rendering `/markdown`, which renders the page in
 *   Cloudflare's browser (JS-heavy pages work; nothing is fetched from here).
 *
 * Both need a Cloudflare API token with Workers AI Read, AI Gateway Read and
 * Browser Rendering Write (`CLOUDFLARE_API_KEY`) plus `CLOUDFLARE_ACCOUNT_ID`.
 */
import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool, type ToolExecutionResult } from "@earendil-works/pi-durable";
import type { Capability } from "../capabilities";

export interface WebToolkitOptions {
  accountId?: string;
  apiToken?: string;
  /** AI Gateway id: searches are logged/billed through it when set. */
  gatewayId?: string;
  /** Override for tests. */
  fetch?: typeof fetch;
  /** Alternate front door for the Cloudflare REST API (a proxy that injects the token). */
  apiBase?: string;
}

/** Longest page text handed to the model. */
const MAX_PAGE_CHARS = 20_000;

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

export function createWebToolkit(options: WebToolkitOptions): Capability {
  const doFetch = options.fetch ?? fetch;
  const base = (options.apiBase || "https://api.cloudflare.com/client/v4").replace(/\/+$/, "");
  // An alternate front door (proxy) injects the token itself.
  const configured = Boolean(options.accountId && (options.apiToken || options.apiBase));

  async function cloudflare(path: string, body: unknown): Promise<unknown> {
    const response = await doFetch(`${base}/accounts/${options.accountId}${path}`, {
      method: "POST",
      headers: {
        ...(options.apiToken ? { Authorization: `Bearer ${options.apiToken}` } : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    const json = (await response.json().catch(() => undefined)) as
      | { success?: boolean; result?: unknown; errors?: { message?: string }[] }
      | undefined;
    if (!response.ok || json?.success === false) {
      const message = json?.errors?.map((e) => e.message).join("; ") || response.statusText;
      throw new Error(`Cloudflare ${response.status}: ${message}`);
    }
    return json?.result ?? json;
  }

  const notConfigured = () =>
    fail("Web tools are not configured: set CLOUDFLARE_API_KEY and CLOUDFLARE_ACCOUNT_ID.");

  const webSearch = defineTool({
    name: "web_search",
    description:
      "Search the web. Returns the top results with title, URL and a description. Use web_fetch to read a result.",
    parameters: Type.Object({
      query: Type.String({ minLength: 1, maxLength: 1024 }),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
    }),
    replay: "safe",
    execute: async (args) => {
      if (!configured) return notConfigured();
      try {
        const result = (await cloudflare("/ai/websearch/", {
          query: args.query,
          limit: args.limit ?? 5,
          ...(options.gatewayId ? { options: { gateway: { id: options.gatewayId } } } : {}),
        })) as { items?: { url?: string; title?: string; description?: string }[] };
        const items = (result.items ?? []).filter((item) => item.url);
        if (items.length === 0) return { output: [{ type: "text", text: "No results." }] };
        const sources: WebSource[] = items.map((item) => ({
          url: item.url!,
          title: item.title || item.url!,
        }));
        const text = items
          .map((item, i) =>
            `${i + 1}. ${item.title ?? item.url}\n${item.url}\n${item.description ?? ""}`.trim(),
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
        const result = await cloudflare("/browser-rendering/markdown", { url: url.href });
        const markdown = typeof result === "string" ? result : JSON.stringify(result);
        const clipped =
          markdown.length > MAX_PAGE_CHARS
            ? `${markdown.slice(0, MAX_PAGE_CHARS)}\n\n[truncated: ${markdown.length - MAX_PAGE_CHARS} more characters]`
            : markdown;
        const title = markdown.match(/^title:\s*(.+)$/m)?.[1]?.trim() ?? url.href;
        return {
          output: [{ type: "text", text: clipped }],
          details: { sources: [{ url: url.href, title }] },
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
    ...(configured
      ? {}
      : { setupHint: "Set CLOUDFLARE_API_KEY and CLOUDFLARE_ACCOUNT_ID to enable web search." }),
  };
}
