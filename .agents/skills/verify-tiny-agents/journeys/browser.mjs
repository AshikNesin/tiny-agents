// Feature: browser (features/browser.md). The bots' real Chrome on the local sandbox:
// the /browser page (open, live view, take/release control, full screen, own-profile
// tab and deep link, reset) and the chat's Browser panel (docked and picture in picture), on
// desktop and on a 390x844 phone. Live views are canvas: proof is the VNC socket
// (RFB handshake + framebuffer bytes), ARIA state and a read-back of Chrome on the VM.
import { execFileSync } from "node:child_process";
import { journey, expect, showLiveView } from "../scripts/lib.mjs";

// The full load event can wait on a third-party embed; the SPA is usable at DOMContentLoaded.
const LOADED = { waitUntil: "domcontentloaded" };

const CONTAINER = process.env.TA_VERIFY_SANDBOX_CONTAINER ?? "tiny-agents-sandbox-sandbox-1";
/** Chrome processes on the sandbox (read-only). */
const chromes = () => {
  try {
    return execFileSync(
      "docker",
      ["exec", CONTAINER, "pgrep", "-c", "-f", "google-chrome|chrome/chrome"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
  } catch {
    return "0"; // pgrep exits 1 when nothing matches
  }
};
const PHONE = { width: 390, height: 844 };

await journey(
  "browser",
  async ({ page, step, proof, cleanup, api, stamp }) => {
    // Every VNC socket the page opens: the first server frame is the RFB banner.
    const sockets = [];
    page.on("websocket", (ws) => {
      if (!/\/browser\/vnc|\/browser\/[^/]+\/vnc/.test(ws.url())) return;
      const s = { url: ws.url(), banner: false, bytes: 0 };
      sockets.push(s);
      ws.on("framereceived", (f) => {
        const p = f.payload;
        if (!s.bytes && String(typeof p === "string" ? p : p.toString("latin1")).startsWith("RFB "))
          s.banner = true;
        s.bytes += p.length;
      });
    });
    /** A VNC socket matching `re` said RFB and streamed at least `min` bytes. */
    const streamed = (re, min = 20_000) =>
      expect
        .poll(() => sockets.some((s) => re.test(s.url) && s.banner && s.bytes >= min), {
          timeout: 60_000,
        })
        .toBe(true);
    const shared = async () =>
      (await api.get("/browser")).browsers.find((b) => b.profile === "shared");
    const name = `Verify Browser ${stamp}`;
    const ownName = `Verify Own ${stamp}`;
    let botId;
    let ownId;

    await step("setup: a faux bot on the shared profile and one with its own profile", async () => {
      botId = (await api.post("/bots", { name, modelId: "test-model" })).id;
      cleanup(() => api.delete(`/bots/${botId}`));
      ownId = (
        await api.post("/bots", { name: ownName, modelId: "test-model", browserProfile: "own" })
      ).id;
      cleanup(() => api.delete(`/bots/${ownId}`));
      expect(botId && ownId).toBeTruthy();
    });

    // ---- /browser page ----------------------------------------------------
    await step("open /browser: Shared tab selected, own-profile bot has its own tab", async () => {
      await page.goto("/browser", LOADED);
      const tabs = page.getByRole("tablist", { name: "Browsers" });
      await expect(tabs.getByTestId("browser-tab-shared")).toHaveAttribute(
        "aria-selected",
        "true",
        {
          timeout: 20_000,
        },
      );
      await expect(tabs.getByTestId("browser-tab-shared")).toContainText(name);
      await expect(tabs.getByTestId(`browser-tab-bot-${ownId}`)).toContainText("own browser");
    });
    await step("deep link ?profile=bot-<id> selects that browser", async () => {
      await page.goto(`/browser?profile=bot-${ownId}`, LOADED);
      await expect(page.getByTestId(`browser-tab-bot-${ownId}`)).toHaveAttribute(
        "aria-selected",
        "true",
        {
          timeout: 20_000,
        },
      );
      await page.getByTestId("browser-tab-shared").click();
      await expect(page.getByTestId("browser-tab-shared")).toHaveAttribute("aria-selected", "true");
    });
    await step("Open browser: Chrome starts on the VM and the live view streams", async () => {
      const open = page.getByRole("button", { name: "Open browser" });
      if (await open.isVisible({ timeout: 5_000 }).catch(() => false)) await open.click();
      // A failed drive must not leave Chrome running on the shared sandbox.
      cleanup(async () => (await shared()).active && api.delete("/browser/shared"));
      // Once live, the status chip says who drives.
      await expect(page.getByTestId("browser-page-driver")).toBeVisible({ timeout: 120_000 });
      await streamed(/\/browser\/shared\/vnc/);
      // View only: the stream itself is the Take control button.
      await expect(
        page.getByTestId("browser-page-viewport").getByRole("button", { name: "Take control" }),
      ).toBeVisible();
      expect((await shared()).active).toBe(true);
      expect(Number(chromes())).toBeGreaterThan(0);
    });
    await proof("page-live");
    await step(
      "A click on the stream takes control: Paste shows; the flag reads human",
      async () => {
        await page.getByRole("button", { name: "Take control", exact: true }).click();
        await expect(page.getByRole("button", { name: "Hand back" })).toBeVisible();
        await expect(page.getByTestId("browser-page-status")).toContainText("You're driving");
        await expect(page.getByRole("button", { name: "Paste from your clipboard" })).toBeEnabled();
        await expect.poll(async () => (await shared()).driver).toBe("human");
      },
    );
    await proof("page-you-drive");
    await step("Hand back returns it to the bot", async () => {
      await page.getByRole("button", { name: "Hand back" }).click();
      await expect(page.getByRole("button", { name: "Take control", exact: true })).toBeVisible();
      await expect(page.getByTestId("browser-page-status")).toContainText(`${name} is driving`);
      await expect.poll(async () => (await shared()).driver).not.toBe("human");
    });
    await step("Full screen puts the browser region in the Fullscreen API", async () => {
      await page.getByRole("button", { name: "Full screen", exact: true }).click();
      await expect
        .poll(() => page.evaluate(() => document.fullscreenElement?.dataset.testid ?? null))
        .toBe("browser-region");
      // Headless Chromium has no browser-level Esc; leave it the way Esc would.
      await page.evaluate(() => document.exitFullscreen());
      await expect(page.getByRole("button", { name: "Full screen", exact: true })).toBeVisible();
    });

    // ---- chat Browser panel, desktop ---------------------------------------
    const composer = page.getByPlaceholder(new RegExp(`(?:ask|message) ${name}`, "i"));
    const panel = page.getByTestId("browser-panel");
    // Count replies in the transcript only: the sidebar's last-message preview
    // ("<bot> now Echo:") also matches, and on a phone it sits in the closed drawer.
    const echoes = (n) =>
      expect(page.getByRole("region", { name: "Messages" }).getByText(/^Echo:/)).toHaveCount(n, {
        timeout: 90_000,
      });
    const browse = async (n) => {
      await composer.fill(`/browse ${n}`);
      await composer.press("Enter");
    };

    const toggle = page.getByTestId("live-view-toggle");
    await step("chat: /browse 2 leaves the panel closed", async () => {
      await page.goto(`/chats/${botId}`, LOADED);
      await expect(composer).toBeVisible({ timeout: 20_000 });
      await expect(panel).toHaveCount(0);
      await browse(2);
      // The run reads the page twice and answers; the panel never appears.
      await echoes(1);
      await expect(panel).toHaveCount(0);
      await expect(toggle).toBeVisible();
    });
    await proof("panel-closed-in-use");
    await step("chat: the toggle opens the panel live beside the chat", async () => {
      await toggle.click();
      await expect(panel).toBeVisible();
      await expect(panel.getByTestId("browser-driver")).toBeVisible({ timeout: 60_000 });
      await streamed(new RegExp(`/bots/${botId}/browser/vnc`));
      await expect(panel.getByTestId("browser-driver")).toHaveText(`${name} is driving`);
    });
    await proof("panel-desktop");
    await step("panel: a click on the stream takes control; Hand back returns it", async () => {
      await panel.getByRole("button", { name: "Take control" }).click();
      await expect(panel.getByTestId("browser-driver")).toHaveText("You're driving");
      expect((await api.get(`/bots/${botId}/browser`)).driver).toBe("human");
      await panel.getByRole("button", { name: "Hand back" }).click();
      await expect(panel.getByTestId("browser-driver")).toHaveText(`${name} is driving`);
    });
    await step("panel: picture in picture floats a small live view over the chat", async () => {
      await panel.getByRole("button", { name: "Picture in picture" }).click();
      await expect(panel).toHaveAttribute("data-layout", "pip");
      const box = await panel.boundingBox();
      expect(box.width).toBeLessThanOrEqual(321);
      await expect(composer).toBeVisible();
      await browse(1);
      await echoes(2);
      await expect(panel.getByTestId("browser-driver")).toHaveText(`${name} is driving`);
    });
    await proof("pip-desktop");
    await step("pip: the toggle reopens it as picture in picture; Expand docks it", async () => {
      await toggle.click();
      await expect(panel).toHaveCount(0);
      await toggle.click();
      await expect(panel).toHaveAttribute("data-layout", "pip");
      await panel.getByRole("button", { name: "Expand live view" }).first().click();
      await expect(panel).toHaveAttribute("data-layout", "docked");
      await expect(panel.getByRole("link", { name: "Open in the Browser page" })).toBeVisible();
      await panel.getByRole("button", { name: "Picture in picture" }).click();
      await expect(panel).toHaveAttribute("data-layout", "pip");
    });

    // ---- chat Browser panel, phone -----------------------------------------
    await step(
      "phone: browsing leaves the chat readable; the picture in picture floats",
      async () => {
        await page.setViewportSize(PHONE);
        await page.getByRole("button", { name: "Close browser panel" }).click();
        await expect(panel).toHaveCount(0);
        await browse(1);
        await echoes(3);
        await expect(panel).toHaveCount(0);
        await page.reload(LOADED);
        await echoes(3);
        await showLiveView(page, "browser");
        await expect(panel).toHaveAttribute("data-layout", "pip");
        await expect(panel.getByTestId("browser-driver")).toBeVisible({ timeout: 60_000 });
        const box = await panel.boundingBox();
        expect(box.width).toBeLessThan(PHONE.width - 50);
        await expect(composer).toBeVisible();
      },
    );
    await proof("pip-phone");
    await step("phone: Expand makes it the full-screen overlay", async () => {
      await panel.getByTestId("browser-pip-expand").click();
      await expect(panel).toHaveAttribute("data-layout", "docked");
      const box = await panel.boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(PHONE.width - 1);
      expect(box.height).toBeGreaterThanOrEqual(PHONE.height - 1);
    });
    await proof("panel-phone");

    // ---- reset ----------------------------------------------------------------
    await step(
      "/browser Reset asks, names the bots, closes Chrome and wipes the profile",
      async () => {
        await page.setViewportSize({ width: 1280, height: 860 });
        await page.goto("/browser", LOADED);
        await expect(page.getByTestId("browser-page-status")).toBeVisible({ timeout: 30_000 });
        await page.getByRole("button", { name: "Reset browser" }).click();
        const dialog = page.getByRole("alertdialog");
        await expect(dialog).toContainText("Reset the Shared browser?");
        await expect(dialog).toContainText(`Every bot on it is signed out (${name})`);
        await dialog.getByRole("button", { name: "Reset", exact: true }).click();
        await expect(page.getByText("Browser reset; it starts fresh next time.")).toBeVisible();
        await expect(page.getByRole("button", { name: "Open browser" })).toBeVisible({
          timeout: 30_000,
        });
        await expect.poll(async () => (await shared()).active, { timeout: 30_000 }).toBe(false);
        await expect.poll(chromes, { timeout: 30_000 }).toBe("0");
      },
    );
    await proof("page-reset");
  },
  { requires: ["sandbox"] },
);
