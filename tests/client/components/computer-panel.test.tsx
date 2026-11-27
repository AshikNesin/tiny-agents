/**
 * @vitest-environment jsdom
 *
 * ComputerPanel (issue #108): the bot's desktop streamed over VNC at a fixed
 * size the viewer only scales, take control and release (and the bot's own
 * takeover request), plus the not-set-up, starting and closed states. noVNC
 * is faked; its canvas needs a real browser.
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
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { MemoryRouter } from "react-router-dom";
import { ConfirmProvider } from "@groot/ui/primitives";
import { ComputerPanel } from "@/components/ComputerPanel";
import type { Bot } from "../../../apps/web/src/shared/api/bots";
import type { ComputerStatus } from "../../../apps/web/src/shared/api/live";
import { createRfb } from "@/lib/novnc";
import { usePeopleStore } from "@/store/people";
import { computerBackend } from "./live-backend";

const fakes = vi.hoisted(() => ({ rfbs: [] as (EventTarget & { viewOnly: boolean })[] }));

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
    fakes.rfbs.push(rfb);
    return rfb;
  }),
}));

const bot = { id: "b1", name: "Clicker", conversationId: "1" } as unknown as Bot;

const render = (ui: React.ReactElement) =>
  rtlRender(
    <MemoryRouter>
      <ConfirmProvider>{ui}</ConfirmProvider>
    </MemoryRouter>,
  );

const liveStatus = (s: Partial<ComputerStatus> = {}): ComputerStatus => ({
  configured: true,
  setupHint: null,
  active: true,
  profile: "shared",
  driver: "agent",
  width: 1280,
  height: 800,
  takeover: null,
  starting: false,
  phase: null,
  error: null,
  ...s,
});

const mockApi = computerBackend;

const connected = async () => {
  await waitFor(() => expect(fakes.rfbs.length).toBeGreaterThan(0), { timeout: 4000 });
  act(() => {
    fakes.rfbs[fakes.rfbs.length - 1]!.dispatchEvent(new Event("connect"));
  });
  await screen.findByTestId("computer-driver");
};

describe("ComputerPanel", () => {
  beforeEach(() => {
    fakes.rfbs.length = 0;
    vi.mocked(createRfb).mockClear();
    window.localStorage.clear();
    usePeopleStore.setState({ role: "owner" });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("streams the desktop at its fixed size without asking it to resize", async () => {
    const api = mockApi(liveStatus());
    render(<ComputerPanel bot={bot} onClose={vi.fn()} />);
    await screen.findByTestId("computer-vnc");
    await waitFor(() => expect(createRfb).toHaveBeenCalledTimes(1));
    expect(createRfb).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.stringMatching(/\/api\/v1\/bots\/b1\/computer\/vnc\?ticket=t1$/),
      1,
      { remoteResize: false },
    );
    await connected();
    expect(screen.getByTestId("computer-driver").textContent).toBe("Clicker is driving");
    expect(screen.queryByText("1280×800")).not.toBeInTheDocument();
    expect(fakes.rfbs[0]!.viewOnly).toBe(true);
    expect(api.resizes()).toHaveLength(0);
    expect(api.api.sent("POST", "/bots/b1/browser/resize")).toHaveLength(0);
  });

  it("takes control from a click on the desktop and hands it back", async () => {
    const api = mockApi(liveStatus());
    render(<ComputerPanel bot={bot} onClose={vi.fn()} />);
    await connected();
    const viewport = screen.getByTestId("computer-viewport");
    fireEvent.click(within(viewport).getByRole("button", { name: "Take control" }));
    await waitFor(() => expect(api.drivers()).toContain("human"));
    await waitFor(() => expect(fakes.rfbs[0]!.viewOnly).toBe(false));
    expect(screen.getByTestId("computer-driver").textContent).toBe("You're driving");
    expect(within(viewport).getByTestId("computer-driving-frame")).toBeInTheDocument();
    expect(screen.getByTestId("computer-paste")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("computer-release"));
    await waitFor(() => expect(api.drivers()).toContain("agent"));
    await waitFor(() => expect(fakes.rfbs[0]!.viewOnly).toBe(true));
  });

  it("shows what the bot asked for during its takeover request, and hands back with I'm done", async () => {
    const api = mockApi(liveStatus({ driver: "human", takeover: "Sign in to the mail app" }));
    render(<ComputerPanel bot={bot} onClose={vi.fn()} />);
    expect(await screen.findByTestId("computer-takeover-reason")).toHaveTextContent(
      "Sign in to the mail app",
    );
    fireEvent.click(screen.getByText("I'm done"));
    await waitFor(() => expect(api.drivers()).toContain("agent"));
    await waitFor(() =>
      expect(screen.queryByTestId("computer-takeover-reason")).not.toBeInTheDocument(),
    );
  });

  it("says why there is no computer without a sandbox VM", async () => {
    mockApi(
      liveStatus({
        configured: false,
        active: false,
        driver: null,
        setupHint: "Set SANDBOX_HOST to give bots a computer on the sandbox VM.",
      }),
    );
    render(<ComputerPanel bot={bot} onClose={vi.fn()} />);
    expect(await screen.findByTestId("computer-setup-hint")).toHaveTextContent("SANDBOX_HOST");
    expect(screen.queryByTestId("computer-open")).not.toBeInTheDocument();
    expect(screen.queryByTestId("computer-reset")).not.toBeInTheDocument();
  });

  it("opens a closed computer and shows the first-run setup", async () => {
    const api = mockApi(liveStatus({ active: false, driver: null }));
    render(<ComputerPanel bot={bot} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByTestId("computer-open"));
    await waitFor(() => expect(api.starts()).not.toHaveLength(0));
    act(() => {
      api.set(liveStatus({ active: false, driver: null, starting: true, phase: "installing" }));
    });
    expect(
      await screen.findByText("Setting up the computer on the VM", {}, { timeout: 5000 }),
    ).toBeInTheDocument();
  });
});
