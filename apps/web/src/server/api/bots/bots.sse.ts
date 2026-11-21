import type { AppContext } from "@groot/core/types";
import { requireUser } from "@groot/core/utils/controller.utils";
import { holdLiveAccess } from "../people/live-access";
import type { PingEvent, StreamErrorEvent } from "../../../shared/bot-stream";
import { app } from "../../app-root";

const HEARTBEAT_MS = 25_000;

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const;

export interface SseStream<E> {
  write(event: E): void;
  onClose(listener: () => void): void;
  end(): void;
  readonly closed: boolean;
}

const encoder = new TextEncoder();

export function openSse<E>(
  c: AppContext,
  start: (sse: SseStream<E>) => void | Promise<void>,
  options: { botId?: string } = {},
): Response {
  const openStreams = app().openSseStreams;
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const listeners: (() => void)[] = [];
  let closed = false;
  let release = () => {};
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const signal = c.req.raw.signal;
  const finish = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    openStreams.delete(sse);
    release();
    signal?.removeEventListener("abort", finish);
    for (const listener of listeners.splice(0)) {
      try {
        listener();
      } catch {}
    }
  };

  const sse: SseStream<E | PingEvent | StreamErrorEvent> = {
    get closed() {
      return closed;
    },
    write(event) {
      if (closed || !controller) return;
      try {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      } catch {
        finish();
      }
    },
    onClose(listener) {
      if (closed) listener();
      else listeners.push(listener);
    },
    end() {
      if (closed) return;
      finish();
      try {
        controller?.close();
      } catch {}
    },
  };

  const body = new ReadableStream<Uint8Array>({
    start(ctrl) {
      controller = ctrl;
    },
    cancel() {
      finish();
    },
  });

  heartbeat = setInterval(() => {
    sse.write({ type: "ping" });
  }, HEARTBEAT_MS);
  openStreams.add(sse);
  release = holdLiveAccess({ userId: requireUser(c).userId, botId: options.botId }, () =>
    sse.end(),
  );
  signal?.addEventListener("abort", finish, { once: true });

  void (async () => start(sse))().catch((error: unknown) => endSseOnError(sse, error));

  return new Response(body, { status: 200, headers: SSE_HEADERS });
}

function endSseOnError(sse: SseStream<StreamErrorEvent>, error: unknown): void {
  sse.write({ type: "error", message: error instanceof Error ? error.message : "error" });
  sse.end();
}

export function endAllSse(): void {
  const openStreams = app().openSseStreams;
  for (const sse of openStreams) sse.end();
  openStreams.clear();
}
