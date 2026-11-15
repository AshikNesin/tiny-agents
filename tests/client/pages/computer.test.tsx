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
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { MemoryRouter } from "react-router-dom";
import { GrootUIProvider } from "@groot/ui";
import { ComputerPage } from "@/pages/computer";
import type { Desktop, DesktopList } from "../../../apps/web/src/shared/api/live";
import { computerApi } from "@/lib/computer-api";
import { createRfb } from "@/lib/novnc";

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

function mockApi(initial: DesktopList) {
  let current = initial;
  return {
    list: vi.spyOn(computerApi, "list").mockImplementation(async () => current),
    driver: vi.spyOn(computerApi, "driver").mockImplementation(async (profile, driver) => {
      current = {
        ...current,
        desktops: current.desktops.map((d) => (d.profile === profile ? { ...d, driver } : d)),
      };
    }),
    // The server marks the desktop as starting before it answers.
    start: vi.spyOn(computerApi, "start").mockImplementation(async (profile) => {
      current = {
        ...current,
        desktops: current.desktops.map((d) =>
          d.profile === profile ? { ...d, starting: true, phase: "starting" } : d,
        ),
      };
      return { starting: true };
    }),
    ticket: vi.spyOn(computerApi, "ticket").mockImplementation(async (profile) => ({
      path: `/api/v1/computer/${profile}/vnc?ticket=t1`,
      scale: 1,
    })),
    apps: vi.spyOn(computerApi, "apps").mockResolvedValue({
      apps: [{ id: "org.xfce.mousepad", name: "Mousepad" }],
    }),
    openApp: vi.spyOn(computerApi, "openApp").mockResolvedValue(undefined as never),
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
  afterEach(() => vi.restoreAllMocks());

  it("shows a tab per desktop and streams the selected one, view-only", async () => {
    const api = mockApi(
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
    expect(api.ticket).toHaveBeenCalledWith("shared");
    expect(createRfb).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.stringMatching(/\/api\/v1\/computer\/shared\/vnc\?ticket=t1$/),
      1,
      { remoteResize: false },
    );
    expect(fakes.rfbs[0]!.viewOnly).toBe(true);
    // View only: the driving tools appear once the owner takes control.
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
    const api = mockApi(listOf([desktop()]));
    mount();
    await connected();
    const viewport = screen.getByTestId("computer-page-viewport");
    await user.click(await within(viewport).findByRole("button", { name: "Take control" }));
    await waitFor(() => expect(api.driver).toHaveBeenCalledWith("shared", "human"));
    await waitFor(() => expect(fakes.rfbs[0]!.viewOnly).toBe(false));
    expect(within(viewport).queryByRole("button", { name: "Take control" })).toBeNull();
    expect(screen.getByTestId("computer-page-status")).toHaveTextContent("You're driving");

    await user.click(screen.getByTestId("computer-apps"));
    await user.click(await screen.findByRole("menuitem", { name: "Mousepad" }));
    await waitFor(() => expect(api.openApp).toHaveBeenCalledWith("shared", "org.xfce.mousepad"));

    await user.click(screen.getByTestId("computer-keys"));
    const menu = await screen.findByRole("menu");
    await user.click(within(menu).getByRole("menuitem", { name: /Switch windows/ }));
    // Alt down, Tab down, Tab up, Alt up.
    expect(fakes.rfbs[0]!.sendKey.mock.calls).toEqual([
      [0xffe9, "AltLeft", true],
      [0xff09, "Tab", true],
      [0xff09, "Tab", false],
      [0xffe9, "AltLeft", false],
    ]);

    await user.click(screen.getByRole("button", { name: "Hand back" }));
    await waitFor(() => expect(api.driver).toHaveBeenCalledWith("shared", "agent"));
  });

  it("shows what a bot asked for while the owner drives", async () => {
    mockApi(listOf([desktop({ driver: "human", takeover: "Sign in to Mail" })]));
    mount();
    expect(await screen.findByTestId("computer-page-takeover")).toHaveTextContent(
      "Sign in to Mail",
    );
  });

  it("starts a desktop that is off", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const api = mockApi(listOf([desktop({ active: false, driver: null })]));
    mount();
    await user.click(await screen.findByTestId("computer-page-open"));
    await waitFor(() => expect(api.start).toHaveBeenCalledWith("shared"));
    expect(await screen.findByText("Starting the desktop")).toBeInTheDocument();
  });

  it("says why there is no computer without a sandbox VM", async () => {
    mockApi(listOf([desktop({ active: false, driver: null })], false));
    mount();
    expect(await screen.findByTestId("computer-page-setup")).toHaveTextContent("SANDBOX_HOST");
    expect(screen.queryByTestId("computer-region")).not.toBeInTheDocument();
  });
});
