import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
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

let visibility: DocumentVisibilityState = "visible";
const showTab = (state: DocumentVisibilityState) => {
  visibility = state;
  document.dispatchEvent(new Event("visibilitychange"));
};

describe("subscribeSse", () => {
  beforeEach(() => {
    visibility = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

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

  // A browser opens at most 6 connections per origin over plain HTTP: streams
  // held by background tabs would leave every new request waiting for good.
  it("gives its connection back while the tab is hidden, and reconnects at once when shown", async () => {
    const { fetchMock, calls } = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);
    const onOpen = vi.fn();
    const connection = subscribeSse("/api/v1/events", () => undefined, { onOpen });
    await tick();
    expect(onOpen).toHaveBeenCalledTimes(1);

    showTab("hidden");
    await tick();
    expect(calls[0].aborted).toBe(true);
    // No reconnect while hidden, even past the 1.5s backoff.
    await tick(1_700);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    showTab("visible");
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onOpen).toHaveBeenCalledTimes(2);
    connection.close();
  });

  it("does not connect at all from a tab opened in the background until it is shown", async () => {
    const { fetchMock } = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);
    visibility = "hidden";
    const connection = subscribeSse("/api/v1/events", () => undefined);
    await tick();
    expect(fetchMock).not.toHaveBeenCalled();
    showTab("visible");
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    connection.close();
  });
});
