/**
 * Server-sent events plumbing shared by the chat stream and the app-wide
 * activity feed. SSE responses must never be compressed or buffered (the
 * groot compression filter already skips text/event-stream) — headers are
 * flushed before the first event so proxies keep the connection open.
 */
import type { Response } from "express";

export interface SseHeartbeat {
  start(): void;
  stop(): void;
}

/** Every SSE response still open, so shutdown can end them. */
const openStreams = new Set<Response>();

export function initSse(res: Response): SseHeartbeat {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();

  const heartbeat = setInterval(() => {
    writeSse(res, { type: "ping" });
  }, 25_000);

  openStreams.add(res);
  res.on("close", () => {
    clearInterval(heartbeat);
    openStreams.delete(res);
  });

  return {
    start() {
      // Interval is already running; kept for API symmetry.
    },
    stop() {
      clearInterval(heartbeat);
    },
  };
}

export function writeSse(res: Response, event: unknown): void {
  if (res.writableEnded) return;
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

/** Async close guard: SSE routes have no `next`; errors end the stream. */
export function endSseOnError(res: Response, error: unknown): void {
  writeSse(res, { type: "error", message: error instanceof Error ? error.message : "error" });
  res.end();
}

/**
 * Shutdown: end every open stream. SSE responses never finish on their own,
 * so without this `httpServer.close()` waits out the whole grace period.
 * Clients reconnect with backoff and get a fresh snapshot from the next
 * process (the durable conversation resumes there).
 */
export function endAllSse(): void {
  for (const res of openStreams) {
    if (!res.writableEnded) res.end();
  }
  openStreams.clear();
}
