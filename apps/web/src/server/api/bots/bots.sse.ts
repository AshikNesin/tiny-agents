/**
 * Server-sent events plumbing shared by the chat stream and the app-wide
 * activity feed. SSE responses must never be compressed or buffered — the
 * headers below tell proxies so, and each event is enqueued on the response
 * body as soon as it is written, so the connection stays open and live.
 *
 * A stream is a `ReadableStream` response: the Node adapter cancels it when
 * the client disconnects (and aborts the request signal), which ends the
 * stream and runs its close listeners, so watches never outlive their viewer.
 */
import type { AppContext } from "@groot/core/types";

const HEARTBEAT_MS = 25_000;

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const;

/** One open SSE response. */
export interface SseStream {
  /** Send one event (`data: <json>`); a no-op once the stream has ended. */
  write(event: unknown): void;
  /**
   * Run `listener` when the stream ends: the client went away, `end()`, or
   * shutdown. Runs at once when the stream has already ended.
   */
  onClose(listener: () => void): void;
  /** End the stream. */
  end(): void;
  readonly closed: boolean;
}

/** Every SSE response still open, so shutdown can end them. */
const openStreams = new Set<SseStream>();

const encoder = new TextEncoder();

/**
 * Open an SSE response and hand its stream to `start`. Headers go out with
 * the returned response; `start` writes the first events and registers its
 * cleanups with `onClose`. A throw (or rejection) in `start` ends the stream
 * with an error event: by then the response has started, so it can no longer
 * become an API error. Do anything that should fail as an API error (an
 * unknown bot's 404) before calling this.
 */
export function openSse(c: AppContext, start: (sse: SseStream) => void | Promise<void>): Response {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const listeners: (() => void)[] = [];
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const signal = c.req.raw.signal;
  const finish = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    openStreams.delete(sse);
    signal?.removeEventListener("abort", finish);
    for (const listener of listeners.splice(0)) {
      try {
        listener();
      } catch {
        // One failing cleanup must not keep the others from running.
      }
    }
  };

  const sse: SseStream = {
    get closed() {
      return closed;
    },
    write(event) {
      if (closed || !controller) return;
      try {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      } catch {
        // The body was cancelled under us: the client is gone.
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
      } catch {
        // Already closed or cancelled.
      }
    },
  };

  const body = new ReadableStream<Uint8Array>({
    start(ctrl) {
      controller = ctrl;
    },
    // The client disconnected (the Node adapter cancels the body on close).
    cancel() {
      finish();
    },
  });

  heartbeat = setInterval(() => {
    sse.write({ type: "ping" });
  }, HEARTBEAT_MS);
  openStreams.add(sse);
  signal?.addEventListener("abort", finish, { once: true });

  void (async () => start(sse))().catch((error: unknown) => endSseOnError(sse, error));

  return new Response(body, { status: 200, headers: SSE_HEADERS });
}

/** Errors after the stream opened end it, with an error event first. */
export function endSseOnError(sse: SseStream, error: unknown): void {
  sse.write({ type: "error", message: error instanceof Error ? error.message : "error" });
  sse.end();
}

/**
 * Shutdown: end every open stream. SSE responses never finish on their own,
 * so without this `httpServer.close()` waits out the whole grace period.
 * Clients reconnect with backoff and get a fresh snapshot from the next
 * process (the durable conversation resumes there).
 */
export function endAllSse(): void {
  for (const sse of openStreams) sse.end();
  openStreams.clear();
}
