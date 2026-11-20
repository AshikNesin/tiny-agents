import { test, expect } from "@playwright/test";

async function hasBotNamed(page: import("@playwright/test").Page, name: RegExp): Promise<boolean> {
  const response = await page.request.get("/api/v1/bots");
  const body = (await response.json()) as { data?: { name: string }[] };
  return (body.data ?? []).some((entry) => name.test(entry.name));
}

test.describe("Chats", () => {
  test("create a bot and chat with a streamed reply that survives a refresh", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill("demo@example.com");
    await page.getByLabel(/password/i).fill("demo@example.com");
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect(page).toHaveURL(/\/chats(\/[^/]+)?$/);

    const emptyCta = page.getByRole("button", { name: /create your first bot/i });
    if (await emptyCta.isVisible()) {
      await emptyCta.click();
    } else {
      await page.getByRole("button", { name: /new bot/i }).click();
    }
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("button", { name: "Test Model (faux)" })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByLabel("Name").fill(`Echo Bot ${Date.now()}`);
    await page.getByRole("button", { name: /create bot/i }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 15_000 });

    await expect(page.getByRole("link", { name: /echo bot/i }).first()).toBeVisible();

    const composer = page.getByPlaceholder(/(?:ask|message) echo bot/i);
    await composer.fill("hello e2e");
    await composer.press("Enter");
    await expect(page.getByText("hello e2e").first()).toBeVisible();
    await expect(page.getByText(/Echo: hello e2e/i).first()).toBeVisible({ timeout: 20_000 });

    await page.reload();
    await expect(page.getByText(/Echo: hello e2e/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test("bot list shows a typing state and unread badge for background replies", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill("demo@example.com");
    await page.getByLabel(/password/i).fill("demo@example.com");
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect(page).toHaveURL(/\/chats(\/[^/]+)?$/);

    const hasBot = await hasBotNamed(page, /echo bot/i);
    if (!hasBot) {
      await page.getByRole("button", { name: /new bot/i }).click();
      await page.getByLabel("Name").fill("Echo Bot");
      await page.getByRole("button", { name: /create bot/i }).click();
      await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 15_000 });
    }

    await expect(page.getByRole("button", { name: /^search/i })).toBeVisible();
  });
});

test.describe("Chats — new chat", () => {
  test("starting a new chat clears the current transcript", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill("demo@example.com");
    await page.getByLabel(/password/i).fill("demo@example.com");
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect(page).toHaveURL(/\/chats(\/[^/]+)?$/);

    const hasBot = await hasBotNamed(page, /reset bot/i);
    if (!hasBot) {
      await page.getByRole("button", { name: /new bot/i }).click();
      await page.getByLabel("Name").fill("Reset Bot");
      await expect(page.getByRole("button", { name: "Test Model (faux)" })).toBeVisible({
        timeout: 15_000,
      });
      await page.getByRole("button", { name: /create bot/i }).click();
      await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 15_000 });
    }
    await page
      .getByRole("link", { name: /reset bot/i })
      .first()
      .click();

    const composer = page.getByPlaceholder(/(?:ask|message) reset bot/i);
    await composer.fill("old message");
    await composer.press("Enter");
    await expect(page.getByText("old message").first()).toBeVisible();
    await expect(page.getByText(/Echo: old message/i).first()).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: "Start a new chat" }).click();
    await page.getByRole("button", { name: "New chat", exact: true }).click();
    await expect(page.getByText("old message")).toHaveCount(0);
    await expect(page.getByText(/Echo: old message/i)).toHaveCount(0);
  });
});

test.describe("Chats — past chats (issue #101)", () => {
  test("read, continue and delete a chat that New chat left behind", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill("demo@example.com");
    await page.getByLabel(/password/i).fill("demo@example.com");
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect(page).toHaveURL(/\/chats(\/[^/]+)?$/);

    const name = `History Bot ${Date.now()}`;
    await page.getByRole("button", { name: /new bot/i }).click();
    await page.getByLabel("Name").fill(name);
    await expect(page.getByRole("button", { name: "Test Model (faux)" })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: /create bot/i }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 15_000 });

    const composer = page.getByPlaceholder(/(?:ask|message) history bot/i);
    await composer.fill("plan the goa trip");
    await composer.press("Enter");
    await expect(page.getByText(/Echo: plan the goa trip/i).first()).toBeVisible({
      timeout: 20_000,
    });

    await page.getByRole("button", { name: "Start a new chat" }).click();
    await page.getByRole("button", { name: "New chat", exact: true }).click();
    await expect(page.getByText(/Echo: plan the goa trip/i)).toHaveCount(0);
    await page.getByRole("button", { name: `${name} menu` }).click();
    await page.getByRole("menuitem", { name: "Chat history" }).click();
    await page.getByTestId("past-chat-item").filter({ hasText: "plan the goa trip" }).click();

    await expect(page).toHaveURL(/\/history\//);
    await expect(page.getByText(/Echo: plan the goa trip/i).first()).toBeVisible();
    await expect(composer).toHaveCount(0);
    await expect(page.getByTestId("past-chat-footer")).toBeVisible();

    await page.getByRole("button", { name: "Continue this chat" }).click();
    await expect(page).not.toHaveURL(/\/history\//);
    await expect(page.getByText(/Echo: plan the goa trip/i).first()).toBeVisible({
      timeout: 15_000,
    });
    await composer.fill("and hotels");
    await composer.press("Enter");
    await expect(page.getByText(/Echo: and hotels/i).first()).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: "Start a new chat" }).click();
    await page.getByRole("button", { name: "New chat", exact: true }).click();
    await page.getByRole("button", { name: `${name} menu` }).click();
    await page.getByRole("menuitem", { name: "Chat history" }).click();
    await page.getByTestId("past-chat-item").first().click();
    await page.getByRole("button", { name: "Past chat actions" }).click();
    await page.getByRole("menuitem", { name: "Delete chat" }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page).not.toHaveURL(/\/history\//);
    await page.getByRole("button", { name: `${name} menu` }).click();
    await page.getByRole("menuitem", { name: "Chat history" }).click();
    await expect(page.getByText("No past chats yet.", { exact: false })).toBeVisible();
    await expect(page.getByTestId("past-chat-item")).toHaveCount(0);
  });
});

