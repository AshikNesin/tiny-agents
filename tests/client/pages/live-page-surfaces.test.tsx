/**
 * @vitest-environment jsdom
 *
 * The Browser and Computer pages pinned state by state: the element tree
 * with roles, names, test ids and text, and the whole markup, in every state
 * a mocked list reaches (loading, failed to load, no live view on this
 * server, a tab per browser or desktop with its dot, closed, starting,
 * first-run setup, failed, headless, connecting, live, driving, a bot's
 * takeover request, the Apps and Keys menus), plus each reset's confirm and
 * toast, each failed open's toast, the deep link (Browser only), and the
 * poll's cadence. Recorded on the two separate pages before they became one
 * (docs/rewrite/PLAN.md row 5.5), so the shared page must render each state
 * the same. noVNC is faked.
 */
import React from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { MemoryRouter } from "react-router-dom";
import { toast } from "sonner";
import { GrootUIProvider } from "@groot/ui";
import { BrowserPage } from "@/pages/browser";
import { ComputerPage } from "@/pages/computer";
import type {
  Desktop,
  DesktopApps,
  DesktopList,
  DriverBody,
  LiveStarting,
  OpenAppBody,
  PageBrowser,
  PageBrowserList,
  VncTicket,
} from "../../../apps/web/src/shared/api/live";
import { createRfb } from "@/lib/novnc";
import { ApiFailure, fakeApi } from "../fakes/api";
import { AppQueryProvider } from "../query-provider";
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

const ALPHA = { id: "b1", name: "Alpha" };
const BETA = { id: "b2", name: "Beta" };

function item<T extends PageBrowser | Desktop>(base: T, over: Partial<T>): T {
  return { ...base, ...over };
}

const browserItem = (b: Partial<PageBrowser> = {}): PageBrowser =>
  item<PageBrowser>(
    {
      profile: "shared",
      label: "Shared",
      bots: [ALPHA, BETA],
      active: true,
      driver: "agent",
      mode: "vnc",
      starting: false,
      phase: null,
      error: null,
    },
    b,
  );
const scoutBrowser = (b: Partial<PageBrowser> = {}) =>
  browserItem({
    profile: "bot-b3",
    label: "Scout",
    bots: [{ id: "b3", name: "Scout" }],
    active: false,
    driver: null,
    mode: null,
    ...b,
  });
const browsers = (list: PageBrowser[], liveView = true, setupHint?: string): PageBrowserList => ({
  liveView,
  setupHint: setupHint ?? null,
  browsers: list,
});

const desktopItem = (d: Partial<Desktop> = {}): Desktop =>
  item<Desktop>(
    {
      profile: "shared",
      label: "Shared",
      bots: [ALPHA, BETA],
      active: true,
      driver: "agent",
      takeover: null,
      starting: false,
      phase: null,
      error: null,
    },
    d,
  );
const scoutDesktop = (d: Partial<Desktop> = {}) =>
  desktopItem({
    profile: "bot-b3",
    label: "Scout",
    bots: [{ id: "b3", name: "Scout" }],
    active: false,
    driver: null,
    ...d,
  });
const desktops = (list: Desktop[], configured = true, setupHint?: string): DesktopList => ({
  configured,
  setupHint: setupHint ?? null,
  width: configured ? 1280 : null,
  height: configured ? 800 : null,
  desktops: list,
});

const unexplained = () => {
  throw new ApiFailure(500, "");
};

function serve<List>(surface: "browser" | "computer", list: List | Promise<List>, scale: number) {
  const api = fakeApi();
  api.get(`/${surface}`, () => list);
  api.post(`/${surface}/:profile/driver`, ({ body }) => ({ driver: (body as DriverBody).driver }));
  api.post(`/${surface}/:profile/start`, (): LiveStarting => ({ starting: true }));
  api.post(`/${surface}/:profile/vnc-ticket`, ({ params }): VncTicket => ({
    path: `/api/v1/${surface}/${params.profile}/vnc?ticket=t1`,
    scale,
  }));
  api.delete(`/${surface}/:profile`, () => ({ reset: true }));
  return {
    api,
    tickets: () =>
      api.requests
        .filter((request) => request.path.endsWith("/vnc-ticket"))
        .map((request) => request.params.profile),
    resets: (profile: string) => api.sent("DELETE", `/${surface}/${profile}`),
  };
}

function browserBackend(list: PageBrowserList | Promise<PageBrowserList>) {
  const served = serve("browser", list, 2);
  served.api.post("/browser/:profile/resize", ({ body }) => body);
  return served;
}

