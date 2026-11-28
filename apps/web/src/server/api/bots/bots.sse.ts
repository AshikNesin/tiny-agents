import type { AppContext } from "@groot/core/types";
import { requireUser } from "@groot/core/utils/controller.utils";
import { Boom } from "@groot/core/errors";
import { logger } from "@groot/core/logger";
import { holdLiveAccess } from "../people/live-access";
import type { PingEvent, StreamErrorEvent } from "../../../shared/bot-stream";
import { app } from "../../app-root";

const HEARTBEAT_MS = 25_000;
const PER_USER_STREAM_LIMIT = 20;
const MAX_BUFFERED_BYTES = 2 * 1024 * 1024;

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const;

function ignoreStreamAlreadyClosed(error: unknown): void {
  if (error instanceof TypeError) return;
  logger.warn({ error }, "SSE: could not close a stream");
}

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
  const userId = requireUser(c).userId;
  const userStreams = [...openStreams].filter(
    (stream) => (stream as SseStream<E> & { userId?: number }).userId === userId,
  );
  if (userStreams.length >= PER_USER_STREAM_LIMIT) {
    throw Boom.tooManyRequests("Too many streams open. Close some tabs and try again.");
  }
  let controller: ReadableByteStreamController | undefined;
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
      } catch (error) {
        logger.warn({ error, userId }, "SSE: a close listener threw");
      }
    }
  };

  const sse = Object.assign(
    {
      get closed() {
        return closed;
      },
      write(event: E | PingEvent | StreamErrorEvent) {
        if (closed || !controller) return;
        if (controller.desiredSize !== null && controller.desiredSize <= 0) {
          sse.end();
          return;
        }
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          finish();
        }
      },
      onClose(listener: () => void) {
        if (closed) listener();
        else listeners.push(listener);
      },
      end() {
        if (closed) return;
        finish();
        try {
          controller?.close();
        } catch (error) {
          ignoreStreamAlreadyClosed(error);
        }
      },
    } satisfies SseStream<E | PingEvent | StreamErrorEvent>,
    { userId },
  );

  const body = new ReadableStream<Uint8Array>(
    {
      type: "bytes",
      start(ctrl) {
        controller = ctrl as ReadableByteStreamController;
      },
      cancel() {
        finish();
      },
    },
    { highWaterMark: MAX_BUFFERED_BYTES },
  );

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
