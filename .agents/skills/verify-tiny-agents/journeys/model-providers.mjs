// Feature: model-providers (features/model-providers.md). What a user sees of providers with
// the faux catalog: the grouped picker in the bot dialog (faux + "uses your Claude plan"
// rows), the composer's model chip switching a bot's model, and a configured provider
// (no warning banner, sending enabled, the faux model answers).
import { journey, expect } from "../scripts/lib.mjs";

await journey("model-providers", async ({ page, step, proof, cleanup, api, stamp }) => {
  const botName = `Model Bot ${stamp}`;
  let botId;
  let catalog;

  await step("catalog API: faux provider configured, faux + Claude-plan models", async () => {
    catalog = await api.get("/models");
    expect(catalog.gatewayConfigured).toBe(true);
    expect(catalog.defaultModel).toBe("test-model");
    expect(catalog.providers).toEqual([expect.objectContaining({ id: "faux", configured: true })]);
    expect(catalog.models.map((m) => m.id)).toContain("test-model");
    expect(catalog.models.some((m) => m.id.startsWith("claude-code/"))).toBe(true);
  });

  await step("New bot dialog: picker groups models by provider", async () => {
    await page.goto("/chats");
    const empty = page.getByRole("button", { name: /create your first bot/i });
    if (await empty.isVisible()) await empty.click();
    else
      await page
        .getByRole("button", { name: /new bot/i })
        .first()
        .click();
    const dialog = page.getByRole("dialog", { name: "New bot" });
    const picker = dialog.getByRole("button", { name: "Test Model (faux)" });
    await expect(picker).toBeVisible({ timeout: 15_000 }); // the default model is preselected
    await picker.click();
    const menu = page.getByRole("menu");
    await expect(menu.getByText("Other · faux")).toBeVisible();
    await expect(menu.getByText("Claude plan · Claude plan")).toBeVisible();
    await expect(
      menu.getByRole("menuitem", { name: /Test Model \(faux\)\s*reasoning/ }),
    ).toBeVisible();
    for (const m of catalog.models.filter((x) => x.id.startsWith("claude-code/")))
      await expect(
        menu.getByRole("menuitem", { name: new RegExp(`${m.name}.*uses your Claude plan`) }),
      ).toBeVisible();
  });
  await proof("picker-groups");

  await step("pick a Claude-plan model in the dialog, then back to faux, and create", async () => {
    const dialog = page.getByRole("dialog", { name: "New bot" });
    const sonnet = catalog.models.find((m) => m.id.startsWith("claude-code/"));
    await page.getByRole("menuitem", { name: new RegExp(sonnet.name) }).click();
    await expect(dialog.getByRole("button", { name: sonnet.name })).toBeVisible();
    await dialog.getByRole("button", { name: sonnet.name }).click();
    await page.getByRole("menuitem", { name: /Test Model \(faux\)/ }).click();
    await dialog.getByLabel("Name").fill(botName);
    await dialog.getByRole("button", { name: /create bot/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 15_000 });
    const bot = (await api.get("/bots")).find((b) => b.name === botName);
    expect(bot?.modelId).toBe("test-model");
    botId = bot.id;
    cleanup(() => api.delete(`/bots/${botId}`));
  });

  await step("composer chip switches the bot's model (saved)", async () => {
    await page.goto(`/chats/${botId}`);
    const chip = page.getByTestId("chat-model");
    await expect(chip).toContainText("Test Model (faux)");
    const target = catalog.models.find((m) => m.id.startsWith("claude-code/"));
    await chip.click();
    await expect(page.getByPlaceholder("Search models…")).toBeVisible();
    await page.getByPlaceholder("Search models…").fill(target.name);
    await page.getByRole("option", { name: new RegExp(target.name) }).click();
    await expect(chip).toContainText(target.name);
    await expect.poll(async () => (await api.get(`/bots/${botId}`)).modelId).toBe(target.id);
    await proof("chip-switched");
    await chip.click();
    await page.getByPlaceholder("Search models…").fill("faux");
    await page.getByRole("option", { name: /Test Model \(faux\)/ }).click();
    await expect(chip).toContainText("Test Model (faux)");
    await expect.poll(async () => (await api.get(`/bots/${botId}`)).modelId).toBe("test-model");
  });

  await step("configured provider: no warning banner, the faux model answers", async () => {
    await expect(page.getByText(/No model provider is configured/)).toHaveCount(0);
    await expect(page.getByText(/is no longer in the model catalog/)).toHaveCount(0);
    const composer = page.getByPlaceholder(new RegExp(`(?:ask|message) ${botName}`, "i"));
    await composer.fill(`model ${stamp}`);
    await composer.press("Enter");
    await expect(page.getByText(`Echo: model ${stamp}`).first()).toBeVisible({ timeout: 30_000 });
  });
  await proof("faux-replied");
});
