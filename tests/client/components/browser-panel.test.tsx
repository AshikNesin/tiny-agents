/**
 * @vitest-environment jsdom
 *
 * BrowserPanel (issue #24): the VNC-streamed browser — connect/reconnect,
 * take control and release, clipboard, full screen, fitting the remote
 * window — plus the headless and closed states. noVNC itself is faked; its
 * canvas needs a real browser (covered by the live check against the VM).
 */
import React from "react";
import {
  act,
  fireEvent,
  render as rtlRender,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vite-plus/test";
import { MemoryRouter } from "react-router-dom";
import { ConfirmProvider } from "@groot/ui/primitives";
import { BrowserPanel } from "@/components/BrowserPanel";
import type { Bot } from "../../../apps/web/src/shared/api/bots";
import type { BrowserStatus } from "../../../apps/web/src/shared/api/live";
import { createRfb } from "@/lib/novnc";
import { usePeopleStore } from "@/store/people";
import { ApiFailure } from "../fakes/api";
import { browserBackend } from "./live-backend";

const fakes = vi.hoisted(() => ({ rfbs: [] as FakeRfb[] }));

interface FakeRfb extends EventTarget {
  viewOnly: boolean;
  resizeSession?: boolean;
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
  questions: 0,
  pinnedAt: null,
  unread: false,
  replying: false,
} as unknown as Bot;

const render = (ui: React.ReactElement) =>
  rtlRender(
    <MemoryRouter>
      <ConfirmProvider>{ui}</ConfirmProvider>
    </MemoryRouter>,
  );

const vncStatus = (s: Partial<BrowserStatus> = {}): BrowserStatus => ({
  active: true,
  profile: "shared",
  url: "https://example.com/",
  driver: "agent",
  mode: "vnc",
  scale: 2,
  starting: false,
  phase: null,
  error: null,
  ...s,
});

const mockApi = browserBackend;

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
const connected = async () => {
  await waitFor(() => expect(fakes.rfbs.length).toBeGreaterThan(0), { timeout: 4000 });
  act(() => {
    latestRfb().dispatchEvent(new Event("connect"));
  });
  await screen.findByTestId("browser-driver");
};

describe("BrowserPanel", () => {
  beforeEach(() => {
    fakes.rfbs.length = 0;
    vi.mocked(createRfb).mockClear();
    window.localStorage.clear();
    usePeopleStore.setState({ role: "owner" });
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
    expect(screen.getByTestId("browser-driver").textContent).toBe("Surfer is driving");
    expect(screen.queryByTestId("browser-url")).not.toBeInTheDocument();
    expect(screen.getByTestId("browser-takeover")).toBeEnabled();
    expect(screen.queryByTestId("browser-paste")).not.toBeInTheDocument();
  });

  it("lets a guest watch only: no take control, paste, reset, open or window fit (S2)", async () => {
    usePeopleStore.setState({ role: "guest" });
    onTestFinished(() => usePeopleStore.setState({ role: null }));
    const api = mockApi(vncStatus());
    render(<BrowserPanel bot={bot} onClose={vi.fn()} />);
    await connected();

    expect(latestRfb().viewOnly).toBe(true);
    expect(screen.queryByTestId("browser-takeover")).not.toBeInTheDocument();
    expect(screen.queryByTestId("browser-paste")).not.toBeInTheDocument();
    expect(screen.queryByTestId("browser-reset")).not.toBeInTheDocument();
    expect(screen.getByTestId("browser-fullscreen")).toBeInTheDocument();
    expect(api.resizes()).toHaveLength(0);
  });

  it("offers a guest no way to open a closed browser (S2)", async () => {
    usePeopleStore.setState({ role: "guest" });
    onTestFinished(() => usePeopleStore.setState({ role: null }));
    mockApi(vncStatus({ active: false, mode: null, driver: null, url: null }));
    render(<BrowserPanel bot={bot} onClose={vi.fn()} />);
    expect(await screen.findByText("No browser is open.")).toBeInTheDocument();
    expect(screen.queryByTestId("browser-open")).not.toBeInTheDocument();
  });

  it("titles the card and labels its tools", async () => {
    mockApi(vncStatus());
    render(<BrowserPanel bot={bot} onClose={vi.fn()} />);
    await connected();

    expect(screen.getByRole("heading", { name: "Browser" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Take control" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Full screen" })).toHaveTextContent("");
    expect(screen.getByRole("button", { name: "Reset browser profile" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close browser panel" })).toBeInTheDocument();
  });

  it("clicking the stream takes control; Hand back returns it", async () => {
    const api = mockApi(vncStatus());
    render(<BrowserPanel bot={bot} onClose={vi.fn()} />);
    await connected();

    const viewport = screen.getByTestId("browser-viewport");
    fireEvent.click(within(viewport).getByRole("button", { name: "Take control" }));
    await waitFor(() => expect(api.drivers()).toContain("human"));
    await waitFor(() => expect(latestRfb().viewOnly).toBe(false));
    expect(latestRfb().focus).toHaveBeenCalled();
    expect(screen.getByTestId("browser-driver").textContent).toBe("You're driving");
    expect(screen.queryByTestId("browser-takeover")).not.toBeInTheDocument();
    expect(within(viewport).getByTestId("browser-driving-frame")).toBeInTheDocument();
    expect(screen.queryByTestId("browser-url")).not.toBeInTheDocument();
    expect(screen.getByTestId("browser-paste")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hand back" })).toBe(
      screen.getByTestId("browser-release"),
    );

    const polls = api.statuses().length;
    api.set(vncStatus({ url: "https://example.org/", driver: "agent" }));
    fireEvent.click(screen.getByTestId("browser-release"));
    await waitFor(() => expect(api.drivers()).toContain("agent"));
    await waitFor(() => expect(latestRfb().viewOnly).toBe(true));
    await waitFor(() => expect(api.statuses().length).toBeGreaterThan(polls));
    expect(screen.getByTestId("browser-driver").textContent).toBe("Surfer is driving");
    expect(screen.queryByTestId("browser-driving-frame")).not.toBeInTheDocument();
  });

  it("offers no take-over click until the stream is live", async () => {
    mockApi(vncStatus());
    render(<BrowserPanel bot={bot} onClose={vi.fn()} />);
    await waitFor(() => expect(fakes.rfbs.length).toBeGreaterThan(0), { timeout: 4000 });
    expect(screen.getByText("Connecting")).toBeInTheDocument();
    expect(screen.queryByTestId("browser-takeover")).not.toBeInTheDocument();
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
      await waitFor(() => expect(api.resizes()).toContainEqual({ width: 801, height: 600 }), {
        timeout: 2000,
      });
      const burst = api.resizes().filter((size) => size.width === 801).length;
      expect(burst).toBeLessThanOrEqual(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("offers picture in picture from the docked panel", async () => {
    mockApi(vncStatus());
    const onLayout = vi.fn();
    render(<BrowserPanel bot={bot} onClose={vi.fn()} onLayout={onLayout} />);
    await connected();

    fireEvent.click(screen.getByRole("button", { name: "Picture in picture" }));
    expect(onLayout).toHaveBeenCalledWith("pip");
  });

  it("in picture in picture, only watches: no take control, no window fit, a click expands", async () => {
    const api = mockApi(vncStatus());
    const observer = stubResizeObserver();
    const onLayout = vi.fn();
    try {
      render(<BrowserPanel bot={bot} onClose={vi.fn()} layout="pip" onLayout={onLayout} />);
      await connected();

      const panel = screen.getByTestId("browser-panel");
      expect(panel).toHaveAttribute("data-layout", "pip");
      expect(screen.getByTestId("browser-driver").textContent).toBe("Surfer is driving");
      expect(screen.queryByRole("button", { name: "Take control" })).not.toBeInTheDocument();
      expect(screen.queryByTestId("browser-fullscreen")).not.toBeInTheDocument();
      expect(screen.queryByTestId("browser-reset")).not.toBeInTheDocument();
      expect(screen.queryByRole("separator")).not.toBeInTheDocument();

      expect(latestRfb().resizeSession).toBe(false);
      observer.notify();
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(api.resizes()).toHaveLength(0);

      fireEvent.click(screen.getByTestId("browser-pip-expand-stream"));
      expect(onLayout).toHaveBeenLastCalledWith("docked");
      fireEvent.click(screen.getByTestId("browser-pip-expand"));
      expect(onLayout).toHaveBeenCalledTimes(2);
      expect(screen.getByRole("button", { name: "Close browser panel" })).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("shapes the picture in picture like the remote display, within bounds", async () => {
    mockApi(vncStatus());
    render(<BrowserPanel bot={bot} onClose={vi.fn()} layout="pip" onLayout={vi.fn()} />);
    await connected();
    const viewport = screen.getByTestId("browser-viewport");
    const ratio = () => Number.parseFloat(viewport.style.aspectRatio);
    expect(ratio()).toBe(1.6);

    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 900;
    act(() => {
      screen.getByTestId("browser-vnc").appendChild(canvas);
    });
    await waitFor(() => expect(ratio()).toBeCloseTo(4 / 3));

    act(() => {
      canvas.width = 700;
      canvas.height = 1600;
    });
    await waitFor(() => expect(ratio()).toBe(0.5));
  });

  it("in picture in picture, keeps Hand back while the owner drives", async () => {
    const api = mockApi(vncStatus({ driver: "human" }));
    render(<BrowserPanel bot={bot} onClose={vi.fn()} layout="pip" onLayout={vi.fn()} />);
    await connected();
    expect(latestRfb().viewOnly).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Hand back" }));
    await waitFor(() => expect(api.drivers()).toContain("agent"));
  });

  it("drags the picture in picture by its header and remembers where", async () => {
    mockApi(vncStatus());
    const { unmount } = render(
      <BrowserPanel bot={bot} onClose={vi.fn()} layout="pip" onLayout={vi.fn()} />,
    );
    await connected();
    const panel = screen.getByTestId("browser-panel");
    expect(panel.style.right).toContain("16px");
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({
      left: 688,
      right: 1008,
      top: 456,
      bottom: 656,
      width: 320,
      height: 200,
    } as DOMRect);
    const handle = screen.getByTestId("browser-pip-handle");
    fireEvent.pointerDown(handle, { clientX: 700, clientY: 470, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 300, clientY: 170, pointerId: 1 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(panel.style.right).toContain("416px");
    expect(panel.style.bottom).toContain("412px");

    unmount();
    render(<BrowserPanel bot={bot} onClose={vi.fn()} layout="pip" onLayout={vi.fn()} />);
    expect(screen.getByTestId("browser-panel").style.right).toContain("416px");
  });

  it("asks for a window Chrome can draw when the viewer is narrower than that", async () => {
    const api = mockApi(vncStatus());
    stubResizeObserver();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 352,
      height: 828,
    } as DOMRect);
    try {
      render(<BrowserPanel bot={bot} onClose={vi.fn()} />);
      await connected();

      await waitFor(() => expect(api.resizes()).toContainEqual({ width: 500, height: 1176 }), {
        timeout: 2000,
      });
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
    api.api.post.once(
      "/bots/b1/browser/resize",
      (request) => new Promise((resolve) => (finishFirst = () => resolve(request.body))),
    );
    try {
      render(<BrowserPanel bot={bot} onClose={vi.fn()} />);
      await connected();
      await waitFor(() => expect(api.resizes()).toHaveLength(1), { timeout: 2000 });
      box = { width: 1440, height: 900 };
      observer.notify();
      await new Promise((resolve) => setTimeout(resolve, 700));
      expect(api.resizes()).toHaveLength(1);

      finishFirst();
      await waitFor(() => expect(api.resizes()).toHaveLength(2), { timeout: 2000 });
      expect(api.resizes().at(-1)).toEqual({ width: 1440, height: 900 });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("retries a fit that failed, a couple of times, then leaves it", async () => {
    const api = mockApi(vncStatus());
    api.api.post("/bots/b1/browser/resize", () => {
      throw new ApiFailure(502, "The browser could not be resized");
    });
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

      await advance(350);
      expect(api.resizes()).toHaveLength(1);
      await advance(1000);
      expect(api.resizes()).toHaveLength(2);
      await advance(1000);
      expect(api.resizes()).toHaveLength(3);
      await advance(10_000);
      expect(api.resizes()).toHaveLength(3);
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
    expect(api.tickets()).toHaveLength(2);
    act(() => {
      latestRfb().dispatchEvent(new Event("connect"));
    });
    await screen.findByTestId("browser-driver");
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
    const innerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1600 });
    onTestFinished(() => {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: innerWidth });
    });
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
    await waitFor(() => expect(api.starts()).not.toHaveLength(0));
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
    await waitFor(() => expect(api.starts()).not.toHaveLength(0));
  });

  it("reset closes the browser and returns to the closed state", async () => {
    const api = mockApi(vncStatus({ profile: "own" }));
    render(<BrowserPanel bot={bot} onClose={vi.fn()} />);
    await connected();

    api.set(vncStatus({ active: false, url: null, driver: null, mode: null }));
    fireEvent.click(screen.getByTestId("browser-reset"));
    expect(await screen.findByText("Reset this bot's browser?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(api.resets()).not.toHaveLength(0));
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
    expect(api.resets()).toHaveLength(0);
  });
});
