import { test, expect, type Page, type WebSocket } from "@playwright/test";
import { login } from "./helpers/login";

/**
 * Live terminal e2e (issue #28), the full stack against a real sandbox VM
 * over the tailnet: UI -> REST -> tmux -> ssh2 pty -> WS bridge -> xterm.
 * Skipped where no VM is reachable (CI has no tailnet); the deterministic
 * page states are terminal.spec.ts.
 *
 * Assertions read WS frames (page.on("websocket") -> framereceived /
 * framesent), never canvas pixels: xterm renders on WebGL, which no DOM
 * query can see into.
 *
 * One run at a time: tabs live on the VM, and the cleanup here force-kills
 * every ta-term-* session, so a concurrent run loses its terminals mid-test.
 */

test.skip(!process.env.SANDBOX_HOST, "needs sandbox VM over tailnet");

/** Decode a pty frame; control frames arrive as strings already. */
const text = (payload: string | Buffer): string =>
  typeof payload === "string" ? payload : payload.toString("utf8");

/** Everything the page's terminal sockets said, newest last. */
function captureFrames(page: Page): { received: string[]; sent: string[] } {
  const received: string[] = [];
  const sent: string[] = [];
  page.on("websocket", (ws) => {
    if (!ws.url().includes("/api/v1/terminal/ws/")) return;
    ws.on("framereceived", (frame) => received.push(text(frame.payload)));
    ws.on("framesent", (frame) => sent.push(text(frame.payload)));
  });
  return { received, sent };
}

/** The page opened a ws to the terminal bridge (frames prove it opened). */
function terminalSocket(page: Page): Promise<WebSocket> {
  return page.waitForEvent("websocket", {
    predicate: (ws) => ws.url().includes("/api/v1/terminal/ws/"),
  });
}

/** Largest cols the page has sent in a resize frame so far. */
function maxColsSent(sent: string[]): number {
  let max = 0;
  for (const frame of sent) {
    try {
      const parsed = JSON.parse(frame) as { t?: string; cols?: number };
      if (parsed.t === "resize" && typeof parsed.cols === "number")
        max = Math.max(max, parsed.cols);
    } catch {
      // Binary pty frames are not JSON; they carry no resize anyway.
    }
  }
  return max;
}

/** Force-kill every ta-term-* tab on the VM (they survive the browser). */
async function cleanupTabs(page: Page): Promise<void> {
  const list = await page.request.get("/api/v1/terminal/sessions");
  const body = (await list.json()) as { data?: { sessions?: { name: string }[] } };
  for (const tab of body.data?.sessions ?? []) {
    await page.request.delete(`/api/v1/terminal/sessions/${tab.name}?force=1`);
  }
}

test.describe("Terminal live (sandbox VM)", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await login(page);
    await cleanupTabs(page);
  });

  test.afterEach(async ({ page }) => {
    await cleanupTabs(page);
  });

  test("a new tab reaches a shell prompt and echoes a command back", async ({ page }) => {
    const frames = captureFrames(page);

    await page.goto("/terminal");
    await page.getByTestId("terminal-create").click();
    await terminalSocket(page);

    // The attach redraws the pane, prompt included, within the dial budget.
    await expect
      .poll(() => frames.received.some((frame) => /[$#%]/.test(frame)), { timeout: 30_000 })
      .toBeTruthy();

    // A real keystroke round trip. "New tab" focuses its button, not the
    // terminal; clicking the view is what puts the caret in xterm.
    await page.locator('[data-testid^="terminal-view-"]').click();
    await page.keyboard.type("whoami", { delay: 25 });
    await page.keyboard.press("Enter");
    await expect
      .poll(() => frames.received.some((frame) => frame.includes("exedev")), { timeout: 30_000 })
      .toBeTruthy();
  });

  test("a keys-panel press reaches the pty as its bytes", async ({ page }) => {
    const frames = captureFrames(page);

    await page.goto("/terminal");
    await page.getByTestId("terminal-create").click();
    await terminalSocket(page);
    await expect
      .poll(() => frames.received.some((frame) => /[$#%]/.test(frame)), { timeout: 30_000 })
      .toBeTruthy();

    // The desktop viewport opens the panel by default; assert the sent bytes,
    // not the shell's reaction to arrow-up (history state is not ours to know).
    await page.getByTestId("terminal-key-arrow-up").click();
    await expect
      .poll(
        // captureFrames decodes binary payloads to utf8 strings: the frame is
        // ESC [ A.
        () => frames.sent.some((f) => f.charCodeAt(0) === 0x1b && f.endsWith("[A")),
        { timeout: 10_000 },
      )
      .toBeTruthy();
  });

  test("widening the viewport sends a bigger resize frame", async ({ page }) => {
    const frames = captureFrames(page);

    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto("/terminal");
    await page.getByTestId("terminal-create").click();
    await terminalSocket(page);
    // The view re-sends its grid once the socket is live; that is the
    // baseline the widened viewport must beat.
    await expect.poll(() => maxColsSent(frames.sent), { timeout: 15_000 }).toBeGreaterThan(0);

    const before = maxColsSent(frames.sent);
    await page.setViewportSize({ width: 1400, height: 900 });
    await expect.poll(() => maxColsSent(frames.sent), { timeout: 15_000 }).toBeGreaterThan(before);
  });
});
