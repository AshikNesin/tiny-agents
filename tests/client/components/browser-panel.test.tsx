/**
 * @vitest-environment jsdom
 *
 * BrowserPanel (issue #24): the VNC-streamed browser — connect/reconnect,
 * take control and release, clipboard, full screen, fitting the remote
 * window — plus the headless and closed states. noVNC itself is faked; its
 * canvas needs a real browser (covered by the live check against the VM).
 */
import React from "react";
import { act, fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ConfirmProvider } from "@groot/ui/primitives";
import { BrowserPanel } from "@/components/BrowserPanel";
import { botsApi, type Bot, type BrowserStatus } from "@/lib/bots-api";
import { createRfb } from "@/lib/novnc";

const fakes = vi.hoisted(() => ({ rfbs: [] as FakeRfb[] }));

interface FakeRfb extends EventTarget {
  viewOnly: boolean;
  focus: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  sendKey: ReturnType<typeof vi.fn>;
  clipboardPasteFrom: ReturnType<typeof vi.fn>;
}

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/novnc", () => ({
  createRfb: vi.fn(async () => {
    const rfb = Object.assign(new EventTarget(), {
      viewOnly: true,
      focus: vi.fn(),
      disconnect: vi.fn(),
      sendKey: vi.fn(),
      clipboardPasteFrom: vi.fn(),
    });
    fakes.rfbs.push(rfb as unknown as FakeRfb);
    return rfb;
  }),
}));

const bot: Bot = {
  id: "b1",
  name: "Surfer",
  description: "",
  systemPrompt: "",
  modelId: "m",
  conversationId: "1",
  lastReadAt: null,
  lastActivityAt: "",
  lastMessagePreview: null,
  approvals: 0,
  pinnedAt: null,
  unread: false,
  replying: false,
} as unknown as Bot;

/** The panel confirms a reset through the app's confirm dialog. */
const render = (ui: React.ReactElement) => rtlRender(<ConfirmProvider>{ui}</ConfirmProvider>);

const vncStatus = (s: Partial<BrowserStatus> = {}): BrowserStatus => ({
  active: true,
  url: "https://example.com/",
  driver: "agent",
  mode: "vnc",
  scale: 2,
  starting: false,
  phase: null,
  error: null,
  ...s,
});

function mockApi(initial: BrowserStatus) {
  let current = initial;
  const api = {
    status: vi.spyOn(botsApi, "browserStatus").mockImplementation(async () => current),
    driver: vi.spyOn(botsApi, "browserDriver").mockImplementation(async (_id, driver) => {
      current = { ...current, driver };
    }),
    start: vi.spyOn(botsApi, "browserStart").mockResolvedValue({ starting: true }),
    ticket: vi.spyOn(botsApi, "browserVncTicket").mockResolvedValue({
      path: "/api/v1/bots/b1/browser/vnc?ticket=t1",
      scale: 2,
    }),
    resize: vi.spyOn(botsApi, "browserResize").mockResolvedValue(undefined as never),
    reset: vi.spyOn(botsApi, "browserResetProfile").mockResolvedValue(undefined as never),
    set: (next: BrowserStatus) => (current = next),
  };
  return api;
}

/** A ResizeObserver whose callback the test fires by hand (jsdom has no layout). */
function stubResizeObserver() {
  const observer = { notify: () => {} };
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        observer.notify = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  return observer;
}

const latestRfb = () => fakes.rfbs[fakes.rfbs.length - 1]!;
// Generous: a viewer that appears after "Open browser" waits for the next
// 1.5s status poll before it mounts.
const connected = async () => {
  await waitFor(() => expect(fakes.rfbs.length).toBeGreaterThan(0), { timeout: 4000 });
  act(() => {
    latestRfb().dispatchEvent(new Event("connect"));
  });
  await screen.findByText("Live");
};

