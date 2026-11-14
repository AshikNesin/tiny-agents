/**
 * Minimal EventSource-style client for the app's SSE endpoints with
 * auto-reconnect and auth handling. `EventSource` cannot send the JWT cookie
 * cross-origin reliably or be aborted per-connection in older browsers, but
 * same-origin with `withCredentials` it is fine: we use fetch streaming for
 * one reason: EventSource reconnects on its own schedule; we want explicit
 * abort + resubscribe (fresh snapshot) control (PRD §7.5).
 */
export interface SseConnection {
  close(): void;
}

export function subscribeSse(
  path: string,
  onEvent: (event: unknown) => void,
  opts: {
    signal?: AbortSignal;
    onOpen?: () => void;
    /** An open stream ended or a connect attempt threw; a retry follows. */
    onDrop?: () => void;
  } = {},
): SseConnection {
  const controller = new AbortController();
  const externalSignal = opts.signal;
  const onAbort = () => controller.abort();
  externalSignal?.addEventListener("abort", onAbort, { once: true });

  // Going offline rarely breaks an open stream right away, so the transcript
  // would look live while nothing arrives: drop the attempt at once, and come
  // back (with a fresh snapshot) the moment the browser is online again.
  let attempt: AbortController | undefined;
  let wake: (() => void) | undefined;
  const onOffline = () => attempt?.abort();
  const onOnline = () => wake?.();
  window.addEventListener("offline", onOffline);
  window.addEventListener("online", onOnline);
  controller.signal.addEventListener("abort", () => {
    window.removeEventListener("offline", onOffline);
    window.removeEventListener("online", onOnline);
  });

  void (async () => {
    let delayMs = 1500;
    while (!controller.signal.aborted) {
      let response: Response | undefined;
      attempt = new AbortController();
      const stop = () => attempt?.abort();
      controller.signal.addEventListener("abort", stop, { once: true });
      try {
        response = await fetch(path, {
          credentials: "include",
          headers: { Accept: "text/event-stream" },
          signal: attempt.signal,
        });
        if (!response.ok || !response.body) {
          // Surface the failure, then keep retrying: a transient 502
          // (deploy, proxy hiccup) must not freeze the transcript forever.
          // Auth failures are the exception: the page will be redirected to
          // /login on the next API call, so retrying here is pointless.
          onEvent({ type: "error", message: `SSE ${response.status}` });
          if (response.status === 401 || response.status === 403) return;
        } else {
          opts.onOpen?.();
          // A healthy connection resets the backoff: the next drop retries
          // quickly instead of inheriting the last outage's 10s delay.
          delayMs = 1500;
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let boundary: number;
            while ((boundary = buffer.indexOf("\n\n")) !== -1) {
              const frame = buffer.slice(0, boundary);
              buffer = buffer.slice(boundary + 2);
              for (const line of frame.split("\n")) {
                if (line.startsWith("data:")) {
                  const payload = line.slice(5).trim();
                  if (payload) {
                    try {
                      onEvent(JSON.parse(payload));
                    } catch {
                      // ignore malformed frames
                    }
                  }
                }
              }
            }
          }
        }
      } catch {
        // aborted or network error
      }
      controller.signal.removeEventListener("abort", stop);
      if (controller.signal.aborted) return;
      opts.onDrop?.();
      // Reconnect with backoff (or as soon as the browser is back online);
      // the server resends a fresh snapshot.
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, delayMs);
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      wake = undefined;
      delayMs = Math.min(delayMs * 2, 10_000);
    }
  })();

  return {
    close() {
      externalSignal?.removeEventListener("abort", onAbort);
      controller.abort();
    },
  };
}
