import { parseJson } from "@tiny-agents/std";
import type { z } from "zod";
import { badGateway, HarnessError } from "../../server/errors";

interface ShelleyConfig {
  url: string;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ShelleyDeps {
  config: ShelleyConfig;
  fetch?: FetchLike;
}

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
  json?: unknown;
  body?: BodyInit;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

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
      ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
    } as RequestInit);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw badGateway(`Shelley is unreachable at ${config.url}: ${reason}`);
  }
  if (!response.ok) {
    const text = await failureText(response);
    const message = `Shelley answered ${response.status}${text ? `: ${text}` : ""}`;
    if (response.status >= 400 && response.status < 500) {
      throw new HarnessError(response.status, message);
    }
    throw badGateway(message);
  }
  return response;
}

async function failureText(response: Response): Promise<string> {
  try {
    return (await response.text()).trim().slice(0, 500);
  } catch (error) {
    return `its body could not be read (${error instanceof Error ? error.message : String(error)})`;
  }
}

export async function shelleyJson<T>(
  path: string,
  init: ShelleyRequest,
  deps: ShelleyDeps,
  schema: z.ZodType<T>,
): Promise<T> {
  const response = await shelleyFetch(path, init, deps);
  const text = await response.text();
  try {
    return parseJson(`Shelley's answer to ${path.split("?")[0]}`, text || "{}", schema);
  } catch {
    throw badGateway("Shelley returned something that is not JSON");
  }
}

export async function readSseFrames(
  body: ReadableStream<Uint8Array>,
  onFrame: (event: unknown) => void,
  onFrameFailure: (error: unknown, data: string) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    // eslint-disable-next-line react-doctor/async-await-in-loop
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
      } catch (error) {
        onFrameFailure(error, data);
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
