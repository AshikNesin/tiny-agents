/**
 * @vitest-environment jsdom
 *
 * The chat's two live-view panels (`BrowserPanel`, `ComputerPanel`) pinned
 * state by state: the element tree with roles, names, test ids and text,
 * and the whole markup, in every state a mocked status reaches (before the
 * first status, not set up, closed, starting, first-run setup, failed,
 * headless, connecting, live, driving, a bot's takeover request, a guest,
 * a bot with its own profile), plus each reset's confirm and toast, each
 * failed open's toast, and the poll's cadence. Recorded on the two separate
 * panels before they became one (docs/rewrite/PLAN.md row 5.5), so the
 * shared panel must render each state the same. noVNC is faked.
 */
import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { MemoryRouter } from "react-router-dom";
import { toast } from "sonner";
import { GrootUIProvider } from "@groot/ui";
import { BrowserPanel } from "@/components/BrowserPanel";
import { ComputerPanel } from "@/components/ComputerPanel";
import type { Bot } from "../../../apps/web/src/shared/api/bots";
import type { BrowserStatus, ComputerStatus } from "../../../apps/web/src/shared/api/live";
import { botsApi } from "@/lib/bots-api";
import { createRfb } from "@/lib/novnc";
import { usePeopleStore } from "@/store/people";
import { markup, outline } from "../dom-outline";

const fakes = vi.hoisted(() => ({ rfbs: [] as EventTarget[] }));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() }, Toaster: () => null }));
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

const bot = { id: "b1", name: "Surfer", conversationId: "1" } as unknown as Bot;

