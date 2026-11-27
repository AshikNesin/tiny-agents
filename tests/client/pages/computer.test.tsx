/**
 * @vitest-environment jsdom
 *
 * Computer page: a tab per desktop, the live view you take control of, the
 * Apps and Keys menus while you drive, starting a desktop that is off, and
 * the not-set-up state. noVNC is faked; its canvas needs a real browser.
 */
import React from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { MemoryRouter } from "react-router-dom";
import { GrootUIProvider } from "@groot/ui";
import { ComputerPage } from "@/pages/computer";
import type {
  Desktop,
  DesktopApps,
  DesktopList,
  DriverBody,
  LiveStarting,
  OpenAppBody,
  VncTicket,
} from "../../../apps/web/src/shared/api/live";
import { createRfb } from "@/lib/novnc";
import { fakeApi } from "../fakes/api";

interface FakeRfb extends EventTarget {
  viewOnly: boolean;
  sendKey: ReturnType<typeof vi.fn>;
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

const desktop = (d: Partial<Desktop> = {}): Desktop => ({
  profile: "shared",
  label: "Shared",
  bots: [
    { id: "b1", name: "Alpha" },
    { id: "b2", name: "Beta" },
  ],
  active: true,
  driver: "agent",
  takeover: null,
  starting: false,
  phase: null,
  error: null,
  ...d,
});

const listOf = (desktops: Desktop[], configured = true): DesktopList => ({
  configured,
  setupHint: configured ? null : "Set SANDBOX_HOST to give bots a computer on the sandbox VM.",
  width: 1280,
  height: 800,
  desktops,
});

function backend(initial: DesktopList) {
  let current = initial;
  const api = fakeApi();
  api.get("/computer", () => current);
  api.post("/computer/:profile/driver", ({ params, body }) => {
    const { driver } = body as DriverBody;
    current = {
      ...current,
      desktops: current.desktops.map((d) => (d.profile === params.profile ? { ...d, driver } : d)),
    };
    return { driver };
  });
  api.post("/computer/:profile/start", ({ params }): LiveStarting => {
    current = {
      ...current,
      desktops: current.desktops.map((d) =>
        d.profile === params.profile ? { ...d, starting: true, phase: "starting" } : d,
      ),
    };
    return { starting: true };
  });
  api.post("/computer/:profile/vnc-ticket", ({ params }): VncTicket => ({
    path: `/api/v1/computer/${params.profile}/vnc?ticket=t1`,
    scale: 1,
  }));
  api.get("/computer/:profile/apps", (): DesktopApps => ({
    apps: [{ id: "org.xfce.mousepad", name: "Mousepad" }],
  }));
  api.post("/computer/:profile/apps", ({ body }) => ({ opened: (body as OpenAppBody).id }));
  return {
    tickets: (profile: string) => api.sent("POST", `/computer/${profile}/vnc-ticket`),
    starts: (profile: string) => api.sent("POST", `/computer/${profile}/start`),
    drivers: (profile: string) =>
      api
        .sent<DriverBody>("POST", `/computer/${profile}/driver`)
        .map((request) => request.body.driver),
    opened: (profile: string) =>
      api.sent<OpenAppBody>("POST", `/computer/${profile}/apps`).map((request) => request.body),
  };
}

function mount() {
  return render(
    <MemoryRouter>
      <GrootUIProvider>
        <ComputerPage />
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

describe("ComputerPage", () => {
  beforeEach(() => {
    fakes.rfbs.length = 0;
    vi.mocked(createRfb).mockClear();
    window.localStorage.clear();
  });
  it("shows a tab per desktop and streams the selected one, view-only", async () => {
    const api = backend(
      listOf([
        desktop(),
        desktop({
          profile: "bot-b3",
          label: "Scout",
          active: false,
          driver: null,
          bots: [{ id: "b3", name: "Scout" }],
        }),
      ]),
    );
    mount();
    expect(await screen.findByTestId("computer-tab-shared")).toHaveTextContent("Shared2 bots");
    expect(screen.getByTestId("computer-tab-bot-b3")).toHaveTextContent("Scoutown desktop");
    await connected();
    expect(api.tickets("shared")).not.toHaveLength(0);
    expect(createRfb).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.stringMatching(/\/api\/v1\/computer\/shared\/vnc\?ticket=t1$/),
      1,
      { remoteResize: false },
    );
    expect(fakes.rfbs[0]!.viewOnly).toBe(true);
    expect(screen.queryByTestId("computer-apps")).not.toBeInTheDocument();
    expect(screen.queryByTestId("computer-keys")).not.toBeInTheDocument();
    expect(
      await within(screen.getByTestId("computer-page-viewport")).findByRole("button", {
        name: "Take control",
      }),
    ).toBeInTheDocument();
  });

  it("takes control, then opens apps and sends shortcuts the browser would keep", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const api = backend(listOf([desktop()]));
    mount();
    await connected();
    const viewport = screen.getByTestId("computer-page-viewport");
    await user.click(await within(viewport).findByRole("button", { name: "Take control" }));
    await waitFor(() => expect(api.drivers("shared")).toEqual(["human"]));
    await waitFor(() => expect(fakes.rfbs[0]!.viewOnly).toBe(false));
    expect(within(viewport).queryByRole("button", { name: "Take control" })).toBeNull();
    expect(screen.getByTestId("computer-page-status")).toHaveTextContent("You're driving");

    await user.click(screen.getByTestId("computer-apps"));
    await user.click(await screen.findByRole("menuitem", { name: "Mousepad" }));
    await waitFor(() => expect(api.opened("shared")).toEqual([{ id: "org.xfce.mousepad" }]));

    await user.click(screen.getByTestId("computer-keys"));
    const menu = await screen.findByRole("menu");
    await user.click(within(menu).getByRole("menuitem", { name: /Switch windows/ }));
    expect(fakes.rfbs[0]!.sendKey.mock.calls).toEqual([
      [0xffe9, "AltLeft", true],
      [0xff09, "Tab", true],
      [0xff09, "Tab", false],
      [0xffe9, "AltLeft", false],
    ]);

    await user.click(screen.getByRole("button", { name: "Hand back" }));
    await waitFor(() => expect(api.drivers("shared")).toEqual(["human", "agent"]));
  });

  it("shows what a bot asked for while the owner drives", async () => {
    backend(listOf([desktop({ driver: "human", takeover: "Sign in to Mail" })]));
    mount();
    expect(await screen.findByTestId("computer-page-takeover")).toHaveTextContent(
      "Sign in to Mail",
    );
  });

  it("starts a desktop that is off", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const api = backend(listOf([desktop({ active: false, driver: null })]));
    mount();
    await user.click(await screen.findByTestId("computer-page-open"));
    await waitFor(() => expect(api.starts("shared")).toHaveLength(1));
    expect(await screen.findByText("Starting the desktop")).toBeInTheDocument();
  });

  it("says why there is no computer without a sandbox VM", async () => {
    backend(listOf([desktop({ active: false, driver: null })], false));
    mount();
    expect(await screen.findByTestId("computer-page-setup")).toHaveTextContent("SANDBOX_HOST");
    expect(screen.queryByTestId("computer-region")).not.toBeInTheDocument();
  });
});