function desktopBackend(list: DesktopList | Promise<DesktopList>) {
  const served = serve("computer", list, 1);
  served.api.get("/computer/:profile/apps", (): DesktopApps => ({
    apps: [
      { id: "org.xfce.mousepad", name: "Mousepad" },
      { id: "firefox", name: "Firefox" },
    ],
  }));
  served.api.post("/computer/:profile/apps", ({ body }) => ({
    opened: (body as OpenAppBody).id,
  }));
  return served;
}

function mount(which: "browser" | "computer", path = `/${which}`) {
  const Page = which === "browser" ? BrowserPage : ComputerPage;
  return render(
    <AppQueryProvider>
      <MemoryRouter initialEntries={[path]}>
        <GrootUIProvider>
          <Page />
        </GrootUIProvider>
      </MemoryRouter>
    </AppQueryProvider>,
  );
}

const viewerCreated = () =>
  waitFor(() => expect(fakes.rfbs.length).toBeGreaterThan(0), { timeout: 4000 });

const connect = async () => {
  await viewerCreated();
  act(() => {
    fakes.rfbs[fakes.rfbs.length - 1]!.dispatchEvent(new Event("connect"));
  });
  await waitFor(() =>
    expect(screen.queryByText(/Connecting to the|Reconnecting…/)).not.toBeInTheDocument(),
  );
};

const pin = () => {
  expect(outline()).toMatchSnapshot("outline");
  expect(markup()).toMatchSnapshot("markup");
};

const user = () => userEvent.setup({ pointerEventsCheck: 0 });

