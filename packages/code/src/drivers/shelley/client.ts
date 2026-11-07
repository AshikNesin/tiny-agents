/**
 * HTTP to Shelley's official `/api` (https://github.com/boldsoftware/shelley),
 * from the server only. Shelley ships no auth of its own, so the browser
 * never reaches it; tiny-agents' login is the boundary and Shelley stays on
 * the tailnet (ADR 0009).
 */
import { badGateway, HarnessError } from "../../server/errors";

interface ShelleyConfig {
  /** Base URL the server dials (`http://my-vm:9999`), no trailing slash. */
  url: string;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ShelleyDeps {
  config: ShelleyConfig;
  fetch?: FetchLike;
}

/**
 * Sent on every request. Shelley's `-require-header` guard checks only that
 * the header is non-empty; exe.dev runs Shelley with `-require-header
 * X-Exedev-Userid` (its proxy normally adds it), and reached directly over
 * Tailscale it answers 403 without it. `X-Shelley-Request` is the header
 * Shelley's own clients send.
 */
export const SHELLEY_HEADERS: Readonly<Record<string, string>> = {
  "X-Shelley-Request": "1",
  "X-Exedev-Userid": "exedev",
};

export function trimUrl(raw: string | undefined): string | undefined {
  const url = raw?.trim().replace(/\/+$/, "");
  return url || undefined;
}

const REQUEST_TIMEOUT_MS = 20_000;

export interface ShelleyRequest {
  method?: string;
  /** JSON-encoded unless it is already a body (Blob / stream / string). */
  json?: unknown;
  body?: BodyInit;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Overrides the default timeout; ignored when `signal` is given. */
  timeoutMs?: number;
}

/**
 * One request to Shelley's `/api<path>`. Shelley's 4xx answers keep their
 * status and text (an archived conversation, a bad model); network failures
 * and its 5xx become 502s that say what went wrong.
 */
export async function shelleyFetch(
  path: string,
  init: ShelleyRequest,
  deps: ShelleyDeps,
): Promise<Response> {
  const { config } = deps;
  const headers: Record<string, string> = { ...SHELLEY_HEADERS, ...init.headers };
  let body = init.body;
  if (init.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.json);
  }
  let response: Response;
  try {
    response = await (deps.fetch ?? fetch)(`${config.url}/api${path}`, {
      method: init.method ?? "GET",
      headers,
      body,
      signal: init.signal ?? AbortSignal.timeout(init.timeoutMs ?? REQUEST_TIMEOUT_MS),
      // Streaming request bodies (uploads) need half-duplex in Node's fetch.
      ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
    } as RequestInit);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw badGateway(`Shelley is unreachable at ${config.url}: ${reason}`);
  }
  if (!response.ok) {
    const text = (await response.text().catch(() => "")).trim().slice(0, 500);
    const message = `Shelley answered ${response.status}${text ? `: ${text}` : ""}`;
    if (response.status >= 400 && response.status < 500) {
      throw new HarnessError(response.status, message);
    }
    throw badGateway(message);
  }
  return response;
}

export async function shelleyJson<T = unknown>(
  path: string,
  init: ShelleyRequest,
  deps: ShelleyDeps,
): Promise<T> {
  const response = await shelleyFetch(path, init, deps);
  const text = await response.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw badGateway("Shelley returned something that is not JSON");
  }
}

/**
 * Re-emit each `data:` frame of an SSE body as one parsed event, until the
 * body ends (or the read fails, e.g. the fetch was aborted).
 */
export async function readSseFrames(
  body: ReadableStream<Uint8Array>,
  onFrame: (event: unknown) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    // eslint-disable-next-line react-doctor/async-await-in-loop -- one stream, read in order
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data) continue;
      try {
        onFrame(JSON.parse(data));
      } catch {
        // A malformed frame is skipped, not fatal.
      }
    }
  }
}

export function qs(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== undefined) search.set(key, value);
  const text = search.toString();
  return text ? `?${text}` : "";
}

/** A repo-relative path, encoded per segment for Shelley's `file-diff/<id>/<path>`. */
export function encodePath(path: string): string {
  if (path.split("/").some((segment) => segment === ".." || segment === ".")) {
    throw new HarnessError(400, "Invalid path");
  }
  return path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}
