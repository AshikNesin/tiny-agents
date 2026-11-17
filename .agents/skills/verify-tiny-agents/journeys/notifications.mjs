// Feature: notifications (features/notifications.md). Settings → Notifications with Pushover
// unconfigured (the off state), the one "Send notifications to" choice, saving preferences, and the in-app "a bot needs you" signals
// (sidebar label, tab title count, badged favicon) while a bot waits on a question.
import { journey, expect } from "../scripts/lib.mjs";

await journey("notifications", async ({ page, step, proof, cleanup, api, stamp }) => {
  const botName = `Notify Bot ${stamp}`;
  const device = `verify-device-${stamp}`;
  let botId;
  let original;
  const favicon = () =>
    page.evaluate(() => document.querySelector('link[rel="icon"]')?.getAttribute("href"));

  await step("open Settings → Notifications", async () => {
    original = (await api.get("/notifications/settings")).settings;
    // lib's api helper has no put(); restore through the page's request context.
    cleanup(async () => {
      const res = await page.request.put("/api/v1/notifications/settings", { data: original });
      if (!res.ok()) throw new Error(`restore notification settings -> ${res.status()}`);
    });
    await page.goto("/settings/notifications");
    await expect(page.getByRole("heading", { name: "Notifications", exact: true })).toBeVisible();
  });
  await step("no phone registered: Pushover is the chosen channel", async () => {
    const choice = page.getByRole("radiogroup", { name: "Send notifications to" });
    await expect(choice.getByRole("radio", { name: "Pushover" })).toBeChecked();
    await expect(choice.getByRole("radio")).toHaveText(["Phone app", "Pushover", "Off"]);
  });
  await step(
    "off state: Not configured, names the env vars, no test/re-check buttons",
    async () => {
      // The settings screen's own content column, inside the app's main.
      const panel = page.getByRole("main").getByRole("main");
      await expect(panel.getByText("Not configured", { exact: true })).toBeVisible();
      await expect(panel).toContainText("PUSHOVER_API_TOKEN");
      await expect(panel).toContainText("PUSHOVER_USER_KEY");
      await expect(panel.getByRole("button", { name: "Send test" })).toHaveCount(0);
      await expect(panel.getByRole("button", { name: "Re-check Pushover" })).toHaveCount(0);
      const status = await api.get("/notifications/status");
      expect(status.state).toBe("not_configured");
    },
  );
  await step("event switches are grouped; Vault alerts is locked on", async () => {
    for (const group of ["Needs you", "Updates", "Security"]) {
      await expect(page.getByRole("region", { name: group })).toBeVisible();
    }
    await expect(page.getByRole("checkbox", { name: "Vault alerts" })).toBeDisabled();
    await expect(page.getByRole("checkbox", { name: "Vault alerts" })).toBeChecked();
    await expect(page.getByText("Nothing sent yet.")).toBeVisible();
  });
  await proof("off-state");
  await step("choose Off, then Phone app: one choice saved, only its details shown", async () => {
    const choice = page.getByRole("radiogroup", { name: "Send notifications to" });
    await choice.getByRole("radio", { name: "Off" }).click();
    await expect(page.getByText("Nothing is sent. Bots work the same.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "What to send" })).toHaveCount(0);
    expect((await api.get("/notifications/settings")).settings.deliverTo).toBe("off");
    await choice.getByRole("radio", { name: "Phone app" }).click();
    await expect(page.getByText(/No phones yet/)).toBeVisible();
    await expect(page.getByText("PUSHOVER_API_TOKEN")).toHaveCount(0);
    expect((await api.get("/notifications/settings")).settings.deliverTo).toBe("webpush");
  });
  await proof("phone-chosen");
  await step("back to Pushover", async () => {
    await page
      .getByRole("radiogroup", { name: "Send notifications to" })
      .getByRole("radio", { name: "Pushover" })
      .click();
    await expect(page.getByLabel("Pushover device (optional)")).toBeVisible();
  });
  await step("change preferences: an event off, quiet hours on, timing, device; Save", async () => {
    await page.getByRole("checkbox", { name: "Long reply finished" }).click();
    await expect(page.getByRole("checkbox", { name: "Long reply finished" })).not.toBeChecked();
    await page.getByRole("checkbox", { name: "Hold updates during quiet hours" }).click();
    await page.getByLabel("From").fill("22:30");
    await page.getByLabel("Until").fill("07:15");
    await page.getByLabel("Long reply (minutes)").fill("12");
    await page.getByLabel("Pushover device (optional)").fill(device);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Notification settings saved")).toBeVisible();
  });
  await step("reload: the saved preferences come back (UI and API)", async () => {
    await page.reload();
    await expect(page.getByRole("checkbox", { name: "Long reply finished" })).not.toBeChecked();
    await expect(
      page.getByRole("checkbox", { name: "Hold updates during quiet hours" }),
    ).toBeChecked();
    await expect(page.getByLabel("From")).toHaveValue("22:30");
    await expect(page.getByLabel("Until")).toHaveValue("07:15");
    await expect(page.getByLabel("Long reply (minutes)")).toHaveValue("12");
    await expect(page.getByLabel("Pushover device (optional)")).toHaveValue(device);
    const { settings } = await api.get("/notifications/settings");
    expect(settings.events["run.long_done"]).toBe(false);
    expect(settings.quietHours).toMatchObject({ enabled: true, start: "22:30", end: "07:15" });
    expect(settings.longRunMinutes).toBe(12);
    expect(settings.device).toBe(device);
  });
  await proof("saved");
  await step("setup: a faux bot (API)", async () => {
    const models = await api.get("/models");
    const bot = await api.post("/bots", { name: botName, modelId: models.defaultModelId });
    botId = bot.id;
    cleanup(() => api.delete(`/bots/${botId}`));
  });
  await step("before: tab title has no count, plain favicon", async () => {
    await page.goto(`/chats/${botId}`);
    await expect(page).toHaveTitle(`${botName} · tiny-agents`);
    expect(await favicon()).toBe("/favicon.svg");
  });
  await step("the bot asks a question (/ask): question card + sidebar label", async () => {
    const composer = page.getByPlaceholder(new RegExp(`message ${botName}`, "i"));
    await composer.fill("/ask set up the project");
    await composer.press("Enter");
    await expect(page.getByTestId("question-card")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByLabel("1 question for you", { exact: true })).toBeVisible();
  });
  await step("tab title counts it and the favicon is badged, on any page", async () => {
    await expect(page).toHaveTitle(`(1) ${botName} · tiny-agents`);
    expect(await favicon()).not.toBe("/favicon.svg");
    await page.getByRole("link", { name: "Tasks" }).click();
    await expect(page).toHaveTitle("(1) Tasks · tiny-agents");
  });
  await proof("attention-waiting");
  await step("Pushover off: the waiting question logged no notification", async () => {
    const rows = await api.get("/notifications/log?limit=20");
    expect(rows.filter((r) => r.event === "question.asked")).toEqual([]);
  });
  await step("answering clears the count and the badge", async () => {
    await page.goto(`/chats/${botId}`);
    const card = page.getByTestId("question-card");
    await card.getByRole("radio", { name: /React/ }).click();
    await card.getByRole("checkbox", { name: /Auth/ }).click();
    await card.getByRole("button", { name: /Next/ }).click();
    await card.getByRole("textbox", { name: "Anything else I should know?" }).fill(stamp);
    await card.getByRole("button", { name: /Send answers/ }).click();
    await expect(card).not.toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveTitle(`${botName} · tiny-agents`, { timeout: 15_000 });
    await expect(page.getByLabel("1 question for you", { exact: true })).toHaveCount(0);
    expect(await favicon()).toBe("/favicon.svg");
  });
  await proof("attention-cleared");
});
