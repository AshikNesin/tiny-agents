// Feature: skills (features/skills.md). Create (with validation), edit + preview, persist,
// assign to a bot from both sides, search, import a pasted SKILL.md, delete.
import { journey, expect } from "../scripts/lib.mjs";

await journey("skills", async ({ page, step, proof, cleanup, api, stamp }) => {
  const name = `verify-skill-${stamp}`;
  const imported = `verify-import-${stamp}`;
  const botName = `Skill Bot ${stamp}`;
  let botId;
  let skillId;
  let importedId;
  const skillByName = async (n) => (await api.get("/skills")).find((s) => s.name === n);
  const deleteIfThere = (n) => async () => {
    const row = await skillByName(n);
    if (row) await api.delete(`/skills/${row.id}`);
  };

  await step("setup: a faux bot to attach the skill to (API)", async () => {
    const models = await api.get("/models");
    botId = (await api.post("/bots", { name: botName, modelId: models.defaultModelId })).id;
    cleanup(() => api.delete(`/bots/${botId}`));
  });

  await step("open Skills from the account menu", async () => {
    await page.getByRole("button", { name: "Account and navigation" }).click();
    await page.getByRole("menuitem", { name: "Skills" }).click();
    await expect(page).toHaveURL(/\/skills$/);
    await expect(page.getByRole("heading", { name: "Skills", exact: true })).toBeVisible();
  });

  await step("New skill dialog rejects a bad name, then creates", async () => {
    await page.getByRole("button", { name: "New skill" }).click();
    const dialog = page.getByRole("dialog", { name: "New skill" });
    await dialog.getByLabel("Name").fill("Bad Name");
    await dialog.getByLabel("Description").click(); // blur the name
    await expect(dialog.getByText(/lowercase letters, digits and single hyphens/i)).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Create skill" })).toBeDisabled();
    await dialog.getByLabel("Name").fill(name);
    await dialog.getByLabel("Description").fill(`Made by verify ${stamp}`);
    await dialog.getByLabel("Instructions").fill(`# Step one ${stamp}\n\nDo the thing.`);
    await dialog.getByRole("button", { name: "Create skill" }).click();
    await expect(page.getByText("Skill created")).toBeVisible();
    await expect(page).toHaveURL(/\/skills\/[^/]+$/);
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    skillId = (await skillByName(name))?.id;
    expect(skillId, "skill row in GET /skills").toBeTruthy();
    cleanup(deleteIfThere(name));
    await expect(page.getByLabel("Name")).toBeDisabled(); // the name is the bots' reference
  });
  await proof("created");

  await step("edit description and instructions, preview renders markdown", async () => {
    await page.getByLabel("Description").fill(`Edited by verify ${stamp}`);
    await page
      .getByLabel("Skill instructions (markdown)")
      .fill(`# Edited heading ${stamp}\n\n- first\n- second`);
    await page.getByRole("tab", { name: "Preview" }).click();
    await expect(page.getByRole("heading", { name: `Edited heading ${stamp}` })).toBeVisible();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Skill saved")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });
  await proof("edited-preview");

  await step("reload: edits come back from the server", async () => {
    await page.reload();
    await expect(page.getByLabel("Description")).toHaveValue(`Edited by verify ${stamp}`);
    await expect(page.getByLabel("Skill instructions (markdown)")).toHaveValue(
      new RegExp(`^# Edited heading ${stamp}`),
    );
    const row = await api.get(`/skills/${skillId}`);
    expect(row.description).toBe(`Edited by verify ${stamp}`);
    expect(row.body).toContain(`# Edited heading ${stamp}`);
  });

  await step("attach the skill to the bot from the skill page", async () => {
    const box = page.getByRole("checkbox", { name: `Use ${name} with ${botName}` });
    await box.click();
    await expect(box).toBeChecked();
    await expect.poll(async () => (await api.get(`/skills/${skillId}`)).botIds).toContain(botId);
    expect((await api.get(`/bots/${botId}`)).skillIds).toContain(skillId);
  });
  await proof("attached");

  await step("the bot's Edit dialog shows it under Skills; detach and save there", async () => {
    await page.goto(`/chats/${botId}`);
    await page.getByRole("button", { name: `${botName} actions` }).click();
    await page.getByRole("menuitem", { name: "Edit bot" }).click();
    const dialog = page.getByRole("dialog", { name: `Edit ${botName}` });
    await dialog.getByRole("tab", { name: "Skills" }).click();
    const sw = dialog.getByRole("switch", { name: `Assign ${name}` });
    await expect(sw).toBeChecked();
    await proof("bot-dialog-skills");
    await sw.click();
    await expect(sw).not.toBeChecked();
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).not.toBeVisible({ timeout: 15_000 });
    await expect
      .poll(async () => (await api.get(`/bots/${botId}`)).skillIds)
      .not.toContain(skillId);
    expect((await api.get(`/skills/${skillId}`)).botIds).not.toContain(botId);
  });

  await step("re-attach from the bot dialog (Assign switch on, Save)", async () => {
    await page.getByRole("button", { name: `${botName} actions` }).click();
    await page.getByRole("menuitem", { name: "Edit bot" }).click();
    const dialog = page.getByRole("dialog", { name: `Edit ${botName}` });
    await dialog.getByRole("tab", { name: "Skills" }).click();
    await dialog.getByRole("switch", { name: `Assign ${name}` }).click();
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).not.toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => (await api.get(`/bots/${botId}`)).skillIds).toContain(skillId);
  });

  await step("list shows the skill with its bot count; search filters", async () => {
    await page.goto("/skills");
    const row = page.getByRole("button", { name: new RegExp(`^${name}\\b`) });
    await expect(row).toBeVisible();
    await expect(row).toContainText("used by 1 bot");
    await expect(row).toContainText("manual");
    await page.getByRole("searchbox", { name: "Search skills" }).fill(`zz-no-such-${stamp}`);
    await expect(page.getByText("No matching skills")).toBeVisible();
    await page.getByRole("searchbox", { name: "Search skills" }).fill(name);
    await expect(row).toBeVisible();
  });
  await proof("list");

  await step("import a pasted SKILL.md: preview, install", async () => {
    await page.getByRole("searchbox", { name: "Search skills" }).fill("");
    await page.getByRole("button", { name: "Import", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Import skill" });
    await dialog
      .getByLabel("SKILL.md content")
      .fill(
        `---\nname: ${imported}\ndescription: Imported by verify ${stamp}\n---\n\n# Imported body ${stamp}\n`,
      );
    await dialog.getByRole("button", { name: "Preview" }).click();
    await expect(dialog.getByText("Review the parsed skill before installing.")).toBeVisible();
    await expect(dialog.getByText(imported, { exact: true })).toBeVisible();
    await expect(dialog.getByRole("heading", { name: `Imported body ${stamp}` })).toBeVisible();
    await proof("import-preview");
    await dialog.getByRole("button", { name: "Install" }).click();
    await expect(page.getByText("Skill installed")).toBeVisible();
    await expect(page.getByRole("heading", { name: imported, exact: true })).toBeVisible();
    importedId = (await skillByName(imported))?.id;
    expect(importedId, "imported skill in GET /skills").toBeTruthy();
    cleanup(deleteIfThere(imported));
  });

  await step("importing the same name again cannot be installed", async () => {
    await page.goto("/skills");
    await page.getByRole("button", { name: "Import", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Import skill" });
    await dialog
      .getByLabel("SKILL.md content")
      .fill(`---\nname: ${imported}\ndescription: Duplicate ${stamp}\n---\n\nbody\n`);
    await dialog.getByRole("button", { name: "Preview" }).click();
    await expect(dialog.getByRole("button", { name: "Install" })).toBeDisabled();
    await dialog.getByRole("button", { name: "Back" }).click();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).not.toBeVisible();
  });

  await step("delete warns about the bot that uses it, then deletes", async () => {
    await page.getByRole("button", { name: new RegExp(`^${name}\\b`) }).click();
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Delete" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete skill?" });
    await expect(dialog).toContainText("1 bot uses");
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByText("Skill deleted")).toBeVisible();
    await expect(page).toHaveURL(/\/skills$/);
    await expect(page.getByRole("button", { name: new RegExp(`^${name}\\b`) })).toHaveCount(0);
    expect(await skillByName(name)).toBeUndefined();
    expect((await api.get(`/bots/${botId}`)).skillIds).not.toContain(skillId);
  });
  await proof("deleted");
});
