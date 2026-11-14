// Feature: bot-profiles (features/bot-profiles.md). A bot's OWN browser and desktop on
// the local sandbox: the owner switches the bot to its own browser profile in the bot
// settings (Tools → Browser → Browser profile → Own), opens its browser and its
// computer from the chat's panels (`Open browser` / `Open computer`), and resets each
// from the panel. Live views are canvas: proof is the VNC socket on the bot's route,
// the status API (`profile: "own"`), the Browser/Computer pages' `bot-<id>` entries and
// read-backs on the VM (Chrome's --user-data-dir, the desktop's profile directory).
import { execFileSync } from "node:child_process";
import { journey, expect, showLiveView } from "../scripts/lib.mjs";

// The full load event can wait on a third-party embed; the SPA is usable at DOMContentLoaded.
const LOADED = { waitUntil: "domcontentloaded" };

const CONTAINER = process.env.TA_VERIFY_SANDBOX_CONTAINER ?? "tiny-agents-sandbox-sandbox-1";
/** Shell on the sandbox as the bots' user (read-backs; cleanup of this drive's own dirs). */
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
/**
 * Processes whose command line matches `pattern` (pgrep -f), as a number. The first
 * character goes in brackets so the `bash -c` running pgrep never matches itself.
 */
const procs = (pattern) =>
  Number(vm(`pgrep -c -f -- '[${pattern[0]}]${pattern.slice(1)}' || true`).trim() || "0");
const exists = (p) => vm(`test -e ${p} && echo yes || echo no`).trim() === "yes";

