/**
 * @vitest-environment jsdom
 *
 * Browser page (issue #160): Shared by default, a tab per browser, the live
 * view you take control of (fit through the page's own resize route),
 * deep links and the fallback for an unknown profile, opening a browser
 * that is closed, and the no-live-view state. noVNC is faked; its canvas
 * needs a real browser.
 */
import React from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { MemoryRouter } from "react-router-dom";
import { GrootUIProvider } from "@groot/ui";
import { BrowserPage } from "@/pages/browser";
import type {
  DriverBody,
  LiveStarting,
  PageBrowser,
  PageBrowserList,
  VncTicket,
} from "../../../apps/web/src/shared/api/live";
import { createRfb } from "@/lib/novnc";
import { fakeApi } from "../fakes/api";

interface FakeRfb extends EventTarget {
  viewOnly: boolean;
}

const fakes = vi.hoisted(() => ({ rfbs: [] as FakeRfb[] }));

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
    fakes.rfbs.push(rfb as unknown as FakeRfb);
    return rfb;
  }),
}));

const shared = (b: Partial<PageBrowser> = {}): PageBrowser => ({
  profile: "shared",
  label: "Shared",
  bots: [
    { id: "b1", name: "Alpha" },
    { id: "b2", name: "Beta" },
  ],
  active: true,
  driver: "agent",
  mode: "vnc",
  starting: false,
  phase: null,
  error: null,
  ...b,
});

const scout = (b: Partial<PageBrowser> = {}): PageBrowser =>
  shared({
    profile: "bot-b3",
    label: "Scout",
    bots: [{ id: "b3", name: "Scout" }],
    active: false,
    driver: null,
    mode: null,
    ...b,
  });

const listOf = (browsers: PageBrowser[], liveView = true): PageBrowserList => ({
  liveView,
  setupHint: liveView ? null : "Set SANDBOX_HOST for a live browser on the sandbox VM.",
  browsers,
});

function backend(initial: PageBrowserList) {
  let current = initial;
  const update = (profile: string, next: Partial<PageBrowser>) => {
    current = {
      ...current,
      browsers: current.browsers.map((b) => (b.profile === profile ? { ...b, ...next } : b)),
    };
  };
  const api = fakeApi();
  api.get("/browser", () => current);
  api.post("/browser/:profile/driver", ({ params, body }) => {
    const { driver } = body as DriverBody;
    update(params.profile!, { driver });
    return { driver };
  });
  api.post("/browser/:profile/start", ({ params }): LiveStarting => {
    update(params.profile!, { starting: true, phase: "starting" });
    return { starting: true };
  });
  api.post("/browser/:profile/vnc-ticket", ({ params }): VncTicket => ({
    path: `/api/v1/browser/${params.profile}/vnc?ticket=t1`,
    scale: 2,
  }));
  api.post("/browser/:profile/resize", ({ body }) => body);
  return {
    tickets: (profile: string) => api.sent("POST", `/browser/${profile}/vnc-ticket`),
    starts: (profile: string) => api.sent("POST", `/browser/${profile}/start`),
    drivers: (profile: string) =>
      api
        .sent<DriverBody>("POST", `/browser/${profile}/driver`)
        .map((request) => request.body.driver),
  };
}

function mount(path = "/browser") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <GrootUIProvider>
        <BrowserPage />
      </GrootUIProvider>
    </MemoryRouter>,
  );
}

const connected = async () => {
  await waitFor(() => expect(fakes.rfbs.length).toBeGreaterThan(0), { timeout: 4000 });
  act(() => {
    fakes.rfbs[fakes.rfbs.length - 1]!.dispatchEvent(new Event("connect"));
  });
};

describe("BrowserPage", () => {
  beforeEach(() => {
    fakes.rfbs.length = 0;
    vi.mocked(createRfb).mockClear();
    window.localStorage.clear();
  });
  it("opens on the shared browser, view-only, with a tab per browser", async () => {
    const api = backend(listOf([shared(), scout()]));
    mount();
    expect(await screen.findByTestId("browser-tab-shared")).toHaveTextContent("Shared2 bots");
    expect(screen.getByTestId("browser-tab-bot-b3")).toHaveTextContent("Scoutown browser");
    expect(screen.getByTestId("browser-tab-shared")).toHaveAttribute("aria-selected", "true");
    await connected();
    expect(api.tickets("shared")).not.toHaveLength(0);
    expect(createRfb).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.stringMatching(/\/api\/v1\/browser\/shared\/vnc\?ticket=t1$/),
      2,
    );
    expect(fakes.rfbs[0]!.viewOnly).toBe(true);
    const viewport = screen.getByTestId("browser-page-viewport");
    expect(
      await within(viewport).findByRole("button", { name: "Take control" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("browser-page-status")).toHaveTextContent("Bots are driving");
  });

  it("takes control from a click on the stream and hands back from the view's own bar", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const api = backend(listOf([shared()]));
    mount();
    await connected();
    const viewport = screen.getByTestId("browser-page-viewport");
    await user.click(await within(viewport).findByRole("button", { name: "Take control" }));
    await waitFor(() => expect(api.drivers("shared")).toEqual(["human"]));
    await waitFor(() => expect(fakes.rfbs[0]!.viewOnly).toBe(false));
    expect(screen.getByTestId("browser-page-status")).toHaveTextContent("You're driving");
    expect(within(viewport).getByTestId("browser-page-driving-frame")).toBeInTheDocument();
    expect(within(viewport).queryByRole("button", { name: "Take control" })).toBeNull();
    const region = screen.getByTestId("browser-region");
    expect(within(region).getByTestId("browser-page-fullscreen")).toBeInTheDocument();
    await user.click(within(region).getByRole("button", { name: "Hand back" }));
    await waitFor(() => expect(api.drivers("shared")).toEqual(["human", "agent"]));
  });

  it("opens the browser a deep link names, and remembers it", async () => {
    const api = backend(listOf([shared(), scout({ active: true, driver: "agent", mode: "vnc" })]));
    mount("/browser?profile=bot-b3");
    await connected();
    expect(api.tickets("bot-b3")).not.toHaveLength(0);
    expect(screen.getByTestId("browser-tab-bot-b3")).toHaveAttribute("aria-selected", "true");
    expect(window.localStorage.getItem("tiny-agents:browser-page-profile")).toBe("bot-b3");
  });

  it("falls back to Shared for a browser that no longer exists", async () => {
    window.localStorage.setItem("tiny-agents:browser-page-profile", "bot-gone");
    backend(listOf([shared()]));
    mount();
    expect(await screen.findByTestId("browser-tab-shared")).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("opens a browser that is closed", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const api = backend(listOf([shared({ active: false, driver: null, mode: null })]));
    mount();
    await user.click(await screen.findByTestId("browser-page-open"));
    await waitFor(() => expect(api.starts("shared")).toHaveLength(1));
    expect(await screen.findByText("Starting the browser")).toBeInTheDocument();
  });

  it("says a headless browser has nothing to show", async () => {
    backend(listOf([shared({ mode: "headless" })]));
    mount();
    expect(await screen.findByText("This browser is headless")).toBeInTheDocument();
    expect(createRfb).not.toHaveBeenCalled();
  });

  it("says why there is no live view without a sandbox VM", async () => {
    backend(listOf([shared({ active: false, driver: null, mode: null })], false));
    mount();
    expect(await screen.findByTestId("browser-page-setup")).toHaveTextContent("SANDBOX_HOST");
    expect(screen.queryByTestId("browser-region")).not.toBeInTheDocument();
  });
});
