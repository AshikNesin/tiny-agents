export interface SseConnection {
  close(): void;
}

function deliver(path: string, payload: string, onEvent: (event: unknown) => void): void {
  let event: unknown;
  try {
    event = JSON.parse(payload);
  } catch (error) {
    console.warn(`Skipped an event from ${path} that was not JSON`, error);
    return;
  }
  try {
    onEvent(event);
  } catch (error) {
    console.error(`A listener for ${path} threw on an event; the stream stays open`, error);
  }
}

function reportUnlessDropped(path: string, error: unknown): void {
  if (error instanceof TypeError) return;
  if (error instanceof DOMException && error.name === "AbortError") return;
  console.error(`The event stream ${path} failed; reconnecting`, error);
}

export function subscribeSse(
  path: string,
  onEvent: (event: unknown) => void,
  opts: {
    signal?: AbortSignal;
    onOpen?: () => void;
    onDrop?: () => void;
  } = {},
): SseConnection {
  const controller = new AbortController();
  const externalSignal = opts.signal;
  const onAbort = () => controller.abort();
  externalSignal?.addEventListener("abort", onAbort, { once: true });

  let attempt: AbortController | undefined;
  let wake: (() => void) | undefined;
  const onOffline = () => attempt?.abort();
  const onOnline = () => wake?.();
  window.addEventListener("offline", onOffline);
  window.addEventListener("online", onOnline);
  const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";
  const onVisibility = () => (hidden() ? attempt?.abort() : wake?.());
  document.addEventListener("visibilitychange", onVisibility);
  controller.signal.addEventListener("abort", () => {
    window.removeEventListener("offline", onOffline);
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisibility);
  });
  const untilShown = () =>
    new Promise<void>((resolve) => {
      wake = resolve;
      controller.signal.addEventListener("abort", () => resolve(), { once: true });
    });

  void (async () => {
    let delayMs = 1500;
    while (!controller.signal.aborted) {
      if (hidden()) {
        await untilShown();
        wake = undefined;
        delayMs = 1500;
        continue;
      }
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
          onEvent({ type: "error", message: `SSE ${response.status}` });
          if (response.status === 401 || response.status === 403) return;
        } else {
          opts.onOpen?.();
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
                  if (payload) deliver(path, payload, onEvent);
                }
              }
            }
          }
        }
      } catch (error) {
        reportUnlessDropped(path, error);
      }
      controller.signal.removeEventListener("abort", stop);
      if (controller.signal.aborted) return;
      opts.onDrop?.();
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
