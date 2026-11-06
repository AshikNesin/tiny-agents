// Feature: memory (features/memory.md). The /memory page: a bot without
// memories, Add memory, category groups, edit, search, the per-bot "learns
// from chats" switch, delete (tombstone) and re-adding a deleted fact.
import { journey, expect } from "../scripts/lib.mjs";

await journey("memory", async ({ page, step, proof, cleanup, api, stamp }) => {
  const name = `Memory Bot ${stamp}`;
  const fact = `Prefers green tea ${stamp}`;
  const edited = `Prefers oolong tea ${stamp}`;
  const section = page.getByRole("region", { name: `${name} memories` });
  const without = page.getByRole("region", { name: "Bots without memories" });
  const editor = (title) => page.getByRole("dialog", { name: title });
  let botId;

  const memories = (all = false) =>
    api.get(`/bots/${botId}/memories${all ? "?includeArchived=true" : ""}`);
  const find = async (text) => {
    const rows = await memories(true);
    return (Array.isArray(rows) ? rows : (rows?.memories ?? [])).find((m) => m.text === text);
  };
  const pickCategory = async (dialog, label) => {
    await dialog.getByRole("combobox", { name: "Category" }).click();
    await page.getByRole("option", { name: label, exact: true }).click();
  };

  await step("setup: create a faux bot through the API", async () => {
    const bot = await api.post("/bots", { name, modelId: "test-model" });
    botId = bot.id;
    cleanup(async () => {
      await api.delete(`/bots/${botId}`);
      expect((await api.get("/bots")).some((b) => b.id === botId)).toBe(false);
    });
  });

  await step("open Memory from the account menu", async () => {
    await page.goto(`/chats/${botId}`);
    await page.getByRole("button", { name: "Account and navigation" }).click();
    await page.getByRole("menuitem", { name: "Memory" }).click();
    await expect(page).toHaveURL(/\/memory$/);
    await expect(page.getByRole("heading", { name: "Memory", level: 1 })).toBeVisible();
  });
  await step("a new bot is listed under Bots without memories, learning on", async () => {
    await expect(without.getByText(name)).toBeVisible({ timeout: 15_000 });
    await expect(
      without.getByRole("switch", { name: `Turn off memory for ${name}` }),
    ).toHaveAttribute("aria-checked", "true");
  });

  await step("Add memory: text + category Facts", async () => {
    await without.getByRole("button", { name: `Add memory for ${name}` }).click();
    const dialog = editor("Add memory");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(`Saved to ${name}.`)).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Add", exact: true })).toBeDisabled();
    await dialog.getByLabel("Memory").fill(fact);
    await pickCategory(dialog, "Facts");
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText("Memory added")).toBeVisible();
    await expect(section.getByText(fact)).toBeVisible();
    await expect(section.getByText("1 memory")).toBeVisible();
    await expect(section.getByRole("heading", { name: /Facts/ })).toBeVisible();
    await expect(section.getByText("Added manually")).toBeVisible();
    const row = await find(fact);
    expect(row).toMatchObject({ status: "active", category: "fact", source: "manual" });
  });
  await proof("added");

  await step("edit: new text and category Preferences", async () => {
    await section.getByRole("button", { name: `Edit memory "${fact}"` }).click();
    const dialog = editor("Edit memory");
    await expect(dialog.getByLabel("Memory")).toHaveValue(fact);
    await dialog.getByLabel("Memory").fill(edited);
    await pickCategory(dialog, "Preferences");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Memory saved")).toBeVisible();
    await expect(section.getByText(edited)).toBeVisible();
    await expect(section.getByRole("heading", { name: /Preferences/ })).toBeVisible();
    expect(await find(edited)).toMatchObject({ status: "active", category: "preference" });
  });
  await step("second view: reload keeps the edit", async () => {
    await page.reload();
    await expect(section.getByText(edited)).toBeVisible({ timeout: 15_000 });
  });

  await step("search across bots: a hit keeps the section, a miss says so", async () => {
    const search = page.getByRole("searchbox", { name: "Search memories" });
    await search.fill(`oolong tea ${stamp}`);
    await expect(section.getByText(edited)).toBeVisible();
    await search.fill(`nothing-${stamp}`);
    await expect(page.getByText("No matching memories")).toBeVisible();
    await search.fill("");
    await expect(section.getByText(edited)).toBeVisible();
  });
  await proof("searched");

  await step("turn memory off for the bot: note shown, persisted", async () => {
    await section.getByRole("switch", { name: `Turn off memory for ${name}` }).click();
    await expect(
      section.getByRole("switch", { name: `Turn on memory for ${name}` }),
    ).toHaveAttribute("aria-checked", "false");
    await expect(section.getByText(/Off — this bot no longer learns from chats/)).toBeVisible();
    await expect.poll(async () => (await api.get(`/bots/${botId}`)).memoryEnabled).toBe(false);
    await page.reload();
    await expect(
      section.getByRole("switch", { name: `Turn on memory for ${name}` }),
    ).toHaveAttribute("aria-checked", "false", { timeout: 15_000 });
  });
  await proof("off");
  await step("turn it back on", async () => {
    await section.getByRole("switch", { name: `Turn on memory for ${name}` }).click();
    await expect.poll(async () => (await api.get(`/bots/${botId}`)).memoryEnabled).toBe(true);
  });

  await step("delete after confirming: gone from the page, kept as a tombstone", async () => {
    await section.getByRole("button", { name: `Delete memory "${edited}"` }).click();
    const confirm = page.getByRole("alertdialog", { name: "Delete this memory?" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByText("Memory deleted")).toBeVisible();
    await expect(page.getByText(edited)).toHaveCount(0);
    await expect(without.getByText(name)).toBeVisible();
    expect((await find(edited))?.status ?? "deleted").toBe("deleted");
  });
  await proof("deleted");

  await step("re-adding the deleted text by hand brings it back as active", async () => {
    await without.getByRole("button", { name: `Add memory for ${name}` }).click();
    const dialog = editor("Add memory");
    await dialog.getByLabel("Memory").fill(edited);
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText("Memory added")).toBeVisible();
    await expect(section.getByText(edited)).toBeVisible();
    const rows = (await memories(true)).filter?.((m) => m.text === edited) ?? [];
    expect(rows.filter((m) => m.status === "active")).toHaveLength(1);
  });
  await proof("restored");
});
