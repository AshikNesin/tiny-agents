/**
 * Terminal page behavior (issue #28): status-driven empty/error states, the
 * tab strip off the polled list, close-with-409 force flow, active-tab
 * switching, and the connecting dot fed by each view's connection state.
 * The xterm wrapper and the ws client are mocked (unit-tested elsewhere);
 * no server is involved.
 */
import React from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, beforeEach, expect, it, vi } from "vite-plus/test";
import { act } from "react";
import { MemoryRouter } from "react-router-dom";
import { TerminalPage } from "@/pages/terminal/Terminal";
import { GrootUIProvider } from "@groot/ui";
import { ApiError } from "@groot/shell/lib/api";
import type { TerminalHandle } from "@/lib/xterm";
import type { TerminalConnection } from "@/lib/terminal-ws";

const listMock = vi.fn();
const createMock = vi.fn();
const removeMock = vi.fn();

vi.mock("@/lib/terminal-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/terminal-api")>();
  return {
    ...original,
    terminalApi: {
      list: (...args: unknown[]) => listMock(...args),
      create: (...args: unknown[]) => createMock(...args),
      remove: (...args: unknown[]) => removeMock(...args),
      ticket: vi.fn(),
    },
  };
});

/** Each connection's handlers, captured so tests can drive states. */
const connections: {
  handlers: { onData: (bytes: Uint8Array) => void; onStateChange: (state: string) => void };
  connection: TerminalConnection;
}[] = [];

const createTerminalMock = vi.fn();

vi.mock("@/lib/xterm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/xterm")>()),
  createTerminal: (...args: unknown[]) => createTerminalMock(...args),
}));

vi.mock("@/lib/terminal-ws", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/terminal-ws")>();
  return {
    ...original,
    connectTerminal: (
      name: string,
      handlers: { onData: (bytes: Uint8Array) => void; onStateChange: (state: string) => void },
    ) => {
      const connection: TerminalConnection = {
        sendInput: vi.fn(),
        sendResize: vi.fn(),
        written: vi.fn(),
        close: vi.fn(),
      };
      connections.push({ handlers, connection });
      return connection;
    },
  };
});

function fakeTerminal(): TerminalHandle {
  const unsubs = [vi.fn()];
  return {
    term: {
      attachCustomKeyEventHandler: vi.fn(),
      hasSelection: vi.fn(() => false),
      getSelection: vi.fn(() => ""),
      focus: vi.fn(),
    },
    cols: 80,
    rows: 24,
    write: vi.fn(),
    onData: vi.fn((_listener) => {
      unsubs.push(vi.fn());
      return () => undefined;
    }),
    onResize: vi.fn(() => () => undefined),
    paste: vi.fn(),
    hasSelection: vi.fn(() => false),
    copySelection: vi.fn(async () => false),
    selectAll: vi.fn(),
    reset: vi.fn(),
    setFontSize: vi.fn(),
    fit: vi.fn(() => null),
    proposeDimensions: vi.fn(() => null),
    setTheme: vi.fn(),
    focus: vi.fn(),
    dispose: vi.fn(),
  } as unknown as TerminalHandle;
}

const ready = (sessions: unknown[]) => ({
  status: { kind: "ready" },
  sessions,
});

const session = (n: number, process: string | null = null) => ({
  name: `ta-term-${n}`,
  process,
  attached: false,
  createdAt: "2025-01-01T00:00:00.000Z",
});

function mount() {
  return render(
    <React.StrictMode>
      <MemoryRouter>
        <GrootUIProvider>
          <TerminalPage />
        </GrootUIProvider>
      </MemoryRouter>
    </React.StrictMode>,
  );
}

async function findTab(n: number) {
  return await screen.findByTestId(`terminal-tab-ta-term-${n}`);
}

/**
 * The pty bytes each sendInput call carried, as plain arrays: this stack's
 * deep-equal does not match TextEncoder output against a constructed
 * Uint8Array, but the bytes themselves are the observable contract.
 */
function sentBytes(connection: TerminalConnection): number[][] {
  return vi.mocked(connection.sendInput).mock.calls.map((call) => Array.from(call[0]!));
}

beforeEach(() => {
  vi.clearAllMocks();
  // No auto-cleanup in this environment: a leaked tree's 5s poll keeps
  // answering the current test's mocked list and mounting views into it.
  cleanup();
  connections.length = 0;
  window.localStorage.clear();
  createTerminalMock.mockImplementation(async () => fakeTerminal());
  listMock.mockResolvedValue(ready([]));
  createMock.mockResolvedValue(session(1));
  removeMock.mockResolvedValue({ deleted: true });
});

