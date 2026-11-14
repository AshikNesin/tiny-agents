/**
 * The `web` toolkit: search and read public pages through TinyFish.
 * Search (`GET https://api.search.tinyfish.ai`) and Fetch
 * (`POST https://api.fetch.tinyfish.ai`) are free; a key is still required
 * (`TINYFISH_API_KEY`, sent as `X-API-Key`). Until it is set, search and
 * fetch stay hidden.
 *
 * `http_request` (issue #56) is a request this server makes itself, never
 * through TinyFish, so a vault API key (`auth: <handle>`) only ever reaches
 * the hosts its item allows. Offered once the app gives the toolkit a vault.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Type } from "@earendil-works/pi-ai";
import type { ToolExecutionResult } from "@earendil-works/pi-durable";
import type { Capability } from "../capabilities";
import { defineToolkit, tool } from "../toolkit";
import { VAULT_RULE, type VaultBroker } from "../vault";
import { checkPublicUrl, isPrivateAddress } from "@tiny-agents/sandbox";
import { safeMessage, useFromSink, vaultGatePlan } from "./vault";

export interface WebToolkitOptions {
  /** TinyFish API key. Search and Fetch stay hidden without it. */
  apiKey?: string;
  /** Override for tests. */
  fetch?: typeof fetch;
  /** Alternate Search API origin. */
  searchBase?: string;
  /** Alternate Fetch API origin. */
  fetchBase?: string;
  /** The vault broker: enables `http_request` and its `auth` handles. */
  vault?: VaultBroker;
  /** Resolve a hostname for the private-address check (tests). */
  resolveHost?: (hostname: string) => Promise<string[]>;
}

/** Longest page text handed to the model. */
const MAX_PAGE_CHARS = 20_000;
const SEARCH_TIMEOUT_MS = 30_000;
/** Fetch's CDN ceiling is 120s; wait long enough to receive that error. */
const FETCH_TIMEOUT_MS = 150_000;

type WebSource = { url: string; title: string };

const fail = (text: string): ToolExecutionResult => ({
  output: [{ type: "text", text }],
  isError: true,
});

const defaultResolve = async (hostname: string) =>
  (await lookup(hostname, { all: true })).map((entry) => entry.address);

