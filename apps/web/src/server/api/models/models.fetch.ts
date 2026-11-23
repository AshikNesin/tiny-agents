import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import { isPrivateAddress } from "@tiny-agents/sandbox";

export class OutboundRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutboundRefusedError";
  }
}

export interface OutboundOptions {
  allowPrivateNetwork: boolean;
  timeoutMs?: number;
  maxBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;

export function checkBaseUrl(raw: string, allowPrivateNetwork: boolean): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new OutboundRefusedError("The endpoint is not a valid URL.");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && allowPrivateNetwork)) {
    throw new OutboundRefusedError(
      "The endpoint must use https (http only for a private endpoint you allow).",
    );
  }
  if (url.username || url.password) {
    throw new OutboundRefusedError("The endpoint can't carry credentials.");
  }
  if (url.search || url.hash) {
    throw new OutboundRefusedError("The endpoint can't carry a query or fragment.");
  }
  return url.toString().replace(/\/+$/, "");
}

function guardedLookup(allowPrivateNetwork: boolean): LookupFunction {
  return (hostname, options, callback) => {
    dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) return callback(error, "", 0);
      const list = (addresses as LookupAddress[]) ?? [];
      const refused = !allowPrivateNetwork && list.some((a) => isPrivateAddress(a.address));
      if (refused || list.length === 0) {
        return callback(
          new OutboundRefusedError(
            `${hostname} resolves to a private address. Allow a private endpoint for this account to use it.`,
          ) as NodeJS.ErrnoException,
          "",
          0,
        );
      }
      if ((options as { all?: boolean }).all) {
        return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
      }
      callback(null, list[0]!.address, list[0]!.family);
    });
  };
}

export function guardedGet(
  url: string,
  headers: Record<string, string>,
  options: OutboundOptions,
): Promise<{ status: number; body: string }> {
  checkBaseUrl(new URL(url).origin, options.allowPrivateNetwork);
  const parsed = new URL(url);
  const request = parsed.protocol === "https:" ? httpsRequest : httpRequest;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  return new Promise((resolve, reject) => {
    const req = request(
      parsed,
      {
        method: "GET",
        headers: { accept: "application/json", ...headers },
        lookup: guardedLookup(options.allowPrivateNetwork),
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          return reject(new OutboundRefusedError(`The endpoint redirected (HTTP ${status}).`));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            req.destroy(new OutboundRefusedError("The endpoint's answer is too large."));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => resolve({ status, body: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new OutboundRefusedError("The endpoint timed out.")));
    req.on("error", reject);
    req.end();
  });
}

export function checkResolvesPublic(url: string, allowPrivateNetwork: boolean): Promise<void> {
  if (allowPrivateNetwork) return Promise.resolve();
  const host = new URL(url).hostname;
  return new Promise((resolve, reject) => {
    guardedLookup(false)(host, { all: true }, (error) => (error ? reject(error) : resolve()));
  });
}

const MAX_REDIRECTS = 5;

export async function guardedFetch(
  input: RequestInfo | URL,
  init: RequestInit,
  options: OutboundOptions,
): Promise<Response> {
  let url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  let method = init.method ?? "GET";
  let body = init.body;
  for (let hop = 0; ; hop++) {
    await checkResolvesPublic(url, options.allowPrivateNetwork);
    const response = await fetch(url, { ...init, method, body, redirect: "manual" });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("location");
    if (!location || hop >= MAX_REDIRECTS) {
      throw new OutboundRefusedError(`The endpoint redirected (HTTP ${response.status}).`);
    }
    url = new URL(location, url).toString();
    if (
      response.status === 303 ||
      (response.status <= 302 && method !== "GET" && method !== "HEAD")
    ) {
      method = "GET";
      body = undefined;
    }
  }
}