describe("Terminal page", () => {
  it("renders the unconfigured empty state", async () => {
    listMock.mockResolvedValue({ status: { kind: "unconfigured" }, sessions: [] });
    mount();
    expect(await screen.findByText("Sandbox not configured")).toBeTruthy();
    expect(screen.getByText(/SANDBOX_HOST/)).toBeTruthy();
  });

  it("renders tmux-missing with the install command", async () => {
    listMock.mockResolvedValue({
      status: { kind: "tmux-missing", installCommand: "sudo apt install tmux" },
      sessions: [],
    });
    mount();
    expect(await screen.findByText(/tmux is not installed/)).toBeTruthy();
    expect(screen.getByText("sudo apt install tmux")).toBeTruthy();
  });

  it("renders unreachable as an error state with retry", async () => {
    listMock.mockResolvedValue({
      status: { kind: "unreachable", message: "SSH connection refused" },
      sessions: [],
    });
    mount();
    expect(await screen.findByText("Sandbox unreachable")).toBeTruthy();
    expect(screen.getByText("SSH connection refused")).toBeTruthy();
    expect(screen.getByTestId("terminal-retry")).toBeTruthy();
  });

  it("creates the first tab from the ready empty state", async () => {
    mount();
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await screen.findByText("No tabs open");
    await user.click(screen.getByRole("button", { name: "Open your first tab" }));
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
  });

  it("renders tabs from the list with the process suffix", async () => {
    listMock.mockResolvedValue(ready([session(1, "vim"), session(2)]));
    mount();
    const tab1 = await findTab(1);
    expect(within(tab1).getByText("1")).toBeTruthy();
    expect(within(tab1).getByText("vim")).toBeTruthy();
    const tab2 = screen.getByTestId("terminal-tab-ta-term-2");
    expect(within(tab2).queryByText("vim")).toBeNull();
    expect(within(tab2).getByText("2")).toBeTruthy();
  });

  it("shows the connecting dot until a view reports live", async () => {
    listMock.mockResolvedValue(ready([session(1)]));
    mount();
    await findTab(1);
    const dot = () => screen.getByTestId("terminal-tab-status-ta-term-1");
    expect(dot().getAttribute("data-state")).toBe("connecting");

    await waitFor(() => expect(connections.length).toBeGreaterThan(0));
    connections[0]!.handlers.onStateChange("live");
    await waitFor(() => expect(dot().getAttribute("data-state")).toBe("live"));
  });

  it("says it is connecting while the first list is in flight", async () => {
    let answer!: (value: unknown) => void;
    listMock.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    mount();
    expect(await screen.findByText("Connecting to sandbox…")).toBeTruthy();
    expect(screen.queryByText("No tabs open")).toBeNull();
    await act(async () => answer(ready([])));
    expect(await screen.findByText("No tabs open")).toBeTruthy();
  });

  it("shows Connecting to sandbox in the pane until the first pty bytes", async () => {
    listMock.mockResolvedValue(ready([session(1)]));
    mount();
    expect(await screen.findByTestId("terminal-connecting-ta-term-1")).toBeTruthy();
    await waitFor(() => expect(connections.length).toBeGreaterThan(0));
    // The socket opening is not enough: tmux has not painted anything yet.
    act(() => connections[0]!.handlers.onStateChange("live"));
    expect(screen.getByTestId("terminal-connecting-ta-term-1")).toBeTruthy();
    act(() => connections[0]!.handlers.onData(new Uint8Array([36, 32])));
    await waitFor(() => expect(screen.queryByTestId("terminal-connecting-ta-term-1")).toBeNull());
  });

  it("switches the active tab on click", async () => {
    listMock.mockResolvedValue(ready([session(1), session(2)]));
    mount();
    const tab1 = await findTab(1);
    await waitFor(() => expect(connections.length).toBe(2));
    connections[0]!.handlers.onStateChange("live");
    connections[1]!.handlers.onStateChange("live");
    await waitFor(() => expect(tab1.getAttribute("aria-selected")).toBe("true"));

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(screen.getByTestId("terminal-tab-ta-term-2"));
    await waitFor(() =>
      expect(screen.getByTestId("terminal-tab-ta-term-2").getAttribute("aria-selected")).toBe(
        "true",
      ),
    );
    expect(screen.getByTestId("terminal-tab-ta-term-1").getAttribute("aria-selected")).toBe(
      "false",
    );
  });

  it("closes a tab on × without a dialog", async () => {
    listMock.mockResolvedValue(ready([session(1)]));
    mount();
    await findTab(1);
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(screen.getByTestId("terminal-close-ta-term-1"));
    await waitFor(() => expect(removeMock).toHaveBeenCalledWith("ta-term-1", false));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("confirms with the process name and force-closes on 409", async () => {
    listMock.mockResolvedValue(ready([session(1, "vim")]));
    removeMock
      .mockRejectedValueOnce(
        new ApiError({
          status: 409,
          code: "CONFLICT",
          message: "ta-term-1 is running vim.",
          details: { process: "vim" },
          url: "/terminal/sessions/ta-term-1",
        }),
      )
      .mockResolvedValueOnce({ deleted: true });
    mount();
    await findTab(1);
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(screen.getByTestId("terminal-close-ta-term-1"));

    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    expect(screen.getByText(/vim is running/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Force close" }));
    await waitFor(() => expect(removeMock).toHaveBeenCalledWith("ta-term-1", true));
  });

  it("falls forward to the first tab when the active one disappears", async () => {
    listMock.mockResolvedValue(ready([session(1), session(2)]));
    mount();
    await findTab(1);
    await waitFor(() => expect(connections.length).toBe(2));

    listMock.mockResolvedValue(ready([session(2)]));
    window.dispatchEvent(new Event("focus"));
    await waitFor(() =>
      expect(screen.getByTestId("terminal-tab-ta-term-2").getAttribute("aria-selected")).toBe(
        "true",
      ),
    );
  });
});

describe("Terminal keys panel", () => {
  /** Mount with one live tab and return its captured connection. */
  async function mountLive(n = 1) {
    listMock.mockResolvedValue(ready([session(n)]));
    mount();
    await findTab(n);
    await waitFor(() => expect(connections.length).toBe(1));
    return connections[0]!;
  }

  it("sends a key's bytes to the active view and focuses it", async () => {
    const { connection } = await mountLive();
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    await user.click(screen.getByTestId("terminal-key-esc"));
    await user.click(screen.getByTestId("terminal-key-arrow-up"));
    await user.click(screen.getByTestId("terminal-key-pgdn"));
    expect(sentBytes(connection)).toEqual([[0x1b], [0x1b, 0x5b, 0x41], [0x1b, 0x5b, 0x36, 0x7e]]);
  });

  it("composes ctrl with a letter and alt with any character", async () => {
    const { connection } = await mountLive();
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    // ctrl masks a typeable character to its control byte.
    await user.click(screen.getByTestId("terminal-key-ctrl"));
    expect(screen.getByTestId("terminal-key-ctrl").getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByTestId("terminal-key-tilde"));
    // ~ is not a letter: ctrl does not mask it, but it is consumed.
    expect(sentBytes(connection)).toEqual([[0x7e]]);
    expect(screen.getByTestId("terminal-key-ctrl").getAttribute("aria-pressed")).toBe("false");

    await user.click(screen.getByTestId("terminal-key-alt"));
    await user.click(screen.getByTestId("terminal-key-tilde"));
    expect(sentBytes(connection)).toEqual([[0x7e], [0x1b, 0x7e]]);
  });

  it("ctrl composes the ctrl+letter combo on a ready-made control key", async () => {
    const { connection } = await mountLive();
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    // ^L is already Ctrl+L; sticky ctrl must not double-mask it.
    await user.click(screen.getByTestId("terminal-key-ctrl"));
    await user.click(screen.getByTestId("terminal-key-ctrl-l"));
    expect(sentBytes(connection)).toEqual([[0x0c]]);
    expect(screen.getByTestId("terminal-key-ctrl").getAttribute("aria-pressed")).toBe("false");
  });

  /** The fake xterm handle the live view was given. */
  async function liveTerminal(): Promise<TerminalHandle> {
    return (await createTerminalMock.mock.results.at(-1)!.value) as TerminalHandle;
  }

  function secureClipboard(clipboard: unknown) {
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
    Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
  }

  it("pastes the clipboard into the active view as a (bracketed) paste", async () => {
    const { connection } = await mountLive();
    const terminal = await liveTerminal();
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    secureClipboard({ readText: vi.fn().mockResolvedValue("ls\npwd") });

    await user.click(screen.getByTestId("terminal-key-paste"));
    // Through xterm's paste, never raw keystrokes: raw, each line would run
    // the moment it landed.
    await waitFor(() => expect(terminal.paste).toHaveBeenCalledWith("ls\npwd"));
    expect(sentBytes(connection)).toEqual([]);
  });

  it("points at the paste shortcut when the clipboard is refused", async () => {
    await mountLive();
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    secureClipboard({ readText: vi.fn().mockRejectedValue(new Error("denied")) });

    await user.click(screen.getByTestId("terminal-key-paste"));
    expect(await screen.findByText(/Press (Ctrl\+V|⌘V) to paste/)).toBeTruthy();
    expect(screen.getByText(/blocked clipboard access/)).toBeTruthy();
  });

  it("explains plain-http pages, where the clipboard API does not exist", async () => {
    await mountLive();
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    Object.defineProperty(window, "isSecureContext", { value: false, configurable: true });

    await user.click(screen.getByTestId("terminal-key-paste"));
    expect(await screen.findByText(/isn't served over https/)).toBeTruthy();
  });

  it("re-attaches into a clean terminal after a reconnect", async () => {
    const { handlers } = await mountLive();
    const terminal = await liveTerminal();
    act(() => handlers.onStateChange("live"));
    expect(terminal.reset).not.toHaveBeenCalled();
    act(() => handlers.onStateChange("reconnecting"));
    expect(await screen.findByTestId("terminal-reconnecting-ta-term-1")).toBeTruthy();
    act(() => handlers.onStateChange("live"));
    expect(terminal.reset).toHaveBeenCalledTimes(1);
  });

  it("steps the font size from the toolbar and remembers it", async () => {
    await mountLive();
    const terminal = await liveTerminal();
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    await user.click(screen.getByTestId("terminal-font-up"));
    await user.click(screen.getByTestId("terminal-font-up"));
    expect(screen.getByTestId("terminal-font-size").textContent).toBe("16");
    await waitFor(() => expect(terminal.setFontSize).toHaveBeenLastCalledWith(16));
    expect(window.localStorage.getItem("tiny-agents:terminal-font-size")).toBe("16");

    await user.click(screen.getByTestId("terminal-font-size"));
    expect(screen.getByTestId("terminal-font-size").textContent).toBe("14");
  });

  it("hides on the header toggle and remembers the choice", async () => {
    await mountLive();
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    await user.click(screen.getByTestId("terminal-keys-toggle"));
    expect(screen.queryByTestId("terminal-keys-panel")).toBeNull();
    expect(window.localStorage.getItem("tiny-agents:terminal-keys")).toBe("0");

    await user.click(screen.getByTestId("terminal-keys-toggle"));
    expect(screen.getByTestId("terminal-keys-panel")).toBeTruthy();
    expect(window.localStorage.getItem("tiny-agents:terminal-keys")).toBe("1");
  });

  it("collapses from the panel itself", async () => {
    await mountLive();
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(screen.getByTestId("terminal-keys-collapse"));
    expect(screen.queryByTestId("terminal-keys-panel")).toBeNull();
  });

  it("renders no panel without an active tab", async () => {
    mount();
    await screen.findByText("No tabs open");
    expect(screen.queryByTestId("terminal-keys-panel")).toBeNull();
  });
});

describe("Terminal full screen", () => {
  it("enters via the Fullscreen API and exits with its events", async () => {
    listMock.mockResolvedValue(ready([session(1)]));
    mount();
    await findTab(1);
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const toggle = screen.getByTestId("terminal-fullscreen");
    expect(toggle.getAttribute("aria-label")).toBe("Full screen");

    const request = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn().mockResolvedValue(undefined);
    // jsdom ships none of the Fullscreen API; install the bits the page reads.
    let fullscreenElement: Element | null = null;
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => fullscreenElement,
    });
    Object.defineProperty(document, "exitFullscreen", { value: exit, configurable: true });
    const region = screen.getByTestId("terminal-region");
    Object.defineProperty(region, "requestFullscreen", { value: request, configurable: true });

    await user.click(toggle);
    expect(request).toHaveBeenCalledTimes(1);
    // In full screen the header toggle is covered, so it gives way to an exit
    // control inside the region (#170).
    expect(screen.queryByTestId("terminal-fullscreen")).toBeNull();
    expect(
      within(screen.getByTestId("terminal-region")).getByRole("button", {
        name: "Exit full screen",
      }),
    ).toBeTruthy();

    fullscreenElement = region;
    await act(async () => {
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    expect(screen.getByTestId("terminal-region").className).toContain("fixed");

    fullscreenElement = null;
    await act(async () => {
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    expect(screen.getByTestId("terminal-region").className).not.toContain("fixed");
    expect(screen.getByTestId("terminal-fullscreen").getAttribute("aria-label")).toBe(
      "Full screen",
    );
    expect(screen.queryByTestId("terminal-exit-fullscreen")).toBeNull();
    expect(exit).not.toHaveBeenCalled();
  });

  it("falls back to CSS full screen without the Fullscreen API", async () => {
    listMock.mockResolvedValue(ready([session(1)]));
    mount();
    await findTab(1);
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    await user.click(screen.getByTestId("terminal-fullscreen"));
    const region = screen.getByTestId("terminal-region");
    expect(region.className).toContain("fixed");
    // The region covers the page header: the way out must live inside it (#170).
    await user.click(within(region).getByRole("button", { name: "Exit full screen" }));
    expect(screen.getByTestId("terminal-region").className).not.toContain("fixed");
    expect(screen.getByTestId("terminal-fullscreen").getAttribute("aria-label")).toBe(
      "Full screen",
    );
  });
});
