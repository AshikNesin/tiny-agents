// Feature: computer (features/computer.md). The XFCE desktop on the local sandbox:
// the /computer page (start a desktop, live VNC view, take/release control, Apps menu,
// Keys menu, full screen, reset) and the chat's Computer panel. The view is a canvas:
// proof is the VNC socket (RFB banner, framebuffer bytes, key events sent), ARIA state
// and read-backs of the desktop's windows on the VM (`wmctrl -l`).
import { execFileSync } from "node:child_process";
import { journey, expect } from "../scripts/lib.mjs";

// The full load event can wait on a third-party embed; the SPA is usable at DOMContentLoaded.
const LOADED = { waitUntil: "domcontentloaded" };

const CONTAINER = process.env.TA_VERIFY_SANDBOX_CONTAINER ?? "tiny-agents-sandbox-sandbox-1";
/** Read-only shell on the sandbox as the bots' user. */
const vm = (script) => {
  try {
    return execFileSync("docker", ["exec", "-u", "exedev", CONTAINER, "bash", "-c", script], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (error) {
    return String(error.stdout ?? "");
  }
};
/** The shared desktop's windows (WM_CLASS column included). */
const windows = () =>
  vm(". ~/.tiny-agents/computer-profiles/shared/.desktop-env 2>/dev/null && wmctrl -l -x")
    .split("\n")
    .filter(Boolean);
const xservers = () => vm("pgrep -c Xtigervnc || true").trim();

await journey(
  "computer",
  async ({ page, step, proof, cleanup, api, stamp }) => {
    const sockets = [];
    page.on("websocket", (ws) => {
      if (!/\/computer\/vnc|\/computer\/[^/]+\/vnc/.test(ws.url())) return;
      const s = { url: ws.url(), banner: false, bytes: 0, keyEvents: 0 };
      sockets.push(s);
      ws.on("framereceived", (f) => {
        const p = f.payload;
        if (!s.bytes && Buffer.from(p).toString("latin1").startsWith("RFB ")) s.banner = true;
        s.bytes += p.length;
      });
      // Key presses: RFB KeyEvent (type 4, 8 bytes) or, on TigerVNC, QEMU extended
      // key event (type 255 subtype 0, 12 bytes). noVNC may batch several per frame.
      ws.on("framesent", (f) => {
        const p = Buffer.from(f.payload);
        if (p[0] === 4) s.keyEvents += Math.floor(p.length / 8);
        else if (p[0] === 255 && p[1] === 0) s.keyEvents += Math.floor(p.length / 12);
      });
    });
    const streamed = (re, min = 20_000) =>
      expect
        .poll(() => sockets.some((s) => re.test(s.url) && s.banner && s.bytes >= min), {
          timeout: 90_000,
        })
        .toBe(true);
    const shared = async () =>
      (await api.get("/computer")).desktops.find((d) => d.profile === "shared");
    const name = `Verify Computer ${stamp}`;
    let botId;

    await step("setup: a faux bot on the shared profile (for the chat panel)", async () => {
      botId = (await api.post("/bots", { name, modelId: "test-model" })).id;
      cleanup(() => api.delete(`/bots/${botId}`));
    });

    await step("open /computer: the Shared desktop tab names its bot", async () => {
      await page.goto("/computer", LOADED);
      const tab = page
        .getByRole("tablist", { name: "Desktops" })
        .getByTestId("computer-tab-shared");
      await expect(tab).toHaveAttribute("aria-selected", "true", { timeout: 20_000 });
      await expect(tab).toContainText(name);
      expect((await api.get("/computer")).configured).toBe(true);
    });
    await proof("open");

    await step("Start desktop: XFCE starts on the VM and the live view streams", async () => {
      const start = page.getByRole("button", { name: "Start desktop" });
      if (await start.isVisible({ timeout: 5_000 }).catch(() => false)) await start.click();
      cleanup(async () => (await shared()).active && api.delete("/computer/shared"));
      await streamed(/\/computer\/shared\/vnc/);
      await expect(page.getByRole("button", { name: /View only · Take control/ })).toBeVisible({
        timeout: 30_000,
      });
      // View only: the driving tools wait for Take control.
      await expect(page.getByTestId("computer-apps")).toBeDisabled();
      await expect(page.getByTestId("computer-keys")).toBeDisabled();
      expect((await shared()).active).toBe(true);
      await expect.poll(() => windows().length, { timeout: 30_000 }).toBeGreaterThan(0);
    });
    await proof("live-view-only");

    await step("Take control: you drive, Apps/Keys/Paste unlock, flag reads human", async () => {
      await page.getByRole("button", { name: "Take control", exact: true }).click();
      await expect(page.getByRole("button", { name: "Release control" })).toBeVisible();
      await expect(page.getByTestId("computer-apps")).toBeEnabled();
      await expect(page.getByTestId("computer-keys")).toBeEnabled();
      await expect(page.getByRole("button", { name: "Paste from your clipboard" })).toBeEnabled();
      await expect.poll(async () => (await shared()).driver).toBe("human");
    });

    let appWindowsBefore;
    await step("Apps menu lists the desktop's apps and opens one as a window", async () => {
      appWindowsBefore = windows().length;
      await page.getByTestId("computer-apps").click();
      const menu = page.getByRole("menu");
      await expect(menu).toContainText("Open an app");
      const items = menu.getByRole("menuitem");
      await expect(items.first()).toBeVisible({ timeout: 20_000 });
      const preferred = items.filter({ hasText: /Mousepad|Text Editor|Task Manager/ }).first();
      const item = (await preferred.count()) ? preferred : items.first();
      const appName = (await item.textContent()).trim();
      await item.click();
      await expect(page.getByText(`Opening ${appName}…`)).toBeVisible();
      await expect
        .poll(() => windows().length, { timeout: 30_000 })
        .toBeGreaterThan(appWindowsBefore);
    });
    await proof("app-opened");

    await step("Keys menu sends Ctrl+Alt+T: key events go out and a terminal opens", async () => {
      const before = windows().filter((w) => /terminal/i.test(w)).length;
      const sentBefore = sockets.reduce((n, s) => n + s.keyEvents, 0);
      await page.getByTestId("computer-keys").click();
      await page.getByRole("menuitem", { name: /Open a terminal/ }).click();
      await expect
        .poll(() => sockets.reduce((n, s) => n + s.keyEvents, 0))
        .toBeGreaterThanOrEqual(sentBefore + 6); // three keys down + up
      await expect
        .poll(() => windows().filter((w) => /terminal/i.test(w)).length, { timeout: 30_000 })
        .toBeGreaterThan(before);
    });
    await proof("keys-terminal");

    await step("Release control hands the desktop back to the bots", async () => {
      await page.getByRole("button", { name: "Release control" }).click();
      await expect(page.getByRole("button", { name: "Take control", exact: true })).toBeVisible();
      await expect(page.getByTestId("computer-apps")).toBeDisabled();
      await expect.poll(async () => (await shared()).driver).not.toBe("human");
    });

    await step("Full screen puts the desktop region in the Fullscreen API", async () => {
      await page.getByRole("button", { name: "Full screen", exact: true }).click();
      await expect
        .poll(() => page.evaluate(() => document.fullscreenElement?.dataset.testid ?? null))
        .toBe("computer-region");
      // Headless Chromium has no browser-level Esc; leave it the way Esc would.
      await page.evaluate(() => document.exitFullscreen());
      await expect(page.getByRole("button", { name: "Full screen", exact: true })).toBeVisible();
    });

    await step("chat: the Computer panel shows the same live desktop", async () => {
      await page.goto(`/chats/${botId}`, LOADED);
      await page.getByTestId("computer-toggle").click();
      const panel = page.getByTestId("computer-panel");
      await expect(panel).toBeVisible();
      await streamed(new RegExp(`/bots/${botId}/computer/vnc`));
      await expect(panel.getByRole("button", { name: "Take control" })).toBeVisible({
        timeout: 30_000,
      });
      await expect(panel.getByRole("link", { name: "Open the Computer page" })).toBeVisible();
    });
    await proof("chat-panel");
    await step("chat panel: Take control and Release control flip the driver", async () => {
      const panel = page.getByTestId("computer-panel");
      await panel.getByRole("button", { name: "Take control" }).click();
      await expect(panel.getByTestId("computer-driver")).toHaveText("You drive");
      await expect.poll(async () => (await shared()).driver).toBe("human");
      await panel.getByRole("button", { name: "Release control" }).click();
      await expect(panel.getByTestId("computer-driver")).not.toHaveText("You drive");
      await panel.getByRole("button", { name: "Close computer panel" }).click();
      await expect(panel).toHaveCount(0);
    });

    await step("Reset asks first, closes the desktop and wipes its settings", async () => {
      await page.goto("/computer", LOADED);
      await page.getByRole("button", { name: "Reset desktop" }).click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toContainText("Reset the Shared desktop?");
      await dialog.getByRole("button", { name: "Reset", exact: true }).click();
      await expect(page.getByText("Desktop reset; it starts fresh next time.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Start desktop" })).toBeVisible({
        timeout: 30_000,
      });
      expect((await shared()).active).toBe(false);
      await expect.poll(xservers, { timeout: 30_000 }).toBe("0");
    });
    await proof("reset");
  },
  { requires: ["sandbox"] },
);
