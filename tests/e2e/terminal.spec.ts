import { test, expect, type Page, type Route } from "@playwright/test";
import { login } from "./helpers/login";

interface SessionWire {
  name: string;
  process: string | null;
  attached: boolean;
  createdAt: string;
}

const session = (name: string, process: string | null = null): SessionWire => ({
  name,
  process,
  attached: false,
  createdAt: "2026-10-21T00:00:00.000Z",
});

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function stubTickets(page: Page): Promise<void> {
  await page.route("**/api/v1/terminal/sessions/*/ticket", (route) =>
    json(route, 404, { success: false, error: { message: "stubbed: no ws bridge" } }),
  );
}

test.describe("Terminal auth + navigation", () => {
  test("/terminal redirects to /login when signed out", async ({ page }) => {
    await page.goto("/terminal");
    await expect(page).toHaveURL(/\/login/);
  });

  test("the sidebar lists Terminal and the ⌘K palette navigates to it", async ({ page }) => {
    await page.route("**/api/v1/terminal/sessions", (route) =>
      json(route, 200, { success: true, data: { status: { kind: "ready" }, sessions: [] } }),
    );
    await login(page);

    await expect(
      page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Terminal" }),
    ).toBeVisible();

    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole("dialog");
    await expect(palette).toBeVisible();
    await palette.getByRole("option", { name: "Terminal", exact: true }).click();
    await expect(page).toHaveURL(/\/terminal$/);
    await expect(page.getByRole("button", { name: "Open your first tab" })).toBeVisible({
      timeout: 15_000,
    });
  });
});

test.describe("Terminal page states", () => {
  test("a failed load shows the error state and Retry recovers", async ({ page }) => {
    let failing = true;
    await page.route("**/api/v1/terminal/sessions", (route) => {
      if (failing) {
        return json(route, 503, {
          success: false,
          error: { message: "Cannot reach the sandbox (ETIMEDOUT)." },
        });
      }
      return json(route, 200, { success: true, data: { status: { kind: "ready" }, sessions: [] } });
    });
    await login(page);
    await page.goto("/terminal");

    await expect(page.getByText("Couldn't load the terminal")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Cannot reach the sandbox (ETIMEDOUT).")).toBeVisible();

    failing = false;
    await page.getByTestId("terminal-retry").click();
    await expect(page.getByRole("button", { name: "Open your first tab" })).toBeVisible({
      timeout: 15_000,
    });
  });

  test("the empty state CTA opens the first tab", async ({ page }) => {
    await stubTickets(page);
    let sessions: SessionWire[] = [];
    await page.route("**/api/v1/terminal/sessions", (route) => {
      if (route.request().method() === "POST") {
        sessions = [session("ta-term-1")];
        return json(route, 201, { success: true, data: sessions[0] });
      }
      return json(route, 200, { success: true, data: { status: { kind: "ready" }, sessions } });
    });
    await login(page);
    await page.goto("/terminal");

    await page.getByRole("button", { name: "Open your first tab" }).click();
    await expect(page.getByTestId("terminal-tab-ta-term-1")).toBeVisible({ timeout: 15_000 });
  });

  test("tmux missing on the VM shows the install command", async ({ page }) => {
    await page.route("**/api/v1/terminal/sessions", (route) =>
      json(route, 200, {
        success: true,
        data: {
          status: { kind: "tmux-missing", installCommand: "sudo apt-get install -y tmux" },
          sessions: [],
        },
      }),
    );
    await login(page);
    await page.goto("/terminal");

    await expect(page.getByText("tmux is not installed on the sandbox")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("sudo apt-get install -y tmux")).toBeVisible();
  });

  test("tabs render with the foreground process as a suffix", async ({ page }) => {
    await stubTickets(page);
    const sessions = [session("ta-term-1"), session("ta-term-2", "vim")];
    await page.route("**/api/v1/terminal/sessions", (route) =>
      json(route, 200, { success: true, data: { status: { kind: "ready" }, sessions } }),
    );
    await login(page);
    await page.goto("/terminal");

    const tabs = page.getByRole("tablist", { name: "Terminal tabs" });
    await expect(tabs.getByTestId("terminal-tab-ta-term-1")).toBeVisible({ timeout: 15_000 });
    await expect(tabs.getByTestId("terminal-tab-ta-term-1")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const tab2 = tabs.getByTestId("terminal-tab-ta-term-2");
    await expect(tab2).toBeVisible();
    await expect(tab2).toHaveAttribute("aria-selected", "false");
    await expect(tab2.getByText("vim")).toBeVisible();
  });

  test("the keys panel overlays the terminal on a phone and the toggle hides it", async ({
    page,
  }) => {
    await stubTickets(page);
    const sessions = [session("ta-term-1")];
    await page.route("**/api/v1/terminal/sessions", (route) =>
      json(route, 200, { success: true, data: { status: { kind: "ready" }, sessions } }),
    );
    await login(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/terminal");

    const panel = page.getByTestId("terminal-keys-panel");
    await expect(page.getByTestId("terminal-key-esc")).not.toBeVisible();

    await page.getByTestId("terminal-keys-toggle").click();
    await expect(page.getByTestId("terminal-key-esc")).toBeVisible();

    const rowBox = await page.locator('[data-testid^="terminal-view-"]').boundingBox();
    const panelBox = await panel.boundingBox();
    expect(rowBox).not.toBeNull();
    expect(panelBox).not.toBeNull();
    expect(panelBox!.y).toBeGreaterThanOrEqual(rowBox!.y);
    expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(rowBox!.y + rowBox!.height + 1);
    await expect(panel).toHaveCSS("position", "absolute");

    await page.getByTestId("terminal-keys-collapse").click();
    await expect(page.getByTestId("terminal-key-esc")).not.toBeVisible();
    expect(
      await page.evaluate(() => window.localStorage.getItem("tiny-agents:terminal-keys")),
    ).toBe("0");
  });

  test("closing a busy tab confirms the process, then force-deletes", async ({ page }) => {
    await stubTickets(page);
    let sessions = [session("ta-term-1"), session("ta-term-2", "sleep")];
    const deletes: string[] = [];
    await page.route("**/api/v1/terminal/sessions", (route) =>
      json(route, 200, { success: true, data: { status: { kind: "ready" }, sessions } }),
    );
    await page.route("**/api/v1/terminal/sessions/*", async (route) => {
      const url = new URL(route.request().url());
      const name = url.pathname.split("/").pop()!;
      const forced = url.searchParams.get("force") === "1";
      if (!forced && sessions.some((s) => s.name === name && s.process)) {
        return json(route, 409, {
          success: false,
          error: { message: "sleep is running", details: { process: "sleep" } },
        });
      }
      deletes.push(`${name}${url.search}`);
      sessions = sessions.filter((s) => s.name !== name);
      return json(route, 200, { success: true, data: { deleted: true } });
    });
    await login(page);
    await page.goto("/terminal");

    await page.getByTestId("terminal-close-ta-term-2").click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByText("sleep is running in this tab")).toBeVisible();

    await dialog.getByRole("button", { name: "Force close" }).click();
    await expect(page.getByTestId("terminal-tab-ta-term-2")).not.toBeVisible();
    expect(deletes.some((d) => d.startsWith("ta-term-2?"))).toBeTruthy();
    expect(deletes.some((d) => d.startsWith("ta-term-2?force=1"))).toBeTruthy();
  });
});
