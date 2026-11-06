// Feature: bot-settings (features/bot-settings.md). Edit a bot's profile (name,
// description, system prompt) from the chat header, the taken-name error, the
// sidebar row's actions menu (Pin/Unpin, Edit bot), and deleting the bot.
import { journey, expect } from "../scripts/lib.mjs";

await journey("bot-settings", async ({ page, step, proof, cleanup, api, stamp }) => {
  const original = `Settings Bot ${stamp}`;
  const renamed = `Renamed Bot ${stamp}`;
  const other = `Other Bot ${stamp}`;
  const description = `Plans trips ${stamp}`;
  const prompt = `You are a terse travel agent (${stamp}).`;
  const bots = page.getByRole("region", { name: "Bots" });
  const rowOf = (name) => bots.locator("li").filter({ hasText: name });
  const read = async (id) => (await api.get("/bots")).find((b) => b.id === id);
  let botId;

  const openRowMenu = async (name) => {
    await rowOf(name).hover();
    await page.getByRole("button", { name: `${name} actions` }).click();
  };

  await step("setup: two bots via the API (one only to take a name)", async () => {
    const { defaultModel } = await api.get("/models");
    botId = (await api.post("/bots", { name: original, modelId: defaultModel })).id;
    cleanup(async () => {
      if (await read(botId)) await api.delete(`/bots/${botId}`);
    });
    const otherId = (await api.post("/bots", { name: other, modelId: defaultModel })).id;
    cleanup(async () => {
      await api.delete(`/bots/${otherId}`);
      expect(await read(otherId)).toBeUndefined();
    });
    await page.goto(`/chats/${botId}`);
    await expect(page.getByPlaceholder(`Message ${original}`)).toBeVisible({ timeout: 15_000 });
  });

  await step("the chat header's name opens Edit <bot> on the Profile tab", async () => {
    await page.getByRole("button", { name: `Edit ${original}` }).click();
    const dialog = page.getByRole("dialog", { name: `Edit ${original}` });
    await expect(dialog).toBeVisible();
    for (const tab of ["Profile", "Tools", "Skills", "Sharing"])
      await expect(dialog.getByRole("tab", { name: tab })).toBeVisible();
    await expect(dialog.getByRole("tab", { name: "Profile" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(dialog.getByLabel("Name")).toHaveValue(original);
  });
  await proof("edit-open");

  await step("a taken name is refused under the Name field", async () => {
    const dialog = page.getByRole("dialog", { name: `Edit ${original}` });
    await dialog.getByLabel("Name").fill(other);
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog.getByLabel("Name")).toHaveAttribute("aria-invalid", "true");
    await expect(dialog.getByText(`A bot named "${other}" already exists`)).toBeVisible();
    await proof("name-taken");
    expect((await read(botId))?.name).toBe(original);
  });

  await step("save name, description and system prompt", async () => {
    const dialog = page.getByRole("dialog", { name: `Edit ${original}` });
    await dialog.getByLabel("Name").fill(renamed);
    await expect(dialog.getByLabel("Name")).toHaveAttribute("aria-invalid", "false");
    await dialog.getByLabel("Description").fill(description);
    await dialog.getByLabel("System prompt").fill(prompt);
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Bot updated")).toBeVisible();
    await expect(dialog).toHaveCount(0);
    // Header, composer and sidebar follow the new name; the description shows in the header.
    await expect(page.getByRole("button", { name: `Edit ${renamed}` })).toBeVisible();
    await expect(page.getByPlaceholder(`Message ${renamed}`)).toBeVisible();
    await expect(rowOf(renamed)).toBeVisible();
    // The description shows under the header name and in the empty chat's greeting.
    await expect(page.getByText(description)).toHaveCount(2);
    const full = await api.get(`/bots/${botId}`);
    expect(full).toMatchObject({ name: renamed, description, systemPrompt: prompt });
  });
  await proof("saved");

  await step("reload: the dialog reopens with the saved values", async () => {
    await page.reload();
    await page.getByRole("button", { name: `Edit ${renamed}` }).click({ timeout: 15_000 });
    const dialog = page.getByRole("dialog", { name: `Edit ${renamed}` });
    await expect(dialog.getByLabel("Name")).toHaveValue(renamed);
    await expect(dialog.getByLabel("Description")).toHaveValue(description);
    await expect(dialog.getByLabel("System prompt")).toHaveValue(prompt);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
  });

  await step("row menu: Pin moves the bot under Pinned, Unpin moves it back", async () => {
    await openRowMenu(renamed);
    await page.getByRole("menuitem", { name: "Pin", exact: true }).click();
    await expect(bots.getByText("Pinned", { exact: true })).toBeVisible();
    await expect.poll(async () => (await read(botId))?.pinnedAt).not.toBeNull();
    await proof("pinned");
    await openRowMenu(renamed);
    await page.getByRole("menuitem", { name: "Unpin" }).click();
    await expect(bots.getByText("Pinned", { exact: true })).toHaveCount(0);
    await expect.poll(async () => (await read(botId))?.pinnedAt).toBeNull();
  });

  await step("row menu: Edit bot opens the same dialog", async () => {
    await openRowMenu(renamed);
    await page.getByRole("menuitem", { name: "Edit bot" }).click();
    const dialog = page.getByRole("dialog", { name: `Edit ${renamed}` });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Description")).toHaveValue(description);
  });

  await step("delete: inline confirmation, then the bot is gone", async () => {
    const dialog = page.getByRole("dialog", { name: `Edit ${renamed}` });
    await dialog.getByRole("button", { name: "Delete bot" }).click();
    await expect(dialog.getByText(`Delete ${renamed}? This cannot be undone.`)).toBeVisible();
    await proof("delete-confirm");
    await dialog.getByRole("button", { name: "Delete bot" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(rowOf(renamed)).toHaveCount(0);
    await expect(page).not.toHaveURL(new RegExp(botId));
    expect(await read(botId)).toBeUndefined();
  });
  await proof("deleted");
});
