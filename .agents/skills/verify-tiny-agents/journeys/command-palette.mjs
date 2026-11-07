// Feature: command-palette (features/command-palette.md). The ⌘K / Ctrl+K search
// palette: open from the sidebar or the keyboard, filter, jump to a bot or a page,
// run New bot, the empty state, and every way it closes.
import { journey, expect } from "../scripts/lib.mjs";

await journey("command-palette", async ({ page, step, proof, cleanup, api, stamp }) => {
  const name = `Palette Bot ${stamp}`;
  const palette = page.getByRole("dialog", { name: "Command Menu" });
  const input = palette.getByPlaceholder("Type a command or search...");
  let botId;

  const openWithButton = async () => {
    await page.getByRole("button", { name: /^Search/ }).click();
    await expect(palette).toBeVisible();
    await expect(input).toBeFocused();
  };

  await step("setup: a bot to jump to, via the API", async () => {
    const { defaultModelId: defaultModel } = await api.get("/models");
    botId = (await api.post("/bots", { name, modelId: defaultModel })).id;
    cleanup(async () => {
      await api.delete(`/bots/${botId}`);
      expect((await api.get("/bots")).some((b) => b.id === botId)).toBe(false);
    });
    await page.goto("/tasks");
    await expect(page.getByLabel("New task title")).toBeVisible({ timeout: 15_000 });
  });

  await step("open from the sidebar Search button: groups listed", async () => {
    await openWithButton();
    for (const group of ["Actions", "Bots", "Navigation", "Theme", "Account"])
      await expect(palette.getByRole("group", { name: group }).first()).toBeVisible();
    await expect(palette.getByRole("option", { name })).toBeVisible();
  });
  await proof("open");

  await step("Escape closes it", async () => {
    await page.keyboard.press("Escape");
    await expect(palette).toHaveCount(0);
  });

  await step("Ctrl+K opens it, Ctrl+K again closes it", async () => {
    await page.keyboard.press("Control+k");
    await expect(palette).toBeVisible();
    await page.keyboard.press("Control+k");
    await expect(palette).toHaveCount(0);
  });

  await step("an outside click closes it", async () => {
    await openWithButton();
    // A real pointer click on the overlay, left of the centred dialog.
    await page.mouse.click(8, 400);
    await expect(palette).toHaveCount(0);
  });

  await step("typing filters; nothing matches → No results found.", async () => {
    await openWithButton();
    await input.fill(`zzz-no-such-thing-${stamp}`);
    await expect(palette.getByText("No results found.")).toBeVisible();
    await expect(palette.getByRole("option")).toHaveCount(0);
  });
  await proof("no-results");

  await step("filter to the bot and pick it with Enter: its chat opens", async () => {
    await input.fill(name);
    await expect(palette.getByRole("option", { name })).toBeVisible();
    await expect(palette.getByRole("option", { name })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect(palette).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/chats/${botId}$`));
    await expect(page.getByPlaceholder(`Message ${name}`)).toBeVisible({ timeout: 15_000 });
  });

  await step("navigate to a page: Memory", async () => {
    await page.keyboard.press("Control+k");
    await expect(palette).toBeVisible();
    await input.fill("Memory");
    await palette.getByRole("option", { name: "Memory" }).first().click();
    await expect(palette).toHaveCount(0);
    await expect(page).toHaveURL(/\/memory$/);
  });
  await proof("navigated");

  await step("the highlighted option runs on Enter (Settings)", async () => {
    await openWithButton();
    await input.fill("Settings");
    const option = palette.getByRole("option", { name: "Settings", exact: true }).first();
    await expect(option).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/settings$/);
  });

  await step("Actions → New bot opens the New bot dialog", async () => {
    await openWithButton();
    await input.fill("New bot");
    await palette.getByRole("option", { name: "New bot" }).first().click();
    await expect(palette).toHaveCount(0);
    const dialog = page.getByRole("dialog", { name: "New bot" });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await proof("new-bot");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
  });

  await step("each group and command is listed once, nothing unconfigured", async () => {
    await openWithButton();
    const headings = await palette
      .getByRole("group")
      .evaluateAll((groups) =>
        groups.map(
          (g) =>
            g.getAttribute("aria-labelledby") &&
            document.getElementById(g.getAttribute("aria-labelledby"))?.textContent,
        ),
      );
    const labels = await palette.getByRole("option").allTextContents();
    const dupes = (list) => list.filter((x, i) => list.indexOf(x) !== i);
    await proof("listing");
    await page.keyboard.press("Escape");
    const problems = [
      ...dupes(headings).map((h) => `group listed twice: ${h}`),
      ...dupes(labels.map((l) => l.replace(/ ✓$/, "").replace(/ theme$/, ""))).map(
        (l) => `command listed twice: ${l}`,
      ),
      // Claude Code is not configured in the baseline: no Code destination.
      ...(labels.includes("Code") ? ["Code listed without Claude Code"] : []),
    ];
    expect(problems).toEqual([]);
  });
});