const browser = (s: Partial<BrowserStatus> = {}): BrowserStatus => ({
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
const browserClosed = (s: Partial<BrowserStatus> = {}) =>
  browser({ active: false, driver: null, mode: null, url: null, ...s });

const computer = (s: Partial<ComputerStatus> = {}): ComputerStatus => ({
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
const computerOff = (s: Partial<ComputerStatus> = {}) =>
  computer({ active: false, driver: null, ...s });

function mockBrowser(status: BrowserStatus | Promise<BrowserStatus>) {
  return {
    status: vi.spyOn(botsApi, "browserStatus").mockImplementation(() => Promise.resolve(status)),
    driver: vi.spyOn(botsApi, "browserDriver").mockResolvedValue(undefined as never),
    start: vi.spyOn(botsApi, "browserStart").mockResolvedValue({ starting: true }),
    ticket: vi.spyOn(botsApi, "browserVncTicket").mockResolvedValue({
      path: "/api/v1/bots/b1/browser/vnc?ticket=t1",
      scale: 2,
    }),
    resize: vi.spyOn(botsApi, "browserResize").mockResolvedValue(undefined as never),
    reset: vi.spyOn(botsApi, "browserResetProfile").mockResolvedValue(undefined as never),
  };
}

function mockComputer(status: ComputerStatus | Promise<ComputerStatus>) {
  return {
    status: vi.spyOn(botsApi, "computerStatus").mockImplementation(() => Promise.resolve(status)),
    driver: vi.spyOn(botsApi, "computerDriver").mockResolvedValue(undefined as never),
    start: vi.spyOn(botsApi, "computerStart").mockResolvedValue({ starting: true }),
    ticket: vi.spyOn(botsApi, "computerVncTicket").mockResolvedValue({
      path: "/api/v1/bots/b1/computer/vnc?ticket=t1",
      scale: 1,
    }),
    reset: vi.spyOn(botsApi, "computerReset").mockResolvedValue(undefined as never),
  };
}

const tabs = (
  <div role="tablist" aria-label="Live view">
    <button type="button" role="tab" aria-selected>
      Browser
    </button>
  </div>
);

function mount(which: "browser" | "computer", withTabs = false) {
  const Panel = which === "browser" ? BrowserPanel : ComputerPanel;
  return render(
    <MemoryRouter>
      <GrootUIProvider>
        <Panel bot={bot} onClose={vi.fn()} tabs={withTabs ? tabs : undefined} />
      </GrootUIProvider>
    </MemoryRouter>,
  );
}

const asGuest = () => usePeopleStore.setState({ guest: true });

/** The viewer exists (its ticket fetched, noVNC created) but has not connected. */
const viewerCreated = () =>
  waitFor(() => expect(fakes.rfbs.length).toBeGreaterThan(0), { timeout: 4000 });

const connect = async () => {
  await viewerCreated();
  act(() => {
    fakes.rfbs[fakes.rfbs.length - 1]!.dispatchEvent(new Event("connect"));
  });
  // Once live, the status chip says who drives.
  await screen.findByTestId(/-driver$/);
};

const pin = () => {
  expect(outline()).toMatchSnapshot("outline");
  expect(markup()).toMatchSnapshot("markup");
};

beforeEach(() => {
  fakes.rfbs.length = 0;
  vi.mocked(createRfb).mockClear();
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.success).mockClear();
  window.localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  usePeopleStore.setState({ guest: null });
});

describe("BrowserPanel states", () => {
  it("before the first status", () => {
    mockBrowser(new Promise(() => undefined));
    mount("browser");
    pin();
  });

  it("closed, for the owner", async () => {
    mockBrowser(browserClosed());
    mount("browser");
    await screen.findByTestId("browser-open");
    pin();
  });

  it("closed, for a guest", async () => {
    asGuest();
    const api = mockBrowser(browserClosed());
    mount("browser");
    await waitFor(() => expect(api.status).toHaveBeenCalled());
    await screen.findByText("Closed");
    pin();
  });

  it("starting", async () => {
    mockBrowser(browserClosed({ starting: true, phase: "starting" }));
    mount("browser");
    await screen.findByText("Starting the browser");
    pin();
  });

  it("first-run setup", async () => {
    mockBrowser(browserClosed({ starting: true, phase: "installing" }));
    mount("browser");
    await screen.findByText("Setting up the browser on the VM");
    pin();
  });

  it("failed to open, for the owner", async () => {
    mockBrowser(browserClosed({ error: "Chrome crashed" }));
    mount("browser");
    await screen.findByTestId("browser-error");
    pin();
  });

  it("failed to open, for a guest", async () => {
    asGuest();
    mockBrowser(browserClosed({ error: "Chrome crashed" }));
    mount("browser");
    await screen.findByTestId("browser-error");
    pin();
  });

  it("headless", async () => {
    mockBrowser(browser({ mode: "headless" }));
    mount("browser");
    await screen.findByTestId("browser-headless");
    pin();
  });

  it("connecting", async () => {
    mockBrowser(browser());
    mount("browser");
    await viewerCreated();
    await screen.findByText("Connecting");
    pin();
  });

  it("live, the bot driving", async () => {
    mockBrowser(browser());
    mount("browser");
    await connect();
    pin();
  });

  it("live, the owner driving", async () => {
    mockBrowser(browser({ driver: "human" }));
    mount("browser");
    await connect();
    pin();
  });

  it("live, for a guest", async () => {
    asGuest();
    mockBrowser(browser());
    mount("browser");
    await connect();
    pin();
  });

  it("live, a bot with its own browser", async () => {
    mockBrowser(browser({ profile: "own" }));
    mount("browser");
    await connect();
    pin();
  });

  it("with the live view's tabs in place of the title", async () => {
    mockBrowser(browserClosed());
    mount("browser", true);
    await screen.findByTestId("browser-open");
    pin();
  });
});

describe("ComputerPanel states", () => {
  it("before the first status", () => {
    mockComputer(new Promise(() => undefined));
    mount("computer");
    pin();
  });

  it("not set up", async () => {
    mockComputer(
      computerOff({
        configured: false,
        setupHint: "Set SANDBOX_HOST to give bots a computer on the sandbox VM.",
      }),
    );
    mount("computer");
    await screen.findByTestId("computer-setup-hint");
    pin();
  });

  it("not set up, without a hint", async () => {
    mockComputer(computerOff({ configured: false }));
    mount("computer");
    await screen.findByTestId("computer-setup-hint");
    pin();
  });

  it("off, for the owner", async () => {
    mockComputer(computerOff());
    mount("computer");
    await screen.findByTestId("computer-open");
    pin();
  });

  it("off, for a guest", async () => {
    asGuest();
    mockComputer(computerOff());
    mount("computer");
    await screen.findByText("The computer is off.");
    pin();
  });

  it("starting", async () => {
    mockComputer(computerOff({ starting: true, phase: "starting" }));
    mount("computer");
    await screen.findByText("Starting the computer");
    pin();
  });

  it("first-run setup", async () => {
    mockComputer(computerOff({ starting: true, phase: "installing" }));
    mount("computer");
    await screen.findByText("Setting up the computer on the VM");
    pin();
  });

  it("failed to open, for the owner", async () => {
    mockComputer(computerOff({ error: "Xvfb died" }));
    mount("computer");
    await screen.findByTestId("computer-error");
    pin();
  });

  it("failed to open, for a guest", async () => {
    asGuest();
    mockComputer(computerOff({ error: "Xvfb died" }));
    mount("computer");
    await screen.findByTestId("computer-error");
    pin();
  });

  it("connecting", async () => {
    mockComputer(computer());
    mount("computer");
    await viewerCreated();
    await screen.findByText("Connecting");
    pin();
  });

  it("live, the bot driving", async () => {
    mockComputer(computer());
    mount("computer");
    await connect();
    pin();
  });

  it("live, the owner driving", async () => {
    mockComputer(computer({ driver: "human" }));
    mount("computer");
    await connect();
    pin();
  });

  it("live, the owner driving at the bot's request", async () => {
    mockComputer(computer({ driver: "human", takeover: "Sign in to the mail app" }));
    mount("computer");
    await connect();
    pin();
  });

  it("live, for a guest", async () => {
    asGuest();
    mockComputer(computer({ takeover: "Sign in to the mail app", driver: "human" }));
    mount("computer");
    await connect();
    pin();
  });

  it("live, a bot with its own desktop", async () => {
    mockComputer(computer({ profile: "own", width: null, height: null }));
    mount("computer");
    await connect();
    pin();
  });

  it("with the live view's tabs in place of the title", async () => {
    mockComputer(computerOff());
    mount("computer", true);
    await screen.findByTestId("computer-open");
    pin();
  });
});

describe("the panels' actions", () => {
  const user = () => userEvent.setup({ pointerEventsCheck: 0 });

  for (const profile of ["shared", "own"] as const) {
    it(`resets the browser (${profile})`, async () => {
      const api = mockBrowser(browser({ profile }));
      mount("browser");
      await connect();
      await user().click(screen.getByTestId("browser-reset"));
      const dialog = await screen.findByRole("alertdialog");
      expect(outline(dialog)).toMatchSnapshot();
      await user().click(screen.getByRole("button", { name: "Reset" }));
      await waitFor(() => expect(api.reset).toHaveBeenCalledWith("b1"));
      expect(vi.mocked(toast.success).mock.calls).toMatchSnapshot();
      await screen.findByText("No browser is open.");
    });

    it(`resets the computer (${profile})`, async () => {
      const api = mockComputer(computer({ profile }));
      mount("computer");
      await connect();
      await user().click(screen.getByTestId("computer-reset"));
      const dialog = await screen.findByRole("alertdialog");
      expect(outline(dialog)).toMatchSnapshot();
      await user().click(screen.getByRole("button", { name: "Reset" }));
      await waitFor(() => expect(api.reset).toHaveBeenCalledWith("b1"));
      expect(vi.mocked(toast.success).mock.calls).toMatchSnapshot();
      await screen.findByText("The computer is off.");
    });
  }

  it("says when the browser could not be opened", async () => {
    const api = mockBrowser(browserClosed());
    api.start.mockRejectedValue({});
    mount("browser");
    await user().click(await screen.findByTestId("browser-open"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Failed to open the browser"));
  });

  it("says when the computer could not be opened", async () => {
    const api = mockComputer(computerOff());
    api.start.mockRejectedValue({});
    mount("computer");
    await user().click(await screen.findByTestId("computer-open"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Failed to open the computer"));
  });

  it("hands the computer back with I'm done, answering the request at once", async () => {
    const api = mockComputer(computer({ driver: "human", takeover: "Sign in" }));
    mount("computer");
    await connect();
    await user().click(screen.getByRole("button", { name: "I'm done" }));
    await waitFor(() => expect(api.driver).toHaveBeenCalledWith("b1", "agent"));
    expect(screen.getByRole("button", { name: "I'm done" })).toHaveAttribute(
      "title",
      "Hand the computer back to Surfer",
    );
  });
});

describe("the panels' poll", () => {
  /** The delays of the status polls set so far (the panels poll at 1.5s or 3s). */
  function polls() {
    const spy = vi.spyOn(window, "setInterval");
    return () => spy.mock.calls.map(([, ms]) => ms).filter((ms) => ms === 1500 || ms === 3000);
  }

  it("polls the browser every 3s, and every 1.5s while it starts", async () => {
    const delays = polls();
    const api = mockBrowser(browserClosed({ starting: true, phase: "starting" }));
    mount("browser");
    await screen.findByText("Starting the browser");
    await waitFor(() => expect(delays().at(-1)).toBe(1500));
    expect(delays()[0]).toBe(3000);
    expect(api.status).toHaveBeenCalledWith("b1");
  });

  it("polls the computer every 3s, and every 1.5s while it starts", async () => {
    const delays = polls();
    const api = mockComputer(computerOff({ starting: true, phase: "starting" }));
    mount("computer");
    await screen.findByText("Starting the computer");
    await waitFor(() => expect(delays().at(-1)).toBe(1500));
    expect(delays()[0]).toBe(3000);
    expect(api.status).toHaveBeenCalledWith("b1");
  });
});
