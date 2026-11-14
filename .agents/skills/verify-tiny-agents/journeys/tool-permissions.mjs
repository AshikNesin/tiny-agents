// Feature: tool-permissions (features/tool-permissions.md). Per-bot Allow/Ask/Off
// toggles in Edit bot → Tools, the approval card an Ask tool raises, Deny,
// Approve, Always allow (writes Allow back), and Off hiding the tool.
import { journey, expect } from "../scripts/lib.mjs";

await journey("tool-permissions", async ({ page, step, proof, cleanup, api, stamp }) => {
  const name = `Perm Bot ${stamp}`;
  const composer = page.getByPlaceholder(`Message ${name}`, { exact: true });
  const dialog = page.getByRole("dialog", { name: `Edit ${name}` });
  const group = dialog.getByRole("radiogroup", { name: "Read the page permission" });
  const card = page.getByText(`${name} wants to read the page`);
  let botId;

  const send = async (text) => {
    await composer.fill(text);
    await composer.press("Enter");
  };
  const openTools = async () => {
    await page.getByRole("button", { name: `${name} menu` }).click();
    await page.getByRole("menuitem", { name: "Bot settings" }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("tab", { name: "Tools" }).click();
  };
  const searchSnapshot = async () => {
    await dialog.getByLabel("Search tools").fill("browser snapshot");
    await expect(group).toBeVisible({ timeout: 15_000 });
  };
  const save = async () => {
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).not.toBeVisible({ timeout: 15_000 });
    // The chat must be back in the accessibility tree once the dialog closes.
    await expect(page.getByRole("textbox", { name: `Message ${name}` })).toBeVisible();
  };
  const permission = async () =>
    (await api.get(`/bots/${botId}`)).toolPermissions?.browser_snapshot;
  const settled = () =>
    expect(page.getByRole("button", { name: "Stop generating" })).toHaveCount(0, {
      timeout: 30_000,
    });

  await step("setup: create a faux bot through the API", async () => {
    const bot = await api.post("/bots", { name, modelId: "test-model" });
    botId = bot.id;
    cleanup(async () => {
      await api.delete(`/bots/${botId}`);
      expect((await api.get("/bots")).some((b) => b.id === botId)).toBe(false);
    });
    await page.goto(`/chats/${botId}`);
    await expect(composer).toBeVisible({ timeout: 15_000 });
  });

  await step("Tools tab: presets, group toggles and per-tool defaults", async () => {
    await openTools();
    await expect(dialog.getByRole("switch", { name: "Auto-review" })).toBeVisible();
    // A writable tool defaults to Ask, and the selected option is visibly distinct.
    const tasks = dialog.getByRole("radiogroup", { name: "All Tasks tools" });
    await expect(tasks).toBeVisible({ timeout: 15_000 });
    const addTask = dialog.getByRole("radiogroup", { name: "Add a task permission" });
    await expect(addTask.getByRole("radio", { name: "Ask" })).toHaveAttribute("data-state", "on");
    const [onBg, offBg] = await addTask.getByRole("radio", { name: "Ask" }).evaluate((el) => {
      const sibling = el.parentElement.querySelector('[data-state="off"]');
      return [getComputedStyle(el).backgroundColor, getComputedStyle(sibling).backgroundColor];
    });
    expect(onBg, "selected option is visibly distinct").not.toBe(offBg);
    // Mixed read-only/writable group shows "Mixed"; the group control sets all.
    await tasks.getByRole("radio", { name: "Off" }).click();
    await expect(addTask.getByRole("radio", { name: "Off" })).toHaveAttribute("data-state", "on");
    await expect(
      dialog.getByRole("radiogroup", { name: "List tasks permission" }).getByRole("radio", {
        name: "Off",
      }),
    ).toHaveAttribute("data-state", "on");
    // "Ask for everything" puts every tool on Ask, Ask-only tools included.
    await dialog.getByRole("button", { name: "Ask for everything" }).click();
    await expect(addTask.getByRole("radio", { name: "Ask" })).toHaveAttribute("data-state", "on");
    await dialog.getByRole("button", { name: "Allow read-only" }).click();
    await expect(
      dialog.getByRole("radiogroup", { name: "List tasks permission" }).getByRole("radio", {
        name: "Allow",
      }),
    ).toHaveAttribute("data-state", "on");
    // Search narrows the list; a query with no match says so.
    await dialog.getByLabel("Search tools").fill(`zz-nothing-${stamp}`);
    await expect(dialog.getByText(`No tools match “zz-nothing-${stamp}”.`)).toBeVisible();
  });
  await step("set Read the page (browser_snapshot) from Allow to Ask and save", async () => {
    await searchSnapshot();
    await expect(group.getByRole("radio", { name: "Allow" })).toHaveAttribute("data-state", "on");
    await group.getByRole("radio", { name: "Ask" }).click();
    await expect(group.getByRole("radio", { name: "Ask" })).toHaveAttribute("data-state", "on");
    await save();
    await expect.poll(permission).toBe("ask");
  });
  await proof("set-ask");

  await step("an Ask tool raises the approval card; Deny stops it", async () => {
    await send(`/browse 1 deny ${stamp}`);
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Nothing runs until you answer.")).toBeVisible();
  });
  await proof("approval-card");
  await step("Deny: the card goes, the call is refused and the bot replies", async () => {
    await page.getByRole("button", { name: "Deny", exact: true }).click();
    await expect(card).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByRole("button", { name: /^Read the page denied by you/ })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/owner denied this browser_snapshot call/).first()).toBeVisible({
      timeout: 30_000,
    });
    await settled();
    expect(await permission()).toBe("ask");
  });
  await proof("denied");

  await step("Approve: the card goes and the call runs once", async () => {
    await send(`/browse 1 approve ${stamp}`);
    await expect(card).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(card).toHaveCount(0, { timeout: 15_000 });
    // It really ran: no browser binary in a verify run, so the tool's own error comes back.
    await expect(page.getByText(/No browser is installed on the server/).first()).toBeVisible({
      timeout: 30_000,
    });
    await settled();
    expect(await permission(), "Approve does not change the permission").toBe("ask");
  });
  await step("Always allow: approves and writes Allow back to the bot", async () => {
    await send(`/browse 1 always ${stamp}`);
    await expect(card).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Always allow", exact: true }).click();
    await expect(card).toHaveCount(0, { timeout: 15_000 });
    await settled();
    await expect.poll(permission).toBe("allow");
  });
  await step("after Always allow the next call runs without a card", async () => {
    await send(`/browse 1 after ${stamp}`);
    await expect(page.getByText(new RegExp(`/browse 1 after ${stamp}`)).first()).toBeVisible();
    await settled();
    await expect(card).toHaveCount(0);
  });
  await step("reopened Tools tab shows Allow for the tool", async () => {
    await page.reload();
    await openTools();
    await searchSnapshot();
    await expect(group.getByRole("radio", { name: "Allow" })).toHaveAttribute("data-state", "on");
  });
  await proof("always-allowed");

  await step("Off hides the tool: no card, the call never runs", async () => {
    await group.getByRole("radio", { name: "Off" }).click();
    await save();
    await expect.poll(permission).toBe("off");
    await send(`/browse 1 off ${stamp}`);
    await expect(page.getByText(`/browse 1 off ${stamp}`).first()).toBeVisible();
    await expect(page.getByText(/Tool browser_snapshot is not available/).first()).toBeVisible({
      timeout: 30_000,
    });
    await settled();
    await expect(card).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: `Message ${name}` })).toBeVisible();
  });
  await proof("off");
});
