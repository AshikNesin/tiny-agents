// Feature: settings (features/settings.md). Create, edit JSON, persist across reload, delete.
import { journey, expect } from "../scripts/lib.mjs";

await journey("settings", async ({ page, step, proof, cleanup, stamp }) => {
  const key = `verify.setting.${stamp}`;

  await step("create a setting", async () => {
    await page.goto("/settings/configuration");
    await page.getByRole("button", { name: /add setting/i }).click();
    await page.getByPlaceholder(/featureflags/i).fill(key);
    await page.getByRole("button", { name: /^create$/i }).click();
    await expect(page.getByRole("heading", { name: key })).toBeVisible();
    cleanup(async () => {
      const url = `/api/v1/settings/${encodeURIComponent(key)}`;
      if ((await page.request.get(url)).status() === 200) await page.request.delete(url);
    });
  });
  await step("edit description and JSON value, save", async () => {
    await page.getByLabel("Description").fill(`made by verify ${stamp}`);
    await page.locator(".cm-content").click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type('{"enabled": true}');
    await page.getByRole("button", { name: /save changes/i }).click();
    await expect(page.getByText(/updated successfully/i)).toBeVisible();
  });
  await step("reload: values come back from the server", async () => {
    await page.reload();
    await page.getByRole("button", { name: key }).click();
    await expect(page.getByLabel("Description")).toHaveValue(`made by verify ${stamp}`);
    await expect(page.locator(".cm-content")).toContainText('"enabled": true');
    const res = await page.request.get(`/api/v1/settings/${encodeURIComponent(key)}`);
    expect(res.status()).toBe(200);
    expect(JSON.stringify((await res.json()).data)).toContain('"enabled":true');
  });
  await proof("persisted");
  await step("delete through the confirm dialog", async () => {
    await page.getByRole("button", { name: /^delete$/i }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    // The editor moves to another setting, or "No setting selected" when none is
    // left (other journeys on the same run leave theirs, e.g. notifications).
    await expect(page.getByRole("heading", { name: key })).toHaveCount(0);
    await expect(page.getByRole("button", { name: key })).toHaveCount(0);
    expect((await page.request.get(`/api/v1/settings/${encodeURIComponent(key)}`)).status()).toBe(
      404,
    );
  });
  await proof("deleted");
});
