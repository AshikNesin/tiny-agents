// Feature: models (features/models.md). Settings → Models on the faux run: the Faux account,
// Add models → Claude plan → Check models (static list, no network) → Connect behind step-up,
// the new account card, the default-models table, and the plan's models in the New bot picker.
import { journey, expect, DEMO } from "../scripts/lib.mjs";

await journey("models", async ({ page, step, proof, cleanup, api }) => {
  await step("open Settings → Models", async () => {
    await page.goto("/settings?tab=models");
    await expect(page.getByText("Model providers")).toBeVisible();
    await expect(page.getByRole("button", { name: "Faux", exact: true })).toBeVisible();
  });
  await proof("models-tab");

  let planId;
  cleanup(async () => {
    if (!planId) return;
    // Deleting needs step-up; the journey's token is in page memory, so do it through the UI path's API.
    const token = await page.evaluate(async (password) => {
      const r = await fetch("/api/v1/vault/step-up", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      return (await r.json()).data.token;
    }, DEMO.password);
    await page.request.delete(`/api/v1/models/providers/${planId}`, {
      headers: { "X-Vault-Step-Up": token },
    });
  });

  await step("add a Claude plan account through the dialog", async () => {
    await page.getByRole("button", { name: "Add models" }).click();
    const dialog = page.getByRole("dialog", { name: "Add models" });
    await dialog.getByLabel("Kind").click();
    await page.getByRole("option", { name: "Claude plan" }).click();
    await dialog.getByRole("button", { name: "Check models" }).click();
    await expect(dialog.getByText("3 of 3 selected")).toBeVisible();
    await proof("models-checked");
    await dialog.getByRole("button", { name: "Connect" }).click();
    // Step-up: creating an account asks for the password.
    await page.getByLabel("Password").fill(DEMO.password);
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByRole("button", { name: "Claude plan", exact: true })).toBeVisible();
    const { accounts } = await api.get("/models/providers");
    planId = accounts.find((a) => a.kind === "claude-plan")?.id;
    expect(planId).toBeTruthy();
  });
  await proof("models-plan-added");

  await step("open the plan's card: three models, a fallback picker", async () => {
    await page.getByRole("button", { name: "Claude plan", exact: true }).click();
    await expect(page.getByText("Claude Sonnet 4.6")).toBeVisible();
    await expect(page.getByLabel("Fallback model")).toBeVisible();
    await expect(page.getByText("Default models")).toBeVisible();
  });
  await proof("models-plan-card");

  await step("the New bot picker groups the plan's models under the account", async () => {
    const { models } = await api.get("/models");
    expect(models.some((m) => m.providerName === "Claude plan" && m.engine === "claude-code")).toBe(
      true,
    );
    await page.goto("/chats");
    const create = page.getByRole("button", { name: /Create your first bot|New bot/ }).first();
    await create.click();
    // Unset, the default role is the first available chat model: the plan's sorts first.
    const dialog = page.getByRole("dialog", { name: "New bot" });
    await dialog.getByRole("button", { name: "Claude Haiku 4.5" }).click();
    await expect(page.getByRole("menuitem", { name: /Claude Sonnet 4\.6/ })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /Test Model \(faux\)/ })).toBeVisible();
  });
  await proof("models-picker");
});