beforeEach(() => {
  fakes.rfbs.length = 0;
  vi.mocked(createRfb).mockClear();
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.success).mockClear();
  window.localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe("Browser page states", () => {
  it("loading", () => {
    browserBackend(new Promise(() => undefined));
    mount("browser");
    pin();
  });

  it("failed to load", async () => {
    fakeApi().get("/browser", unexplained);
    mount("browser");
    await screen.findByText("Couldn't load the browsers");
    pin();
  });

  it("no live browser on this server, with a hint", async () => {
    browserBackend(
      browsers([browserItem({ active: false, mode: null })], false, "Set SANDBOX_HOST."),
    );
    mount("browser");
    await screen.findByTestId("browser-page-setup");
    pin();
  });

  it("no live browser on this server, without a hint", async () => {
    browserBackend(browsers([browserItem({ active: false, mode: null })], false));
    mount("browser");
    await screen.findByTestId("browser-page-setup");
    pin();
  });

  it("closed, nobody on it yet, beside a starting and a failed tab", async () => {
    browserBackend(
      browsers([
        browserItem({ active: false, driver: null, mode: null, bots: [] }),
        scoutBrowser({ starting: true, phase: "starting" }),
        scoutBrowser({ profile: "bot-b4", label: "Ranger", error: "boom", bots: [] }),
      ]),
    );
    mount("browser");
    await screen.findByTestId("browser-page-open");
    pin();
  });

  it("starting", async () => {
    browserBackend(browsers([browserItem({ active: false, mode: null, starting: true })]));
    mount("browser");
    await screen.findByText("Starting the browser");
    pin();
  });

  it("first-run setup", async () => {
    browserBackend(
      browsers([browserItem({ active: false, mode: null, starting: true, phase: "installing" })]),
    );
    mount("browser");
    await screen.findByText("Installing Chrome on the VM");
    pin();
  });

  it("failed to start", async () => {
    browserBackend(browsers([browserItem({ active: false, mode: null, error: "Chrome crashed" })]));
    mount("browser");
    await screen.findByTestId("browser-page-error");
    pin();
  });

  it("headless", async () => {
    browserBackend(browsers([browserItem({ mode: "headless" })]));
    mount("browser");
    await screen.findByText("This browser is headless");
    pin();
  });

  it("connecting", async () => {
    browserBackend(browsers([browserItem(), scoutBrowser()]));
    mount("browser");
    await viewerCreated();
    pin();
  });

  it("live, bots driving", async () => {
    browserBackend(browsers([browserItem(), scoutBrowser()]));
    mount("browser");
    await connect();
    await screen.findByTestId("browser-page-take");
    pin();
  });

  it("live, one bot on it driving", async () => {
    browserBackend(browsers([browserItem({ bots: [ALPHA] })]));
    mount("browser");
    await connect();
    await screen.findByTestId("browser-page-take");
    pin();
  });

  it("live, the owner driving", async () => {
    browserBackend(browsers([browserItem({ driver: "human" }), scoutBrowser()]));
    mount("browser");
    await connect();
    pin();
  });

  it("a bot's own browser, by deep link", async () => {
    browserBackend(
      browsers([browserItem(), scoutBrowser({ active: true, driver: "agent", mode: "vnc" })]),
    );
    mount("browser", "/browser?profile=bot-b3");
    await connect();
    await screen.findByTestId("browser-page-take");
    pin();
  });
});

describe("Computer page states", () => {
  it("loading", () => {
    desktopBackend(new Promise(() => undefined));
    mount("computer");
    pin();
  });

  it("failed to load", async () => {
    fakeApi().get("/computer", unexplained);
    mount("computer");
    await screen.findByText("Couldn't load the computer");
    pin();
  });

  it("no computer on this server, with a hint", async () => {
    desktopBackend(desktops([desktopItem({ active: false })], false, "Set SANDBOX_HOST."));
    mount("computer");
    await screen.findByTestId("computer-page-setup");
    pin();
  });

  it("no computer on this server, without a hint", async () => {
    desktopBackend(desktops([desktopItem({ active: false })], false));
    mount("computer");
    await screen.findByTestId("computer-page-setup");
    pin();
  });

  it("off, nobody on it yet, beside a starting and a failed tab", async () => {
    desktopBackend(
      desktops([
        desktopItem({ active: false, driver: null, bots: [] }),
        scoutDesktop({ starting: true, phase: "starting" }),
        scoutDesktop({ profile: "bot-b4", label: "Ranger", error: "boom", bots: [] }),
      ]),
    );
    mount("computer");
    await screen.findByTestId("computer-page-open");
    pin();
  });

  it("starting", async () => {
    desktopBackend(desktops([desktopItem({ active: false, starting: true })]));
    mount("computer");
    await screen.findByText("Starting the desktop");
    pin();
  });

  it("first-run setup", async () => {
    desktopBackend(desktops([desktopItem({ active: false, starting: true, phase: "installing" })]));
    mount("computer");
    await screen.findByText("Setting up the computer on the VM");
    pin();
  });

  it("failed to start", async () => {
    desktopBackend(desktops([desktopItem({ active: false, error: "Xvfb died" })]));
    mount("computer");
    await screen.findByTestId("computer-page-error");
    pin();
  });

  it("connecting", async () => {
    desktopBackend(desktops([desktopItem(), scoutDesktop()]));
    mount("computer");
    await viewerCreated();
    pin();
  });

  it("live, bots driving", async () => {
    desktopBackend(desktops([desktopItem(), scoutDesktop()]));
    mount("computer");
    await connect();
    await screen.findByTestId("computer-page-take");
    pin();
  });

  it("live, the owner driving at a bot's request", async () => {
    desktopBackend(
      desktops([
        desktopItem({ driver: "human", takeover: "Sign in to Mail" }),
        scoutDesktop({ takeover: "Approve the prompt" }),
      ]),
    );
    mount("computer");
    await connect();
    pin();
  });

  it("ignores a ?profile= link", async () => {
    const served = desktopBackend(desktops([desktopItem(), scoutDesktop({ active: true })]));
    mount("computer", "/computer?profile=bot-b3");
    await connect();
    expect(served.tickets()).toEqual(["shared"]);
    expect(screen.getByTestId("computer-tab-shared")).toHaveAttribute("aria-selected", "true");
    expect(window.localStorage.getItem("tiny-agents:computer-desktop")).toBeNull();
  });

  it("the Apps menu, loading, listed and empty", async () => {
    let answer: (apps: DesktopApps) => void = () => undefined;
    const { api } = desktopBackend(desktops([desktopItem({ driver: "human" })]));
    api.get.once(
      "/computer/:profile/apps",
      () => new Promise<DesktopApps>((resolve) => (answer = resolve)),
    );
    mount("computer");
    await connect();
    await user().click(screen.getByTestId("computer-apps"));
    const menu = await screen.findByRole("menu");
    expect(outline(menu)).toMatchSnapshot("loading");
    await act(async () => answer({ apps: [{ id: "org.xfce.mousepad", name: "Mousepad" }] }));
    expect(outline(await screen.findByRole("menu"))).toMatchSnapshot("listed");
    expect(api.sent("GET", "/computer/shared/apps")).toHaveLength(1);
    await user().click(screen.getByRole("menuitem", { name: "Mousepad" }));
    await waitFor(() =>
      expect(api.sent("POST", "/computer/shared/apps").map((request) => request.body)).toEqual([
        { id: "org.xfce.mousepad" },
      ]),
    );
    expect(vi.mocked(toast.success).mock.calls).toMatchSnapshot("opened");

    api.get.once("/computer/:profile/apps", (): DesktopApps => ({ apps: [] }));
    await user().click(screen.getByTestId("computer-apps"));
    await screen.findByText("No apps found.");
    expect(outline(await screen.findByRole("menu"))).toMatchSnapshot("empty");
  });

  it("the Apps menu, when listing or opening fails", async () => {
    const { api } = desktopBackend(desktops([desktopItem({ driver: "human" })]));
    api.post("/computer/:profile/apps", unexplained);
    mount("computer");
    await connect();
    await user().click(screen.getByTestId("computer-apps"));
    await user().click(await screen.findByRole("menuitem", { name: "Firefox" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not open Firefox"));
    api.get.once("/computer/:profile/apps", unexplained);
    await user().click(screen.getByTestId("computer-apps"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not list the apps"));
    expect(await screen.findByText("No apps found.")).toBeInTheDocument();
  });

  it("the Keys menu", async () => {
    desktopBackend(desktops([desktopItem({ driver: "human" })]));
    mount("computer");
    await connect();
    await user().click(screen.getByTestId("computer-keys"));
    expect(outline(await screen.findByRole("menu"))).toMatchSnapshot();
  });
});

describe("the pages' actions", () => {
  const resets = [
    ["browser", "shared, two bots", browserItem()],
    ["browser", "shared, no bots", browserItem({ bots: [] })],
    ["browser", "a bot's own", scoutBrowser({ active: true, mode: "vnc", driver: "agent" })],
    ["computer", "shared, two bots", desktopItem()],
    ["computer", "shared, one bot", desktopItem({ bots: [ALPHA] })],
    ["computer", "a bot's own", scoutDesktop({ active: true, driver: "agent" })],
  ] as const;

  for (const [kind, what, entry] of resets) {
    it(`resets the ${kind} (${what})`, async () => {
      const served =
        kind === "browser"
          ? browserBackend(browsers([entry as PageBrowser]))
          : desktopBackend(desktops([entry as Desktop]));
      mount(kind);
      await connect();
      await user().click(screen.getByTestId(`${kind}-page-reset`));
      const dialog = await screen.findByRole("alertdialog");
      expect(outline(dialog)).toMatchSnapshot();
      await user().click(within(dialog).getByRole("button", { name: "Reset" }));
      await waitFor(() => expect(served.resets(entry.profile)).toHaveLength(1));
      expect(vi.mocked(toast.success).mock.calls).toMatchSnapshot();
      await screen.findByTestId(`${kind}-page-open`);
    });
  }

  it("says when a browser could not be opened", async () => {
    const { api } = browserBackend(browsers([browserItem({ active: false, mode: null })]));
    api.post("/browser/:profile/start", unexplained);
    mount("browser");
    await user().click(await screen.findByTestId("browser-page-open"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Failed to open the browser"));
  });

  it("says when a desktop could not be started", async () => {
    const { api } = desktopBackend(desktops([desktopItem({ active: false })]));
    api.post("/computer/:profile/start", unexplained);
    mount("computer");
    await user().click(await screen.findByTestId("computer-page-open"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Failed to start the desktop"));
  });

  it("switches browsers, forgetting the deep link", async () => {
    const served = browserBackend(
      browsers([browserItem(), scoutBrowser({ active: true, driver: "agent", mode: "vnc" })]),
    );
    mount("browser", "/browser?profile=bot-b3");
    await connect();
    await user().click(screen.getByTestId("browser-tab-shared"));
    await waitFor(() => expect(served.tickets().at(-1)).toBe("shared"));
    expect(window.localStorage.getItem("tiny-agents:browser-page-profile")).toBe("shared");
  });

  it("switches desktops and remembers the choice", async () => {
    const served = desktopBackend(desktops([desktopItem(), scoutDesktop({ active: true })]));
    mount("computer");
    await connect();
    await user().click(screen.getByTestId("computer-tab-bot-b3"));
    await waitFor(() => expect(served.tickets().at(-1)).toBe("bot-b3"));
    expect(window.localStorage.getItem("tiny-agents:computer-desktop")).toBe("bot-b3");
  });
});

describe("the pages' poll", () => {
  const pass = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
  });

  it("polls the browsers every 1.5s while any of them starts, not just the one shown", async () => {
    const { api } = browserBackend(browsers([browserItem(), scoutBrowser({ starting: true })]));
    mount("browser");
    await pass(0);
    expect(api.sent("GET", "/browser")).toHaveLength(1);
    await pass(1500);
    expect(api.sent("GET", "/browser")).toHaveLength(2);
  });

  it("polls the desktops every 1.5s while any of them starts, not just the one shown", async () => {
    const { api } = desktopBackend(desktops([desktopItem(), scoutDesktop({ starting: true })]));
    mount("computer");
    await pass(0);
    expect(api.sent("GET", "/computer")).toHaveLength(1);
    await pass(1500);
    expect(api.sent("GET", "/computer")).toHaveLength(2);
  });

  it("polls every 3s when nothing starts", async () => {
    const { api } = desktopBackend(desktops([desktopItem()]));
    mount("computer");
    await pass(0);
    expect(api.sent("GET", "/computer")).toHaveLength(1);
    await pass(1500);
    expect(api.sent("GET", "/computer")).toHaveLength(1);
    await pass(1500);
    expect(api.sent("GET", "/computer")).toHaveLength(2);
  });
});