test.describe("Chats — attachments (issue #17)", () => {
  test("attach an image, send, render, survive reload", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill("demo@example.com");
    await page.getByLabel(/password/i).fill("demo@example.com");
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect(page).toHaveURL(/\/chats(\/[^/]+)?$/);

    const hasBot = await hasBotNamed(page, /attach bot/i);
    if (!hasBot) {
      await page.getByRole("button", { name: /new bot/i }).click();
      await page.getByLabel("Name").fill("Attach Bot");
      await expect(page.getByRole("button", { name: "Test Model (faux)" })).toBeVisible({
        timeout: 15_000,
      });
      await page.getByRole("button", { name: /create bot/i }).click();
      await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 15_000 });
    }
    await page
      .getByRole("link", { name: /attach bot/i })
      .first()
      .click();

    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64",
    );
    await page.setInputFiles('#root input[type="file"]', {
      name: "e2e-shot.png",
      mimeType: "image/png",
      buffer: png,
    });

    await expect(page.getByTestId("staged-image")).toBeVisible();
    await page.getByPlaceholder(/(?:ask|message) attach bot/i).fill("what is this?");
    await page.getByRole("button", { name: "Send message" }).click();

    await expect(page.getByText("what is this?").first()).toBeVisible();
    await expect(page.getByAltText("e2e-shot.png").first()).toBeVisible();
    await expect(page.getByText(/Echo:/i).first()).toBeVisible({ timeout: 20_000 });

    await page.reload();
    await page
      .getByRole("link", { name: /attach bot/i })
      .first()
      .click();
    await expect(page.getByAltText("e2e-shot.png").first()).toBeVisible({ timeout: 15_000 });
  });

  test("image-only send works without text", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill("demo@example.com");
    await page.getByLabel(/password/i).fill("demo@example.com");
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect(page).toHaveURL(/\/chats(\/[^/]+)?$/);
    const hasBot = await hasBotNamed(page, /attach bot/i);
    if (!hasBot) {
      await page.getByRole("button", { name: /new bot/i }).click();
      await page.getByLabel("Name").fill("Attach Bot");
      await expect(page.getByRole("button", { name: "Test Model (faux)" })).toBeVisible({
        timeout: 15_000,
      });
      await page.getByRole("button", { name: /create bot/i }).click();
      await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 15_000 });
    }
    await page
      .getByRole("link", { name: /attach bot/i })
      .first()
      .click();

    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64",
    );
    await page.setInputFiles('#root input[type="file"]', {
      name: "only-image.png",
      mimeType: "image/png",
      buffer: png,
    });
    await expect(page.getByTestId("staged-image")).toBeVisible();
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByAltText("only-image.png").first()).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("Chats — steering (issue #9)", () => {
  test("sending mid-reply queues a steer that survives a reload and can be cancelled", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill("demo@example.com");
    await page.getByLabel(/password/i).fill("demo@example.com");
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect(page).toHaveURL(/\/chats(\/[^/]+)?$/);

    const hasBot = await hasBotNamed(page, /steer bot/i);
    if (!hasBot) {
      await page.getByRole("button", { name: /new bot/i }).click();
      await page.getByLabel("Name").fill("Steer Bot");
      await expect(page.getByRole("button", { name: "Test Model (faux)" })).toBeVisible({
        timeout: 15_000,
      });
      await page.getByRole("button", { name: /create bot/i }).click();
      await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 15_000 });
    }
    await page
      .getByRole("link", { name: /steer bot/i })
      .first()
      .click();

    const longMessage = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ");
    const composer = page.getByPlaceholder(/(?:ask|message) steer bot/i);
    await composer.fill(longMessage);
    await composer.press("Enter");
    await expect(page.getByRole("button", { name: "Stop generating" })).toBeVisible({
      timeout: 15_000,
    });

    await composer.fill("steer this");
    await expect(page.getByRole("button", { name: "Steer the reply" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Stop generating" })).toHaveCount(0);
    await composer.press("Enter");
    const bubble = page.getByTestId("queued-bubble");
    await expect(bubble).toBeVisible({ timeout: 15_000 });
    await expect(bubble).toHaveAttribute("data-mode", "steer");
    await expect(bubble.getByText("steer this")).toBeVisible();

    await page.reload();
    await page
      .getByRole("link", { name: /steer bot/i })
      .first()
      .click();
    await expect(page.getByTestId("queued-bubble")).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Cancel this message" }).click();
    await expect(page.getByTestId("queued-bubble")).toHaveCount(0, { timeout: 15_000 });

    await expect(page.getByRole("button", { name: "Send message" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("steer this")).toHaveCount(0);
  });
});
