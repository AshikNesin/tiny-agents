/**
 * Terminal page behavior (issue #28): status-driven empty/error states, the
 * tab strip off the polled list, close-with-409 force flow, active-tab
 * switching, and the connecting dot fed by each view's connection state.
 * The xterm wrapper and the ws client are mocked (unit-tested elsewhere);
 * no server is involved.
 */
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, beforeEach, expect, it, vi } from "vite-plus/test";
import { MemoryRouter } from "react-router-dom";
import { TerminalPage } from "@/pages/terminal/Terminal";
import { GrootUIProvider } from "@groot/ui";
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

vi.mock("@/lib/xterm", () => ({
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
    onData: vi.fn((listener) => {
      unsubs.push(vi.fn());
      return () => undefined;
    }),
    onResize: vi.fn(() => () => undefined),
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

describe("Terminal page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connections.length = 0;
    createTerminalMock.mockImplementation(async () => fakeTerminal());
    listMock.mockResolvedValue(ready([]));
    createMock.mockResolvedValue(session(1));
    removeMock.mockResolvedValue({ deleted: true });
  });

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
    const tab = await findTab(1);
    expect(tab.querySelector("span[title='Reconnecting']")).not.toBeNull();

    await waitFor(() => expect(connections.length).toBeGreaterThan(0));
    connections[0]!.handlers.onStateChange("live");
    await waitFor(() => expect(tab.querySelector("span[title='Reconnecting']")).toBeNull());
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
        Object.assign(new Error("Conflict"), {
          isAxiosError: true,
          response: {
            status: 409,
            data: { error: { message: "ta-term-1 is running vim.", details: { process: "vim" } } },
          },
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
