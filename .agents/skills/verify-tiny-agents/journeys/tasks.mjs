// Feature: tasks (features/tasks.md). Quick add, edit, complete, reopen, delete.
import { journey, expect } from "../scripts/lib.mjs";

await journey("tasks", async ({ page, step, proof, cleanup, api, stamp }) => {
  const title = `Verify task ${stamp}`;
  // The row is a button named "<title> <due>"; the completion toast repeats the
  // bare title, so never locate the row by text alone.
  const row = () => page.getByRole("button", { name: new RegExp(`^${title}\\b`) });
  const find = async () => (await api.get("/tasks")).find((t) => t.title === title);

  await step("open Tasks", async () => {
    await page.goto("/tasks");
    await expect(page.getByRole("tab", { name: /today/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
  await step("quick add a task for today", async () => {
    await page.getByLabel("New task title").fill(title);
    await page.getByRole("button", { name: "Add task" }).click();
    await expect(row()).toBeVisible();
    const task = await find();
    expect(task?.status).toBe("todo");
    cleanup(async () => (await find()) && api.delete(`/tasks/${task.id}`));
  });
  await proof("added");
  await step("edit notes in the task dialog", async () => {
    await row().click();
    const dialog = page.getByRole("dialog", { name: "Edit task" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Notes").fill(`notes ${stamp}`);
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Task saved")).toBeVisible();
    expect((await find())?.description).toBe(`notes ${stamp}`);
  });
  await step("complete it: leaves Today, shows in Completed", async () => {
    await page.getByRole("button", { name: `Complete "${title}"` }).click();
    await expect(page.getByText("Task completed")).toBeVisible();
    await expect(page.getByRole("button", { name: `Complete "${title}"` })).toHaveCount(0);
    await page.getByRole("tab", { name: /completed/i }).click();
    await expect(page.getByRole("button", { name: `Mark "${title}" as not done` })).toBeVisible();
    expect((await find())?.status).toBe("done");
  });
  await proof("completed");
  await step("reopen it from Completed", async () => {
    await page.getByRole("button", { name: `Mark "${title}" as not done` }).click();
    await expect.poll(async () => (await find())?.status).toBe("todo");
  });
  await step("delete through the confirm dialog", async () => {
    await page.getByRole("tab", { name: /today/i }).click();
    await row().click();
    await page
      .getByRole("dialog", { name: "Edit task" })
      .getByRole("button", { name: /delete/i })
      .click();
    await page
      .getByRole("dialog", { name: "Delete task?" })
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    await expect(page.getByText("Task deleted")).toBeVisible();
    await expect(row()).toHaveCount(0);
    expect(await find()).toBeUndefined();
  });
  await proof("deleted");
});
