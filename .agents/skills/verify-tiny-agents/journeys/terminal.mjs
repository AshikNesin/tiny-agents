// Feature: terminal (features/terminal.md). Real tmux shells on the local sandbox:
// open tabs, type a command (proved by WebSocket frames, never canvas pixels), reload
// re-attach, keys panel, font size, full screen, busy-close confirmation, plain close.
// Read-back: `tmux -L ta-terminal` inside the sandbox container. Only this drive's
// tabs are touched; tabs that existed before the drive are left alone.
import { execFileSync } from "node:child_process";
import { journey, expect } from "../scripts/lib.mjs";

// The full load event can wait on a third-party embed; the SPA is usable at DOMContentLoaded.
const LOADED = { waitUntil: "domcontentloaded" };

const CONTAINER = process.env.TA_VERIFY_SANDBOX_CONTAINER ?? "tiny-agents-sandbox-sandbox-1";
/** Read-only tmux query on the sandbox (the app's tmux socket is `-L ta-terminal`). */
const tmux = (...args) => {
  try {
    return execFileSync(
      "docker",
      ["exec", "-u", "exedev", CONTAINER, "tmux", "-L", "ta-terminal", ...args],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (error) {
    return String(error.stdout ?? ""); // `ls` exits 1 when no server runs
  }
};
const tmuxSessions = () => tmux("ls", "-F", "#{session_name}").split("\n").filter(Boolean);
const text = (payload) => (typeof payload === "string" ? payload : payload.toString("utf8"));

await journey(
  "terminal",
  async ({ page, context, step, proof, cleanup, api, stamp }) => {
    const received = [];
    const sent = [];
    page.on("websocket", (ws) => {
      if (!ws.url().includes("/api/v1/terminal/ws/")) return;
      ws.on("framereceived", (f) => received.push(text(f.payload)));
      ws.on("framesent", (f) => sent.push(text(f.payload)));
    });
    const listed = async () => (await api.get("/terminal/sessions")).sessions.map((s) => s.name);
    const mine = [];
    /** The tab this drive just opened: the one listed now that was not before. */
    const adopt = async (before) => {
      let name;
      await expect
        .poll(async () => (name = (await listed()).find((n) => !before.includes(n))), {
          timeout: 20_000,
        })
        .toBeTruthy();
      mine.push(name);
      cleanup(async () => {
        if ((await listed()).includes(name)) await api.delete(`/terminal/sessions/${name}?force=1`);
        expect(tmuxSessions()).not.toContain(name);
      });
      return name;
    };
    const tab = (name) =>
      page.getByRole("tablist", { name: "Terminal tabs" }).getByTestId(`terminal-tab-${name}`);
    // The header's "New tab" and the strip's "+" share a name; use the strip's.
    const newTab = () =>
      page.getByRole("tablist", { name: "Terminal tabs" }).getByRole("button", { name: "New tab" });
    const marker = `v42-${stamp}`;
    let first;
    let second;

    await step("open /terminal: sandbox ready, tmux reachable", async () => {
      await page.goto("/terminal", LOADED);
      await expect(page.getByRole("heading", { name: "Terminal" })).toBeVisible();
      expect((await api.get("/terminal/sessions")).status.kind).toBe("ready");
      // Either the empty state or the tab strip, never an error state.
      await expect(
        page
          .getByRole("button", { name: "Open your first tab" })
          .or(page.getByRole("tablist", { name: "Terminal tabs" })),
      ).toBeVisible({ timeout: 30_000 });
    });
    await proof("open");

    await step("open a tab: a tmux session appears and the shell prompt streams in", async () => {
      const before = await listed();
      const empty = page.getByRole("button", { name: "Open your first tab" });
      if (await empty.isVisible()) await empty.click();
      else await newTab().click();
      first = await adopt(before);
      await expect(tab(first)).toHaveAttribute("aria-selected", "true", { timeout: 15_000 });
      await expect(page.getByTestId(`terminal-tab-status-${first}`)).toHaveAttribute(
        "data-state",
        "live",
        { timeout: 30_000 },
      );
      await expect
        .poll(() => received.some((f) => /[$#%]/.test(f)), { timeout: 30_000 })
        .toBe(true);
      expect(tmuxSessions()).toContain(first);
    });

    await step("type a command: its output comes back over the socket", async () => {
      await page.getByTestId(`terminal-view-${first}`).click();
      // The output (v42-…) differs from what is typed ($((6*7))), so the echo of
      // the keystrokes alone cannot satisfy the assertion.
      await page.keyboard.type(`echo "v$((6*7))-${stamp}"`, { delay: 15 });
      await page.keyboard.press("Enter");
      await expect
        .poll(() => received.some((f) => f.includes(marker)), { timeout: 20_000 })
        .toBe(true);
      // Second view: the pane on the VM holds the output.
      await expect
        .poll(() => tmux("capture-pane", "-p", "-t", first), { timeout: 10_000 })
        .toContain(marker);
    });
    await proof("command-output");

    await step("reload: the tab is still listed and the re-attach redraws the output", async () => {
      received.length = 0;
      await page.reload(LOADED);
      await expect(tab(first)).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId(`terminal-tab-status-${first}`)).toHaveAttribute(
        "data-state",
        "live",
        { timeout: 30_000 },
      );
      await expect
        .poll(() => received.some((f) => f.includes(marker)), { timeout: 20_000 })
        .toBe(true);
    });

    await step("a second tab opens beside the first and takes focus", async () => {
      const before = await listed();
      await newTab().click();
      second = await adopt(before);
      await expect(tab(second)).toHaveAttribute("aria-selected", "true", { timeout: 15_000 });
      await expect(tab(first)).toHaveAttribute("aria-selected", "false");
      await expect(page.getByTestId(`terminal-tab-status-${second}`)).toHaveAttribute(
        "data-state",
        "live",
        { timeout: 30_000 },
      );
    });

    await step("?tab=<name> opens on that tab; clicking a tab switches back", async () => {
      await page.goto(`/terminal?tab=${first}`, LOADED);
      await expect(tab(first)).toHaveAttribute("aria-selected", "true", { timeout: 30_000 });
      await tab(second).click();
      await expect(tab(second)).toHaveAttribute("aria-selected", "true");
      await expect(page.getByTestId(`terminal-view-${second}`)).toBeVisible();
      await expect(page.getByTestId(`terminal-tab-status-${second}`)).toHaveAttribute(
        "data-state",
        "live",
        { timeout: 30_000 },
      );
    });

    await step("keys panel: Arrow up, Ctrl+L and Ctrl+C reach the pty as their bytes", async () => {
      const keys = page.getByRole("complementary", { name: "Terminal keys" });
      await expect(keys).toBeVisible(); // desktop viewport: open by default
      sent.length = 0;
      await keys.getByRole("button", { name: "Arrow up" }).click();
      await expect
        .poll(() => sent.some((f) => f.charCodeAt(0) === 0x1b && f.endsWith("[A")), {
          timeout: 10_000,
        })
        .toBe(true);
      sent.length = 0;
      await keys.getByRole("button", { name: "Ctrl+L" }).click();
      await expect.poll(() => sent.includes("\x0c"), { timeout: 10_000 }).toBe(true);
      // Arrow up may have recalled a command from the VM's bash history; ^C
      // drops that line so the next typed command starts clean.
      sent.length = 0;
      await keys.getByRole("button", { name: "Ctrl+C" }).click();
      await expect.poll(() => sent.includes("\x03"), { timeout: 10_000 }).toBe(true);
    });

    await step("keys panel: hide and show from the header, choice persisted", async () => {
      await page.getByRole("button", { name: "Hide keys panel" }).first().click();
      await expect(page.getByRole("complementary", { name: "Terminal keys" })).toHaveCount(0);
      expect(await page.evaluate(() => localStorage.getItem("tiny-agents:terminal-keys"))).toBe(
        "0",
      );
      await page.getByRole("button", { name: "Show keys panel" }).click();
      await expect(page.getByRole("complementary", { name: "Terminal keys" })).toBeVisible();
    });

    await step("font size: A+ grows the shared text size, reset restores it", async () => {
      const size = page.getByTestId("terminal-font-size");
      const before = Number(await size.textContent());
      await page.getByRole("button", { name: "Larger text" }).click();
      await expect(size).toHaveText(String(before + 1));
      await size.click();
      await expect(size).toHaveText(String(before));
    });

    await step("full screen: the terminal region fills the viewport", async () => {
      await page.getByRole("button", { name: "Full screen", exact: true }).click();
      // Headless Chromium grants the Fullscreen API: the region is the fullscreen element.
      await expect
        .poll(() => page.evaluate(() => document.fullscreenElement?.dataset.testid ?? null))
        .toBe("terminal-region");
      const box = await page.getByTestId("terminal-region").boundingBox();
      const viewport = page.viewportSize();
      expect(box.width).toBeGreaterThanOrEqual(viewport.width - 1);
      expect(box.height).toBeGreaterThanOrEqual(viewport.height - 1);
    });
    await proof("fullscreen");
    await step("harness: leave browser full screen (stands in for holding Esc)", async () => {
      // Under the Fullscreen API only the region renders, so the header's
      // "Exit full screen" is gone; a user leaves with the browser's Esc, which
      // headless Chromium does not implement. The page must follow the change.
      await page.evaluate(() => document.exitFullscreen());
      await expect(page.getByRole("button", { name: "Full screen", exact: true })).toBeVisible();
      await expect(page.getByTestId("terminal-region")).not.toHaveClass(/fixed/);
    });

    await step("a busy tab shows its process and closing it asks first", async () => {
      await page.getByTestId(`terminal-view-${second}`).click();
      await page.keyboard.type("sleep 600", { delay: 15 });
      await page.keyboard.press("Enter");
      // The strip polls every 5 s and shows the foreground process as a suffix.
      await expect(tab(second).getByText("sleep")).toBeVisible({ timeout: 20_000 });
      await page
        .getByRole("button", { name: `Close tab ${second.replace(/^ta-term-/, "")}` })
        .click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog.getByText("sleep is running in this tab")).toBeVisible({
        timeout: 15_000,
      });
    });
    await proof("busy-close-confirm");
    await step("Force close kills the busy tab on the VM", async () => {
      await page.getByRole("alertdialog").getByRole("button", { name: "Force close" }).click();
      await expect(tab(second)).toHaveCount(0, { timeout: 15_000 });
      await expect.poll(tmuxSessions, { timeout: 10_000 }).not.toContain(second);
    });

    await step("a plain shell closes at once, no confirmation", async () => {
      await page
        .getByRole("button", { name: `Close tab ${first.replace(/^ta-term-/, "")}` })
        .click();
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      await expect(tab(first)).toHaveCount(0, { timeout: 15_000 });
      await expect.poll(tmuxSessions, { timeout: 10_000 }).not.toContain(first);
      expect(await listed()).not.toContain(first);
    });
    await proof("closed");

    // Regression check for #170: without the Fullscreen API (iPhone Safari never
    // fullscreens a div) full screen is CSS only and the region covers the page
    // header, so the exit control must live inside the region.
    await step("CSS-only full screen (no Fullscreen API) can be left again", async () => {
      const phone = await context.newPage();
      await phone.addInitScript(() => {
        delete Element.prototype.requestFullscreen;
      });
      await phone.goto("/terminal", LOADED);
      const before = await listed();
      const empty = phone.getByRole("button", { name: "Open your first tab" });
      await expect(empty.or(phone.getByRole("tablist"))).toBeVisible({ timeout: 30_000 });
      if (await empty.isVisible()) await empty.click();
      else await phone.getByRole("tablist").getByRole("button", { name: "New tab" }).click();
      await adopt(before);
      await expect(phone.getByRole("tablist", { name: "Terminal tabs" })).toBeVisible({
        timeout: 20_000,
      });
      await phone.getByRole("button", { name: "Full screen", exact: true }).click();
      await expect(phone.getByTestId("terminal-region")).toHaveClass(/fixed/);
      await phone.screenshot({
        path: `${process.env.TA_VERIFY_EVIDENCE}/terminal/css-fullscreen.png`,
      });
      // The only exit control must be clickable (not covered by the region).
      await phone.getByRole("button", { name: "Exit full screen" }).click({ timeout: 5_000 });
      await expect(phone.getByTestId("terminal-region")).not.toHaveClass(/fixed/);
      await phone.close();
    });
  },
  { requires: ["sandbox"] },
);
