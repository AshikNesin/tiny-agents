// Feature: models (features/models.md). A gateway custom provider's model added by id before the
// provider is set up (the Z.AI coding plan's GLM-5.3), against a real Cloudflare AI Gateway. Same
// env as models-gateway.mjs. The row says the provider isn't set up, Test explains the upstream's
// 404, Custom providers comes prefilled with the slug, and once the base path is in, GLM answers.
import { journey, expect, DEMO } from "../scripts/lib.mjs";
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const GATEWAY = process.env.CLOUDFLARE_GATEWAY_ID;
const TOKEN = process.env.CLOUDFLARE_API_KEY;
await journey(
  "models-gateway-custom",
  async ({ page, step, proof, cleanup, api, stamp }) => {
    const dialog = page.getByRole("dialog", { name: "Add models" });
    const accountName = `GW ${stamp}`;
    let accountId;
    cleanup(async () => {
      if (!accountId) return;
      const s = await page.request.post("/api/v1/vault/step-up", {
        data: { password: DEMO.password },
      });
      const { token } = (await s.json()).data;
      await page.request.delete(`/api/v1/models/providers/${accountId}`, {
        headers: { "X-Vault-Step-Up": token },
      });
    });
    await step("connect the gateway with no custom provider", async () => {
      await page.goto("/settings?tab=models");
      await page.getByRole("button", { name: "Add models" }).click();
      await dialog.getByLabel("Kind").click();
      await page.getByRole("option", { name: "Cloudflare AI Gateway" }).click();
      await dialog.getByLabel("Account ID").fill(ACCOUNT);
      await dialog.getByLabel("Gateway ID").fill(GATEWAY);
      await dialog.getByLabel("Gateway token").fill(TOKEN);
      await dialog.getByLabel("Account name").fill(accountName);
      await dialog.getByRole("button", { name: "Check models" }).click();
      await dialog.getByLabel("Search models").fill("claude-haiku-5-5");
      await dialog.getByRole("button", { name: "All" }).click({ timeout: 30_000 });
      await dialog.getByRole("button", { name: "Connect" }).click();
      await page.getByLabel("Password").fill(DEMO.password);
      await page.getByRole("button", { name: "Confirm" }).click();
      await expect(page.getByRole("button", { name: accountName, exact: true })).toBeVisible({
        timeout: 60_000,
      });
      accountId = (await api.get("/models/providers")).accounts.find(
        (a) => a.name === accountName,
      )?.id;
    });
    const card = page
      .locator("[data-slot=card]")
      .filter({ has: page.getByRole("button", { name: accountName, exact: true }) })
      .last();
    const glmRow = card
      .getByRole("listitem")
      .filter({ has: page.getByText("custom-zai-coding-plan/glm-5.3", { exact: true }) });
    await step(
      "add GLM by id: the row says the provider isn't set up; Test explains the 404",
      async () => {
        await card.getByRole("button", { name: accountName, exact: true }).click();
        await card.getByPlaceholder(/Add a model by id/).fill("custom-zai-coding-plan/glm-5.3");
        await card.getByRole("button", { name: "Add", exact: true }).click();
        await expect(glmRow).toContainText("custom-zai-coding-plan isn't set up", {
          timeout: 20_000,
        });
        await glmRow.getByRole("button", { name: "Test" }).click();
        await expect(
          page.getByText(/answered 404 Not Found: the gateway reached it on the wrong path/),
        ).toBeVisible({ timeout: 60_000 });
      },
    );
    await proof("glm-404-explained");
    await step(
      "Custom providers: the slug is prefilled; add the base path; Test answers",
      async () => {
        await card.getByRole("button", { name: "Custom providers" }).click();
        const cp = page.getByRole("dialog");
        await expect(cp.getByLabel("Custom provider slug")).toHaveValue("custom-zai-coding-plan");
        await proof("glm-custom-prefilled");
        await cp.getByLabel("Custom provider base path").fill("api/coding/paas/v4");
        await cp.getByRole("button", { name: /^Save/ }).click();
        const pw = page.getByLabel("Password");
        if (await pw.isVisible({ timeout: 5_000 }).catch(() => false)) {
          await pw.fill(DEMO.password);
          await page.getByRole("button", { name: "Confirm" }).click();
        }
        // The dialog may offer new models to add: close it.
        if (
          await page
            .getByRole("dialog")
            .isVisible({ timeout: 20_000 })
            .catch(() => false)
        ) {
          await page.keyboard.press("Escape");
        }
        await expect(glmRow).not.toContainText("isn't set up", { timeout: 30_000 });
        await glmRow.getByRole("button", { name: "Test" }).click();
        await expect(page.getByText(/GLM.*answered in \d+ ms/).first()).toBeVisible({
          timeout: 60_000,
        });
      },
    );
    await proof("glm-answers");
  },
  {
    requires: ["env:CLOUDFLARE_ACCOUNT_ID", "env:CLOUDFLARE_GATEWAY_ID", "env:CLOUDFLARE_API_KEY"],
  },
);