describe("BrowserPanel", () => {
  beforeEach(() => {
    fakes.rfbs.length = 0;
    vi.mocked(createRfb).mockClear();
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("streams the browser and goes live once the viewer connects", async () => {
    mockApi(vncStatus());
    render(<BrowserPanel bot={bot} onClose={vi.fn()} />);

    await screen.findByTestId("browser-vnc");
    expect(await screen.findByText("Connecting")).toBeInTheDocument();
    expect(screen.getByText("Connecting to the browser…")).toBeInTheDocument();
    await waitFor(() => expect(createRfb).toHaveBeenCalledTimes(1));
    expect(createRfb).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.stringMatching(/^wss?:\/\/[^/]+\/api\/v1\/bots\/b1\/browser\/vnc\?ticket=t1$/),
      2,
    );
    expect(latestRfb().viewOnly).toBe(true);

    await connected();
    expect(screen.queryByText("Connecting to the browser…")).not.toBeInTheDocument();
    expect(screen.getByTestId("browser-url").textContent).toBe("https://example.com/");
    expect(screen.getByTestId("browser-driver").textContent).toBe("Surfer drives");
    expect(screen.getByTestId("browser-takeover")).toBeEnabled();
    expect(screen.queryByTestId("browser-paste")).not.toBeInTheDocument();
  });

  it("titles the card and labels its tools", async () => {
    mockApi(vncStatus());
    render(<BrowserPanel bot={bot} onClose={vi.fn()} />);
    await connected();

    expect(screen.getByRole("heading", { name: "Browser" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Take control" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Full screen" })).toHaveTextContent("Full screen");
    expect(screen.getByRole("button", { name: "Reset browser profile" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close browser panel" })).toBeInTheDocument();
  });

  it("take control makes the viewer interactive; release hands it back", async () => {
    const api = mockApi(vncStatus());
    render(<BrowserPanel bot={bot} onClose={vi.fn()} />);
    await connected();

    fireEvent.click(screen.getByTestId("browser-takeover"));
    await waitFor(() => expect(api.driver).toHaveBeenCalledWith("b1", "human"));
    await waitFor(() => expect(latestRfb().viewOnly).toBe(false));
    expect(latestRfb().focus).toHaveBeenCalled();
    expect(screen.getByTestId("browser-driver").textContent).toBe("You drive");
    // The streamed Chrome has its own address bar; the stale agent URL goes.
    expect(screen.queryByTestId("browser-url")).not.toBeInTheDocument();
    expect(screen.getByTestId("browser-paste")).toBeInTheDocument();
    expect(screen.getByTestId("browser-release")).toHaveTextContent("Release control");
    // The label is hidden in a narrow header; the button keeps its name.
    expect(screen.getByRole("button", { name: "Release control" })).toBe(
      screen.getByTestId("browser-release"),
    );

    const polls = api.status.mock.calls.length;
    api.set(vncStatus({ url: "https://example.org/", driver: "agent" }));
    fireEvent.click(screen.getByTestId("browser-release"));
    await waitFor(() => expect(api.driver).toHaveBeenCalledWith("b1", "agent"));
    await waitFor(() => expect(latestRfb().viewOnly).toBe(true));
    // Releasing re-reads the status so the adopted tab's URL shows at once.
    await waitFor(() => expect(api.status.mock.calls.length).toBeGreaterThan(polls));
    await waitFor(() =>
      expect(screen.getByTestId("browser-url").textContent).toBe("https://example.org/"),
    );
  });

  it("pastes the local clipboard into the remote browser", async () => {
    mockApi(vncStatus({ driver: "human" }));
    const readText = vi.fn().mockResolvedValue("hello");
    Object.defineProperty(navigator, "clipboard", {
      value: { readText, writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    render(<BrowserPanel bot={bot} onClose={vi.fn()} />);
    await connected();

    fireEvent.click(await screen.findByTestId("browser-paste"));
    await waitFor(() => expect(latestRfb().clipboardPasteFrom).toHaveBeenCalledWith("hello"));
    // Then Ctrl+V: control down, v down, v up, control up.
    await waitFor(() => expect(latestRfb().sendKey).toHaveBeenCalledTimes(4));
    expect(latestRfb().sendKey.mock.calls.map(([keysym, , down]) => [keysym, down])).toEqual([
      [0xffe3, true],
      [0x76, true],
      [0x76, false],
      [0xffe3, false],
    ]);
  });

  it("copies text the remote browser copied to the local clipboard", async () => {
    mockApi(vncStatus());
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { readText: vi.fn(), writeText },
      configurable: true,
    });
    render(<BrowserPanel bot={bot} onClose={vi.fn()} />);
    await connected();

    act(() => {
      latestRfb().dispatchEvent(new CustomEvent("clipboard", { detail: { text: "from vm" } }));
    });
    expect(writeText).toHaveBeenCalledWith("from vm");
  });

  it("goes full screen on the whole panel and locks the browser's shortcut keys", async () => {
    mockApi(vncStatus());
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      value: requestFullscreen,
      configurable: true,
    });
    const lock = vi.fn().mockResolvedValue(undefined);
    const unlock = vi.fn();
    Object.defineProperty(navigator, "keyboard", { value: { lock, unlock }, configurable: true });
    render(<BrowserPanel bot={bot} onClose={vi.fn()} />);
    await connected();

    fireEvent.click(screen.getByTestId("browser-fullscreen"));
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    const panel = screen.getByTestId("browser-panel");
    expect(requestFullscreen.mock.contexts[0]).toBe(panel);

    Object.defineProperty(document, "fullscreenElement", { value: panel, configurable: true });
    act(() => {
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    expect(lock).toHaveBeenCalledWith(expect.arrayContaining(["Escape", "KeyW", "KeyT"]));
    expect(screen.getByTestId("browser-fullscreen")).toHaveAttribute(
      "aria-label",
      "Exit full screen",
    );
    expect(screen.queryByTestId("browser-resize")).not.toBeInTheDocument();

    Object.defineProperty(document, "fullscreenElement", { value: null, configurable: true });
    act(() => {
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    expect(unlock).toHaveBeenCalled();
    expect(screen.getByTestId("browser-fullscreen")).toHaveAttribute("aria-label", "Full screen");
  });

  it("fits the remote window to the panel after it settles", async () => {
    const api = mockApi(vncStatus());
    let notify: () => void = () => undefined;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          notify = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 801.4,
      height: 600.2,
    } as DOMRect);
    try {
      render(<BrowserPanel bot={bot} onClose={vi.fn()} />);
      await connected();

      notify();
      notify();
      notify();
      await waitFor(
        () => expect(api.resize).toHaveBeenCalledWith("b1", { width: 801, height: 600 }),
        {
          timeout: 2000,
        },
      );
      const burst = api.resize.mock.calls.filter(([, size]) => size.width === 801).length;
      expect(burst).toBeLessThanOrEqual(2); // the burst collapsed into one request (+ the first connect)
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("asks for a window Chrome can draw when the viewer is narrower than that", async () => {
    // Chrome will not be narrower than 500px; a smaller window would show cropped.
    const api = mockApi(vncStatus());
    stubResizeObserver();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 352,
      height: 828,
    } as DOMRect);
    try {
      render(<BrowserPanel bot={bot} onClose={vi.fn()} />);
      await connected();

      // The viewer scales this window down to its own box: same shape.
      await waitFor(
        () => expect(api.resize).toHaveBeenCalledWith("b1", { width: 500, height: 1176 }),
        { timeout: 2000 },
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps one fit in flight and refits to the latest size after it", async () => {
    const api = mockApi(vncStatus());
    const observer = stubResizeObserver();
    let box = { width: 800, height: 600 };
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () => box as DOMRect,
    );
    let finishFirst: () => void = () => undefined;
    api.resize.mockImplementationOnce(
      () => new Promise<never>((resolve) => (finishFirst = () => resolve(undefined as never))),
    );
    try {
      render(<BrowserPanel bot={bot} onClose={vi.fn()} />);
      await connected();
      // The fit that follows the viewer connecting is still out when full screen resizes the box.
      await waitFor(() => expect(api.resize).toHaveBeenCalledTimes(1), { timeout: 2000 });
      box = { width: 1440, height: 900 };
      observer.notify();
      // Long enough for any debounce to have run: still no second request.
      await new Promise((resolve) => setTimeout(resolve, 700));
      expect(api.resize).toHaveBeenCalledTimes(1);

      finishFirst();
      await waitFor(() => expect(api.resize).toHaveBeenCalledTimes(2), { timeout: 2000 });
      expect(api.resize).toHaveBeenLastCalledWith("b1", { width: 1440, height: 900 });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("retries a fit that failed, a couple of times, then leaves it", async () => {
    const api = mockApi(vncStatus());
    api.resize.mockRejectedValue(new Error("The browser could not be resized"));
    stubResizeObserver();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 800,
      height: 600,
    } as DOMRect);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<BrowserPanel bot={bot} onClose={vi.fn()} />);
      await connected();
      const advance = (ms: number) =>
        act(async () => {
          await vi.advanceTimersByTimeAsync(ms);
        });

      await advance(350); // the fit that follows the viewer connecting
      expect(api.resize).toHaveBeenCalledTimes(1);
      await advance(1000);
      expect(api.resize).toHaveBeenCalledTimes(2);
      await advance(1000);
      expect(api.resize).toHaveBeenCalledTimes(3);
      await advance(10_000);
      expect(api.resize).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("reconnects with a fresh ticket after the connection drops", async () => {
    const api = mockApi(vncStatus());
    render(<BrowserPanel bot={bot} onClose={vi.fn()} />);
    await connected();
    const first = latestRfb();

    act(() => {
      first.dispatchEvent(new Event("disconnect"));
    });
    expect(await screen.findByText("Reconnecting")).toBeInTheDocument();
    expect(screen.getByText("Reconnecting…")).toBeInTheDocument();

    await waitFor(() => expect(fakes.rfbs.length).toBe(2), { timeout: 3000 });
    expect(api.ticket).toHaveBeenCalledTimes(2); // tickets are single use
    act(() => {
      latestRfb().dispatchEvent(new Event("connect"));
    });
    await screen.findByText("Live");
  });

  it("disconnects the viewer when the panel closes", async () => {
    mockApi(vncStatus());
    const { unmount } = render(<BrowserPanel bot={bot} onClose={vi.fn()} />);
    await connected();
    const rfb = latestRfb();
    unmount();
    expect(rfb.disconnect).toHaveBeenCalled();
  });

  it("remembers the panel width dragged on the edge", async () => {
    mockApi(vncStatus());
    render(<BrowserPanel bot={bot} onClose={vi.fn()} />);
    await connected();
    const panel = screen.getByTestId("browser-panel");
    const before = Number(panel.style.getPropertyValue("--browser-panel-width").replace("px", ""));
    const handle = screen.getByTestId("browser-resize");

    fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 450, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 450, pointerId: 1 });

    const after = Number(panel.style.getPropertyValue("--browser-panel-width").replace("px", ""));
    expect(after).toBe(before + 50);
    expect(window.localStorage.getItem("tiny-agents:browser-panel-width")).toBe(String(after));
  });

  it("says there is no live view for a headless browser", async () => {
    mockApi(vncStatus({ mode: "headless", scale: null }));
    render(<BrowserPanel bot={bot} onClose={vi.fn()} />);

    expect(await screen.findByTestId("browser-headless")).toHaveTextContent(
      "No live view for this browser.",
    );
    expect(screen.getByText("Headless")).toBeInTheDocument();
    expect(screen.getByTestId("browser-url").textContent).toBe("https://example.com/");
    expect(screen.queryByTestId("browser-vnc")).not.toBeInTheDocument();
    expect(screen.queryByTestId("browser-fullscreen")).not.toBeInTheDocument();
    // Without a display there is nothing to take over.
    expect(screen.queryByTestId("browser-takeover")).not.toBeInTheDocument();
    expect(createRfb).not.toHaveBeenCalled();
  });

  it("offers to open a browser that is closed, then follows it opening", async () => {
    const api = mockApi(vncStatus({ active: false, url: null, driver: null, mode: null }));
    render(<BrowserPanel bot={bot} onClose={vi.fn()} />);

    expect(await screen.findByText("No browser is open.")).toBeInTheDocument();
    expect(screen.getByText("Closed")).toBeInTheDocument();
    expect(screen.queryByTestId("browser-takeover")).not.toBeInTheDocument();

    api.set(vncStatus({ active: false, url: null, driver: null, mode: null, starting: true }));
    fireEvent.click(screen.getByTestId("browser-open"));
    await waitFor(() => expect(api.start).toHaveBeenCalledWith("b1"));
    expect(await screen.findByText("Starting the browser")).toBeInTheDocument();
    expect(screen.getByText("Starting")).toBeInTheDocument();

    api.set(vncStatus());
    await connected();
  });

  it("explains the one-time VM setup", async () => {
    mockApi(
      vncStatus({
        active: false,
        url: null,
        driver: null,
        mode: null,
        starting: true,
        phase: "installing",
      }),
    );
    render(<BrowserPanel bot={bot} onClose={vi.fn()} />);
    expect(await screen.findByText("Setting up the browser on the VM")).toBeInTheDocument();
    expect(screen.getByText(/First run only/)).toBeInTheDocument();
    expect(screen.queryByTestId("browser-open")).not.toBeInTheDocument();
  });

  it("shows why the browser failed to open and offers a retry", async () => {
    const api = mockApi(
      vncStatus({
        active: false,
        url: null,
        driver: null,
        mode: null,
        error: "VM exec failed (1): install the browser stack",
      }),
    );
    render(<BrowserPanel bot={bot} onClose={vi.fn()} />);

    expect(await screen.findByTestId("browser-error")).toHaveTextContent("VM exec failed");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(api.start).toHaveBeenCalledWith("b1"));
  });

  it("reset closes the browser and returns to the closed state", async () => {
    const api = mockApi(vncStatus({ profile: "own" }));
    render(<BrowserPanel bot={bot} onClose={vi.fn()} />);
    await connected();

    api.set(vncStatus({ active: false, url: null, driver: null, mode: null }));
    fireEvent.click(screen.getByTestId("browser-reset"));
    expect(await screen.findByText("Reset this bot's browser?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(api.reset).toHaveBeenCalledWith("b1"));
    expect(await screen.findByText("No browser is open.")).toBeInTheDocument();
    await waitFor(() => expect(latestRfb().disconnect).toHaveBeenCalled());
  });

  it("warns that resetting the shared browser signs every bot on it out", async () => {
    const api = mockApi(vncStatus({ profile: "shared" }));
    render(<BrowserPanel bot={bot} onClose={vi.fn()} />);
    await connected();

    fireEvent.click(screen.getByTestId("browser-reset"));
    expect(await screen.findByText("Reset the shared browser?")).toBeInTheDocument();
    expect(screen.getByText(/every bot on the shared profile/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByText("Reset the shared browser?")).toBeNull());
    expect(api.reset).not.toHaveBeenCalled();
  });
});
