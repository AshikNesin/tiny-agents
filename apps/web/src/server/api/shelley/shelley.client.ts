/**
 * The one way this app talks to Shelley (https://github.com/boldsoftware/shelley):
 * HTTP to its official `/api`, from the server only. Shelley ships no auth of
 * its own, so the browser never reaches it; tiny-agents' login is the
 * boundary and Shelley stays on the tailnet (issue #143).
 */
import { Boom, HttpError } from "@groot/core/errors";
import { appEnv } from "../../env";

export interface ShelleyConfig {
  /** Base URL the server dials (`http://my-vm:9999`), no trailing slash. */
  url: string;
}

/** Only `SHELLEY_URL`: everything else has a working default. */
export function shelleyConfig(
  source: Record<string, string | undefined> = process.env,
): ShelleyConfig | undefined {
  const url = trimUrl(appEnv(source).SHELLEY_URL);
  return url ? { url } : undefined;
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

function trimUrl(raw: string | undefined): string | undefined {
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

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * One request to Shelley's `/api<path>`. Shelley's 4xx answers keep their
 * status and text (an archived conversation, a bad model); network failures
 * and its 5xx become 502s that say what went wrong.
 */
export async function shelleyFetch(
  path: string,
  init: ShelleyRequest = {},
  options: { config?: ShelleyConfig; fetch?: FetchLike } = {},
): Promise<Response> {
  const config = options.config ?? shelleyConfig();
  if (!config) throw Boom.unavailable("Shelley is not configured: set SHELLEY_URL.");
  const headers: Record<string, string> = { ...SHELLEY_HEADERS, ...init.headers };
  let body = init.body;
  if (init.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.json);
  }

  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(`${config.url}/api${path}`, {
      method: init.method ?? "GET",
      headers,
      body,
      signal: init.signal ?? AbortSignal.timeout(init.timeoutMs ?? REQUEST_TIMEOUT_MS),
      // Streaming request bodies (uploads) need half-duplex in Node's fetch.
      ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
    } as RequestInit);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw Boom.badGateway(`Shelley is unreachable at ${config.url}: ${reason}`);
  }
  if (!response.ok) {
    const text = (await response.text().catch(() => "")).trim().slice(0, 500);
    const message = `Shelley answered ${response.status}${text ? `: ${text}` : ""}`;
    if (response.status >= 400 && response.status < 500) {
      throw new HttpError(response.status, message);
    }
    throw Boom.badGateway(message);
  }
  return response;
}

export async function shelleyJson<T = unknown>(
  path: string,
  init?: ShelleyRequest,
  options?: { config?: ShelleyConfig; fetch?: FetchLike },
): Promise<T> {
  const response = await shelleyFetch(path, init, options);
  const text = await response.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw Boom.badGateway("Shelley returned something that is not JSON");
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