/** Longest response body read, and the part handed to the model. */
const MAX_HTTP_BYTES = 1_000_000;
const HTTP_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;
/** Headers the model may not set: the vault and the server own them. */
const RESERVED_HEADERS = new Set([
  "authorization",
  "cookie",
  "host",
  "proxy-authorization",
  "x-api-key",
  "content-length",
]);

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

  const webSearch = tool({
    name: "web_search",
    label: "Searched the web",
    askLabel: "search the web",
    summary: "Search the web",
    policy: { readOnly: true },
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

  const webFetch = tool({
    name: "web_fetch",
    label: "Read page",
    askLabel: "read a page",
    summary: "Read a URL as markdown",
    policy: { readOnly: true },
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

  const resolveHost = options.resolveHost ?? defaultResolve;
  /** The URL, checked again after DNS: a public name must not resolve to a private address. */
  async function publicTarget(raw: string): Promise<URL> {
    const url = checkPublicUrl(raw);
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(host) ? [host] : await resolveHost(host).catch(() => []);
    if (addresses.length === 0) throw new Error(`Could not resolve ${url.hostname}.`);
    if (addresses.some(isPrivateAddress)) {
      throw new Error("Private and local addresses can't be requested.");
    }
    return url;
  }

  const broker = options.vault;
  const httpRequest = broker
    ? tool({
        name: "http_request",
        label: "Called an API",
        askLabel: "call an API",
        summary: "Make an HTTP request, optionally with a vault API key",
        vault: true,
        description:
          "Make an HTTP request from the server to a public API and read the response. " +
          "To authenticate, pass `auth` with a vault handle (see vault_list): the server adds the " +
          "key as a header, only for the hosts its item allows, and you never see it. " +
          "Use web_fetch to read pages. " +
          VAULT_RULE,
        parameters: Type.Object({
          url: Type.String({ minLength: 8, maxLength: 2000 }),
          method: Type.Optional(
            Type.Union(
              ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].map((m) => Type.Literal(m)),
            ),
          ),
          headers: Type.Optional(
            Type.Record(Type.String({ maxLength: 100 }), Type.String({ maxLength: 2000 })),
          ),
          body: Type.Optional(Type.String({ maxLength: 100_000 })),
          auth: Type.Optional(
            Type.String({ minLength: 1, maxLength: 64, description: "Vault handle" }),
          ),
        }),
        replay: "unsafe",
        gate: vaultGatePlan(broker, true, async (args: { url: string; auth?: string }) => {
          if (!args.auth) return undefined;
          let host: string;
          try {
            host = new URL(args.url).host;
          } catch {
            return { refuse: `Not a valid URL: ${args.url}` };
          }
          return { handle: args.auth, tool: "http_request", targetKind: "host", target: host };
        }),
        execute: async (args, api, context) => {
          let url: URL;
          try {
            url = await publicTarget(args.url);
          } catch (error) {
            return fail((error as Error).message);
          }
          const headers: Record<string, string> = {};
          for (const [name, value] of Object.entries(args.headers ?? {})) {
            if (RESERVED_HEADERS.has(name.toLowerCase())) {
              return fail(`The ${name} header can't be set; pass a vault handle as auth instead.`);
            }
            headers[name] = value;
          }
          const send = (auth?: { name: string; value: string }) =>
            requestFollowingRedirects(url, args.method ?? "GET", headers, args.body, auth);
          try {
            const response = args.auth
              ? await useFromSink(
                  broker,
                  api,
                  context,
                  {
                    handle: args.auth,
                    tool: "http_request",
                    targetKind: "host",
                    target: url.host,
                  },
                  ["value"],
                  async (values, item) => {
                    const inject = item.inject ?? {
                      as: "header" as const,
                      name: "Authorization",
                      format: "Bearer {value}",
                    };
                    const value = values.value?.reveal() ?? "";
                    return send({
                      name: inject.name,
                      value: inject.format.includes("{value}")
                        ? inject.format.split("{value}").join(value)
                        : value,
                    });
                  },
                )
              : await send();
            return response;
          } catch (error) {
            if (error instanceof Error && error.name === "HttpRequestError") {
              return fail(error.message);
            }
            return fail(args.auth ? safeMessage(error) : `Request failed: ${describeError(error)}`);
          }
        },
      })
    : undefined;

  /**
   * One request with manual redirects: every hop is re-checked against the
   * private-address rules, and the vault header is dropped on any hop that
   * leaves the original host.
   */
  async function requestFollowingRedirects(
    start: URL,
    method: string,
    headers: Record<string, string>,
    body: string | undefined,
    auth?: { name: string; value: string },
  ): Promise<ToolExecutionResult> {
    let url = start;
    let currentMethod = method;
    let currentBody = body;
    for (let hop = 0; ; hop++) {
      const sameHost = url.host === start.host;
      const response = await doFetch(url.href, {
        method: currentMethod,
        headers: { ...headers, ...(auth && sameHost ? { [auth.name]: auth.value } : {}) },
        body: currentMethod === "GET" || currentMethod === "HEAD" ? undefined : currentBody,
        redirect: "manual",
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        if (hop >= MAX_REDIRECTS) throw httpError("Too many redirects.");
        try {
          url = await publicTarget(new URL(location, url).href);
        } catch (error) {
          throw httpError(`Blocked redirect: ${(error as Error).message}`);
        }
        if (
          response.status === 303 ||
          ((response.status === 301 || response.status === 302) && currentMethod === "POST")
        ) {
          currentMethod = "GET";
          currentBody = undefined;
        }
        continue;
      }
      const text = await readCapped(response);
      const type = response.headers.get("content-type") ?? "";
      const clipped =
        text.length > MAX_PAGE_CHARS
          ? `${text.slice(0, MAX_PAGE_CHARS)}\n\n[truncated: ${text.length - MAX_PAGE_CHARS} more characters]`
          : text;
      return {
        output: [
          {
            type: "text",
            text: `HTTP ${response.status} ${response.statusText}\n${type ? `content-type: ${type}\n` : ""}\n${clipped}`,
          },
        ],
        ...(response.ok ? {} : { isError: true }),
        details: { status: response.status, url: url.href },
      };
    }
  }

  // Every bot has the web toolkit; until it is configured it offers the
  // model nothing rather than tools that can only fail.
  return defineToolkit({
    id: "web",
    name: "Web",
    description: "Search and read web pages",
    tools: [webSearch, webFetch, httpRequest],
    offered: (name) => configured || name === "http_request",
    ...(configured ? {} : { setupHint: "Set TINYFISH_API_KEY to enable web search." }),
  });
}

function httpError(message: string): Error {
  const error = new Error(message);
  error.name = "HttpRequestError";
  return error;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The response body as text, reading at most MAX_HTTP_BYTES. */
async function readCapped(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
    if (size >= MAX_HTTP_BYTES) {
      await reader.cancel().catch(() => undefined);
      break;
    }
  }
  return Buffer.concat(chunks).subarray(0, MAX_HTTP_BYTES).toString("utf8");
}
