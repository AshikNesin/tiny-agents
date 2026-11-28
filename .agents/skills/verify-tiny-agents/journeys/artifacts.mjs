// Feature: artifacts (features/artifacts.md). "/artifact html" makes the faux
// bot call create_artifact: the card, the panel opening on it, the page
// running in the sandboxed frame with no cookie or storage, then a markdown
// artifact rewritten to v2 and v1 restored as v3.
import { journey, expect } from "../scripts/lib.mjs";

await journey("artifacts", async ({ page, step, proof, cleanup, api, stamp }) => {
  const name = `Artifact Bot ${stamp}`;
  const composer = page.getByRole("textbox", { name: `Message ${name}` });
  const panel = page.getByTestId("artifact-panel");
  let botId;

  const send = async (text) => {
    await composer.fill(text);
    await composer.press("Enter");
    await expect(page.getByText(text, { exact: true }).last()).toBeVisible();
    await expect(page.getByRole("button", { name: "Stop generating" })).toHaveCount(0, {
      timeout: 120_000,
    });
  };

  await step("setup: create a faux bot", async () => {
    const bot = await api.post("/bots", { name, modelId: "test-model", systemPrompt: "" });
    botId = bot.id;
    cleanup(() => api.delete(`/bots/${botId}`));
    await page.goto(`/chats/${botId}`);
    await expect(composer).toBeVisible({ timeout: 15_000 });
  });

  await step("/artifact html shows a card and opens the panel on it", async () => {
    await send("/artifact html");
    await expect(page.getByTestId("artifact-card")).toContainText("Counter page", {
      timeout: 120_000,
    });
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(panel).toContainText("Counter page");
  });

  await step("the page runs in the frame, cut off from cookies and storage", async () => {
    const frame = page.frameLocator('[data-testid="artifact-frame"]');
    await expect(frame.getByRole("heading", { name: "Counter" })).toBeVisible({ timeout: 15_000 });
    await frame.getByRole("button", { name: "Add" }).click();
    await frame.getByRole("button", { name: "Add" }).click();
    await expect(frame.locator("#n")).toHaveText("2");
    await expect(frame.locator("#probe")).toContainText("blocked: SecurityError");
    await expect(page.getByTestId("artifact-frame")).toHaveAttribute("sandbox", "allow-scripts");
    await proof("html-artifact-in-frame");
  });

  await step("Source shows the HTML as text", async () => {
    await panel.getByRole("tab", { name: "Source" }).click();
    await expect(page.getByTestId("artifact-source")).toContainText("<button onclick=");
    await panel.getByRole("tab", { name: "Preview" }).click();
  });

  await step("a markdown artifact rewritten to v2 follows in the panel", async () => {
    await send("/artifact markdown");
    await expect(page.getByTestId("artifact-card")).toHaveCount(2, { timeout: 120_000 });
    await expect(panel).toContainText("Trip plan", { timeout: 15_000 });
    await expect(panel.getByText("Fly")).toBeVisible();
    await send("/artifact markdown v1");
    await expect(panel.getByText("Take the train")).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId("artifact-card")).toHaveCount(3);
    await proof("markdown-v2");
  });

  await step("restore v1 as v3", async () => {
    await panel.getByRole("combobox", { name: "Version" }).click();
    await page.getByRole("option", { name: /^v1/ }).click();
    await expect(panel.getByText("Viewing version 1 of 2.")).toBeVisible();
    await panel.getByRole("button", { name: "Restore as latest" }).click();
    await expect(panel.getByText(/Viewing version/)).toHaveCount(0, { timeout: 15_000 });
    await expect(panel.getByText("Fly")).toBeVisible();
    await proof("markdown-restored");
  });

  await step("after a reload, the history keeps v3 as restored by you", async () => {
    await page.reload();
    await expect(composer).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("artifact-card").last().getByRole("button", { name: "Open" }).click();
    await panel.getByRole("combobox", { name: "Version" }).click();
    await expect(page.getByRole("option", { name: "v3 · restored by you" })).toBeVisible();
    await expect(page.getByRole("option", { name: "v2 · rewritten" })).toBeVisible();
    await proof("markdown-history");
  });
});
