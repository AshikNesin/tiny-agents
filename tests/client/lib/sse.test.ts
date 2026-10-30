import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { subscribeSse } from "@/lib/sse";

/** A fetch whose streams stay open until aborted, counting connects. */
function hangingFetch() {
  const calls: AbortSignal[] = [];
  const fetchMock = vi.fn((_url: string, init: RequestInit) => {
    calls.push(init.signal!);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        init.signal!.addEventListener("abort", () =>
          controller.error(new DOMException("aborted", "AbortError")),
        );
      },
    });
    return Promise.resolve(new Response(body, { status: 200 }));
  });
  return { fetchMock, calls };
}

const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

describe("subscribeSse", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("drops the stream when the browser goes offline and reconnects as soon as it is back", async () => {
    const { fetchMock, calls } = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);
    const onOpen = vi.fn();
    const onDrop = vi.fn();
    const connection = subscribeSse("/api/v1/events", () => undefined, { onOpen, onDrop });
    await tick();
    expect(onOpen).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("offline"));
    await tick();
    expect(calls[0].aborted).toBe(true);
    expect(onDrop).toHaveBeenCalledTimes(1);

    // Back online: no 1.5s backoff wait.
    window.dispatchEvent(new Event("online"));
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onOpen).toHaveBeenCalledTimes(2);
    connection.close();
    expect(calls[1].aborted).toBe(true);
  });
});