await journey(
  "bot-profiles",
  async ({ page, step, proof, cleanup, api, stamp }) => {
    // Steps that catch a product bug record it and fail the journey at the end.
    const bugs = [];
    const bugStep = async (label, body) => {
      try {
        await step(label, body);
      } catch {
        bugs.push(label);
        await proof(`bug-${bugs.length}`);
      }
    };
    const sockets = [];
    page.on("websocket", (ws) => {
      if (!/\/(browser|computer)\/vnc|\/(browser|computer)\/[^/]+\/vnc/.test(ws.url())) return;
      const s = { url: ws.url(), banner: false, bytes: 0 };
      sockets.push(s);
      ws.on("framereceived", (f) => {
        const p = f.payload;
        if (!s.bytes && Buffer.from(p).toString("latin1").startsWith("RFB ")) s.banner = true;
        s.bytes += p.length;
      });
    });
    /** A VNC socket matching `re` said RFB and streamed at least `min` bytes. */
    const streamed = (re, min = 20_000) =>
      expect
        .poll(() => sockets.some((s) => re.test(s.url) && s.banner && s.bytes >= min), {
          timeout: 90_000,
        })
        .toBe(true);
    const name = `Verify Own Profile ${stamp}`;
    let botId;
    let profile; // bot-<id>
    let browserDir; // on the VM, relative to the bots' user's home
    let desktopDir;
    const browserStatus = () => api.get(`/bots/${botId}/browser`);
    const computerStatus = () => api.get(`/bots/${botId}/computer`);
    const pageBrowser = async (p) =>
      (await api.get("/browser")).browsers.find((b) => b.profile === p);
    const pageDesktop = async (p) =>
      (await api.get("/computer")).desktops.find((d) => d.profile === p);

    await step("setup: a faux bot on the default (shared) browser profile", async () => {
      botId = (await api.post("/bots", { name, modelId: "test-model" })).id;
      profile = `bot-${botId}`;
      browserDir = `~/data/browser-profiles/${profile}`;
      desktopDir = `~/.tiny-agents/computer-profiles/${profile}`;
      cleanup(async () => {
        if ((await page.request.get(`/api/v1/bots/${botId}`)).ok()) {
          if ((await browserStatus()).active) await api.delete(`/bots/${botId}/browser/profile`);
          if ((await computerStatus()).active) await api.delete(`/bots/${botId}/computer/profile`);
          await api.delete(`/bots/${botId}`);
        }
        // This drive's own leftovers on the VM only: a desktop its deleted bot left
        // running (see the bug step), and both profile directories.
        vm(
          `P=${desktopDir}; if [ -s $P/.desktop-pids ]; then for X in $(cat $P/.desktop-pids); do kill -- -$X 2>/dev/null; kill $X 2>/dev/null; done; sleep 1; fi; rm -rf ${browserDir} $P`,
        );
      });
      expect((await browserStatus()).profile).toBe("shared");
      expect((await computerStatus()).profile).toBe("shared");
    });

    // ---- bot settings: its own browser profile ---------------------------------
    await step("bot settings: Tools → Browser → Browser profile → Own, save", async () => {
      await page.goto(`/chats/${botId}`, LOADED);
      await page.getByRole("button", { name: `${name} menu` }).click();
      await page.getByRole("menuitem", { name: "Bot settings" }).click();
      const dialog = page.getByRole("dialog", { name: `Edit ${name}` });
      await dialog.getByRole("tab", { name: "Tools" }).click();
      const group = dialog.getByRole("button", { name: /^Browser\s*\d+ tools?/ });
      await expect(group).toBeVisible();
      if ((await group.getAttribute("aria-expanded")) !== "true") await group.click();
      const choice = dialog.getByRole("radiogroup", { name: "Browser profile" });
      await expect(choice.getByRole("radio", { name: "Shared" })).toBeChecked();
      await choice.getByRole("radio", { name: "Own" }).click();
      await expect(dialog.getByText("A browser of its own, with separate sign-ins.")).toBeVisible();
      await proof("settings-own");
      await dialog.getByRole("button", { name: "Save changes" }).click();
      await expect(page.getByText("Bot updated")).toBeVisible();
      await expect(dialog).toHaveCount(0);
    });
    await step("the bot now has its own browser and desktop (API, both pages)", async () => {
      expect((await api.get(`/bots/${botId}`)).browserProfile).toBe("own");
      expect((await browserStatus()).profile).toBe("own");
      expect((await computerStatus()).profile).toBe("own");
      expect((await pageBrowser(profile))?.active).toBe(false);
      expect((await pageDesktop(profile))?.active).toBe(false);
      // Reopen the dialog: the choice persisted.
      await page.reload(LOADED);
      await page.getByRole("button", { name: `${name} menu` }).click();
      await page.getByRole("menuitem", { name: "Bot settings" }).click();
      const dialog = page.getByRole("dialog", { name: `Edit ${name}` });
      await dialog.getByRole("tab", { name: "Tools" }).click();
      const group = dialog.getByRole("button", { name: /^Browser\s*\d+ tools?/ });
      if ((await group.getAttribute("aria-expanded")) !== "true") await group.click();
      await expect(
        dialog
          .getByRole("radiogroup", { name: "Browser profile" })
          .getByRole("radio", { name: "Own" }),
      ).toBeChecked();
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
    });

    // ---- its own browser --------------------------------------------------------
    const browserPanel = page.getByTestId("browser-panel");
    await step("chat Browser panel: Open browser starts the bot's own Chrome", async () => {
      expect(procs(`browser-profiles/${profile}`)).toBe(0);
      await showLiveView(page, "browser");
      await expect(browserPanel).toBeVisible();
      await expect(browserPanel.getByText("No browser is open.")).toBeVisible({ timeout: 20_000 });
      const started = page.waitForResponse(
        (r) =>
          r.url().endsWith(`/api/v1/bots/${botId}/browser/start`) &&
          r.request().method() === "POST",
      );
      await browserPanel.getByRole("button", { name: "Open browser" }).click();
      expect((await started).status()).toBe(200);
      await expect(browserPanel).toContainText("Live", { timeout: 120_000 });
      await streamed(new RegExp(`/bots/${botId}/browser/vnc`));
      await expect(browserPanel.getByTestId("browser-driver")).toHaveText(`${name} drives`);
    });
    await proof("browser-own-live");
    await step("it is the bot's profile, not Shared (API, page list, VM)", async () => {
      const status = await browserStatus();
      expect(status).toMatchObject({ active: true, profile: "own", mode: "vnc" });
      expect((await pageBrowser(profile))?.active).toBe(true);
      expect((await pageBrowser("shared"))?.active).toBe(false);
      await expect(
        browserPanel.getByRole("link", { name: "Open in the Browser page" }),
      ).toHaveAttribute("href", `/browser?profile=${profile}`);
      // Chrome on the VM runs with the bot's own --user-data-dir, and none on shared.
      expect(exists(browserDir)).toBe(true);
      expect(procs(`user-data-dir=[^ ]*browser-profiles/${profile}`)).toBeGreaterThan(0);
      expect(procs("user-data-dir=[^ ]*browser-profiles/shared")).toBe(0);
    });
    await step("the Browser page shows the same browser on the bot's own tab", async () => {
      await browserPanel.getByRole("link", { name: "Open in the Browser page" }).click();
      await expect(page).toHaveURL(new RegExp(`/browser\\?profile=${profile}$`));
      const tab = page.getByTestId(`browser-tab-${profile}`);
      await expect(tab).toHaveAttribute("aria-selected", "true", { timeout: 20_000 });
      await expect(tab).toContainText("own browser");
      await expect(page.getByTestId("browser-page-status")).toContainText("Live", {
        timeout: 60_000,
      });
      await streamed(new RegExp(`/browser/${profile}/vnc`));
    });
    await proof("browser-page-own-tab");
    await step(
      "panel Reset: confirm names this bot's browser; profile wiped on the VM",
      async () => {
        await page.goto(`/chats/${botId}`, LOADED);
        if (!(await browserPanel.isVisible().catch(() => false)))
          await showLiveView(page, "browser");
        await expect(browserPanel).toContainText("Live", { timeout: 60_000 });
        const reset = page.waitForResponse(
          (r) =>
            r.url().endsWith(`/api/v1/bots/${botId}/browser/profile`) &&
            r.request().method() === "DELETE",
        );
        await browserPanel.getByRole("button", { name: "Reset browser profile" }).click();
        const dialog = page.getByRole("alertdialog");
        await expect(dialog).toContainText("Reset this bot's browser?");
        await expect(dialog).toContainText("This closes the browser and deletes its cookies");
        await dialog.getByRole("button", { name: "Reset", exact: true }).click();
        expect((await reset).status()).toBe(200);
        await expect(
          page.getByText("Browser profile wiped; the next session starts fresh."),
        ).toBeVisible();
        await expect(browserPanel.getByRole("button", { name: "Open browser" })).toBeVisible({
          timeout: 30_000,
        });
        expect((await browserStatus()).active).toBe(false);
        await expect.poll(() => procs(`browser-profiles/${profile}`), { timeout: 30_000 }).toBe(0);
        await expect.poll(() => exists(browserDir), { timeout: 30_000 }).toBe(false);
      },
    );
    await proof("browser-own-reset");
    await step("close the Browser panel", async () => {
      await browserPanel.getByRole("button", { name: "Close browser panel" }).click();
      await expect(browserPanel).toHaveCount(0);
    });

    // ---- its own desktop ----------------------------------------------------------
    const computerPanel = page.getByTestId("computer-panel");
    const sharedXBefore = vm(
      ". ~/.tiny-agents/computer-profiles/shared/.desktop-env 2>/dev/null && echo up || echo off",
    ).trim();
    await step("chat Computer panel: Open computer starts the bot's own desktop", async () => {
      await showLiveView(page, "computer");
      await expect(computerPanel).toBeVisible();
      await expect(computerPanel.getByText("The computer is off.")).toBeVisible({
        timeout: 20_000,
      });
      const started = page.waitForResponse(
        (r) =>
          r.url().endsWith(`/api/v1/bots/${botId}/computer/start`) &&
          r.request().method() === "POST",
      );
      await computerPanel.getByRole("button", { name: "Open computer" }).click();
      expect((await started).status()).toBe(200);
      await streamed(new RegExp(`/bots/${botId}/computer/vnc`));
      await expect(computerPanel).toContainText("Live", { timeout: 60_000 });
      await expect(computerPanel.getByTestId("computer-driver")).toHaveText(`${name} drives`);
    });
    await proof("computer-own-live");
    await step("it is the bot's desktop, not Shared (API, page list, VM)", async () => {
      expect(await computerStatus()).toMatchObject({ active: true, profile: "own" });
      expect((await pageDesktop(profile))?.active).toBe(true);
      expect((await pageDesktop("shared"))?.active).toBe(false);
      // The desktop's session lives in the bot's profile directory and has windows.
      expect(exists(`${desktopDir}/.desktop-env`)).toBe(true);
      await expect
        .poll(
          () => vm(`. ${desktopDir}/.desktop-env && wmctrl -l`).split("\n").filter(Boolean).length,
          { timeout: 30_000 },
        )
        .toBeGreaterThan(0);
      // The shared desktop was not started by this.
      expect(sharedXBefore).toBe("off");
      expect(exists("~/.tiny-agents/computer-profiles/shared/.desktop-env")).toBe(false);
    });
    await step("panel Take control / Release control drive the bot's desktop", async () => {
      await computerPanel.getByRole("button", { name: "Take control" }).click();
      await expect(computerPanel.getByTestId("computer-driver")).toHaveText("You drive");
      await expect.poll(async () => (await pageDesktop(profile))?.driver).toBe("human");
      await computerPanel.getByRole("button", { name: "Release control" }).click();
      await expect(computerPanel.getByTestId("computer-driver")).toHaveText(`${name} drives`);
    });
    await step("the Computer page lists it as the bot's own desktop, live", async () => {
      await page.goto("/computer", LOADED);
      const tab = page.getByTestId(`computer-tab-${profile}`);
      await expect(tab).toContainText("own desktop", { timeout: 20_000 });
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
      await streamed(new RegExp(`/computer/${profile}/vnc`));
      await expect(page.getByRole("button", { name: /View only · Take control/ })).toBeVisible({
        timeout: 30_000,
      });
    });
    await proof("computer-page-own-tab");
    await step(
      "panel Reset: confirm names this bot's computer; profile wiped on the VM",
      async () => {
        await page.goto(`/chats/${botId}`, LOADED);
        if (!(await computerPanel.isVisible().catch(() => false)))
          await showLiveView(page, "computer");
        await expect(computerPanel.getByTestId("computer-driver")).toBeVisible({ timeout: 60_000 });
        const reset = page.waitForResponse(
          (r) =>
            r.url().endsWith(`/api/v1/bots/${botId}/computer/profile`) &&
            r.request().method() === "DELETE",
        );
        await computerPanel.getByRole("button", { name: "Reset computer" }).click();
        const dialog = page.getByRole("alertdialog");
        await expect(dialog).toContainText("Reset this bot's computer?");
        await dialog.getByRole("button", { name: "Reset", exact: true }).click();
        expect((await reset).status()).toBe(200);
        await expect(
          page.getByText("Computer reset; the next session starts a fresh desktop."),
        ).toBeVisible();
        await expect(computerPanel.getByRole("button", { name: "Open computer" })).toBeVisible({
          timeout: 30_000,
        });
        expect((await computerStatus()).active).toBe(false);
        await expect.poll(() => exists(desktopDir), { timeout: 30_000 }).toBe(false);
        await expect.poll(() => procs("Xtigervnc"), { timeout: 30_000 }).toBe(0);
      },
    );
    await proof("computer-own-reset");

    // ---- deleting the bot releases what it owned ------------------------------------
    await step("open the bot's browser and desktop again", async () => {
      await showLiveView(page, "browser");
      await browserPanel.getByRole("button", { name: "Open browser" }).click();
      await expect
        .poll(async () => (await browserStatus()).active, { timeout: 120_000 })
        .toBe(true);
      await showLiveView(page, "computer");
      await computerPanel.getByRole("button", { name: "Open computer" }).click();
      await expect
        .poll(async () => (await computerStatus()).active, { timeout: 120_000 })
        .toBe(true);
      expect(procs(`browser-profiles/${profile}`)).toBeGreaterThan(0);
      expect(exists(`${desktopDir}/.desktop-env`)).toBe(true);
    });
    await step("bot settings → Delete bot removes the bot", async () => {
      await page.getByRole("button", { name: `${name} menu` }).click();
      await page.getByRole("menuitem", { name: "Bot settings" }).click();
      const dialog = page.getByRole("dialog", { name: `Edit ${name}` });
      await dialog.getByRole("button", { name: "Delete bot" }).click();
      await expect(dialog.getByText(`Delete ${name}? This cannot be undone.`)).toBeVisible();
      await dialog.getByRole("button", { name: "Delete bot" }).click();
      await expect(dialog).toHaveCount(0);
      expect((await page.request.get(`/api/v1/bots/${botId}`)).status()).toBe(404);
    });
    await step("its own browser closes with it and the profile is wiped (#88)", async () => {
      await expect.poll(() => procs(`browser-profiles/${profile}`), { timeout: 30_000 }).toBe(0);
      await expect.poll(() => exists(browserDir), { timeout: 30_000 }).toBe(false);
    });
    await bugStep("its own desktop closes with it and the profile is wiped", async () => {
      // The Computer page no longer lists it, so nothing in the UI could reach it.
      expect(await pageDesktop(profile)).toBeUndefined();
      await expect.poll(() => procs("Xtigervnc"), { timeout: 30_000 }).toBe(0);
      await expect.poll(() => exists(desktopDir), { timeout: 30_000 }).toBe(false);
    });
    await proof("bot-deleted");
    if (bugs.length) throw new Error(`product bug(s): ${bugs.join("; ")}`);
  },
  { requires: ["sandbox"] },
);
