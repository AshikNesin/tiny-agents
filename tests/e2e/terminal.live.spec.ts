import { test, expect, type Page, type WebSocket } from "@playwright/test";
import { login } from "./helpers/login";

test.skip(!process.env.SANDBOX_HOST, "needs sandbox VM over tailnet");

const text = (payload: string | Buffer): string =>
  typeof payload === "string" ? payload : payload.toString("utf8");

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

function terminalSocket(page: Page): Promise<WebSocket> {
  return page.waitForEvent("websocket", {
    predicate: (ws) => ws.url().includes("/api/v1/terminal/ws/"),
  });
}

function maxColsSent(sent: string[]): number {
  let max = 0;
  for (const frame of sent) {
    try {
      const parsed = JSON.parse(frame) as { t?: string; cols?: number };
      if (parsed.t === "resize" && typeof parsed.cols === "number")
        max = Math.max(max, parsed.cols);
    } catch {}
  }
  return max;
}

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

    await expect
      .poll(() => frames.received.some((frame) => /[$#%]/.test(frame)), { timeout: 30_000 })
      .toBeTruthy();

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

    await page.getByTestId("terminal-key-arrow-up").click();
    await expect
      .poll(() => frames.sent.some((f) => f.charCodeAt(0) === 0x1b && f.endsWith("[A")), {
        timeout: 10_000,
      })
      .toBeTruthy();
  });

  test("widening the viewport sends a bigger resize frame", async ({ page }) => {
    const frames = captureFrames(page);

    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto("/terminal");
    await page.getByTestId("terminal-create").click();
    await terminalSocket(page);
    await expect.poll(() => maxColsSent(frames.sent), { timeout: 15_000 }).toBeGreaterThan(0);

    const before = maxColsSent(frames.sent);
    await page.setViewportSize({ width: 1400, height: 900 });
    await expect.poll(() => maxColsSent(frames.sent), { timeout: 15_000 }).toBeGreaterThan(before);
  });
});
