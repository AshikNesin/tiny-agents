// Feature: models (features/models.md). Settings → Models on the faux run: the Faux account,
// Add models → Claude plan → Check models → Connect behind step-up (no key, no models until Claude Code signs
// in on the sandbox, #232), the new account card, the default-models table, and the New bot
// picker, which offers only models that exist (the plan adds none yet).
import { journey, expect, DEMO } from "../scripts/lib.mjs";

await journey("models", async ({ page, step, proof, cleanup, api }) => {
  await step("open Settings → Models", async () => {
    await page.goto("/settings/models");
    await expect(page.getByText("Model providers")).toBeVisible();
    await expect(page.getByRole("button", { name: "Faux", exact: true })).toBeVisible();
  });
  await proof("models-tab");

  let planId;
  cleanup(async () => {
    if (!planId) return;
    // Deleting needs step-up: confirm with the demo password, then delete.
    const stepUp = await page.request.post("/api/v1/vault/step-up", {
      data: { password: DEMO.password },
    });
    if (!stepUp.ok()) throw new Error(`step-up ${stepUp.status()}`);
    const { token } = (await stepUp.json()).data;
    const removed = await page.request.delete(`/api/v1/models/providers/${planId}`, {
      headers: { "X-Vault-Step-Up": token },
    });
    if (!removed.ok()) throw new Error(`delete ${removed.status()}`);
  });

  await step("add a Claude plan account through the dialog", async () => {
    await page.getByRole("button", { name: "Add models" }).click();
    const dialog = page.getByRole("dialog", { name: "Add models" });
    await dialog.getByLabel("Kind").click();
    await page.getByRole("option", { name: "Claude plan" }).click();
    // No key and no hardcoded models: Claude Code lists them once signed in (#232).
    await expect(dialog).toContainText("The Claude plan needs no key here");
    await dialog.getByRole("button", { name: "Check models" }).click();
    // A toast: Check models finds none until Claude Code is signed in.
    await expect(page.getByText(/Claude Code lists its models once it is signed in/)).toBeVisible();
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

  await step("open the plan's card: no models until Claude Code lists them", async () => {
    await page.getByRole("button", { name: "Claude plan", exact: true }).click();
    const { accounts } = await api.get("/models/providers");
    expect(accounts.find((a) => a.id === planId)?.modelCount ?? 0).toBe(0);
    await expect(page.getByText("Claude plan · 0 models")).toBeVisible();
    await expect(page.getByRole("button", { name: "Fallback model" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Default models" })).toBeVisible();
    // The Claude plan's engine and sign-in live in its card (no separate tab).
    const engine = page.getByRole("region", { name: "Claude plan engine" });
    await expect(engine).toContainText("The engine is on.");
    await expect(engine).toContainText("Never paste a Claude token into tiny-agents");
  });
  await proof("models-plan-card");

  await step(
    "disabled, the plan's card says the engine is off, with nothing to sign in to",
    async () => {
      // The account's own switch, in its header (model rows have their own).
      const header = page.locator("[data-slot=card-header]").filter({
        has: page.getByRole("button", { name: "Claude plan", exact: true }),
      });
      await header.getByRole("button", { name: "Disable" }).click();
      const engine = page.getByRole("region", { name: "Claude plan engine" });
      await expect(engine).toContainText("The engine is off. Enable this account to turn it on.");
      await expect(engine).toContainText("turns pause.");
      // With the engine off the account line says nothing true either way (#171).
      await expect(engine.getByTestId("claude-plan-account")).toHaveCount(0);
      await expect(engine.getByTestId("claude-plan-sign-in")).toHaveCount(0);
      await header.getByRole("button", { name: "Enable" }).click();
      await expect(engine).toContainText("The engine is on.");
    },
  );
  await proof("models-plan-engine-off");

  await step(
    "the New bot picker offers only models that exist: none from the plan yet",
    async () => {
      const { models } = await api.get("/models");
      expect(models.some((m) => m.providerName === "Claude plan")).toBe(false);
      await page.goto("/chats");
      const create = page.getByRole("button", { name: /Create your first bot|New bot/ }).first();
      await create.click();
      const dialog = page.getByRole("dialog", { name: "New bot" });
      await dialog.getByRole("button", { name: "Test Model (faux)" }).click();
      await expect(page.getByRole("option", { name: /Test Model \(faux\)/ })).toBeVisible();
      await expect(page.getByRole("option", { name: /Claude/ })).toHaveCount(0);
    },
  );
  await proof("models-picker");
});
