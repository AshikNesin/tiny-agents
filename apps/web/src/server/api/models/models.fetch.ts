/**
 * The one outbound path a provider account's discovery and Test take
 * (issue #179): https only (http when the account opted in to a private
 * endpoint), no credentials, query or fragment in the base URL, no
 * redirects, a deadline and a size cap. The address is checked when the
 * socket connects, after DNS, so a name that resolves to a private address
 * is refused unless the account opted in.
 */
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import { isPrivateAddress } from "@tiny-agents/agent";

export class OutboundRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutboundRefusedError";
  }
}

export interface OutboundOptions {
  /** The account opted in to a private or LAN endpoint (Ollama, LM Studio). */
  allowPrivateNetwork: boolean;
  timeoutMs?: number;
  maxBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;

/**
 * Validate an account's base URL. Returns it canonical (no trailing slash).
 * Throws `OutboundRefusedError` with what to fix.
 */
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

/** A DNS lookup that refuses private addresses unless allowed. */
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

/** GET `url` through the guard. Never follows a redirect. */
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

/** Resolve the endpoint's host now and refuse a private address (before a Test call). */
export function checkResolvesPublic(url: string, allowPrivateNetwork: boolean): Promise<void> {
  if (allowPrivateNetwork) return Promise.resolve();
  const host = new URL(url).hostname;
  return new Promise((resolve, reject) => {
    guardedLookup(false)(host, { all: true }, (error) => (error ? reject(error) : resolve()));
  });
}
