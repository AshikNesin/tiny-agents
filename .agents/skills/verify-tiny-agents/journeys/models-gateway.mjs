// Feature: models (features/models.md), against a real Cloudflare AI Gateway (issue #216).
// Needs CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_GATEWAY_ID and CLOUDFLARE_API_KEY in the shell that
// runs `ta-verify drive` (never in the server's env), a gateway holding an Anthropic and a
// TypeSafe BYOK key, and a custom provider `custom-zai-coding-plan` (Z.AI's coding plan,
// base path api/coding/paas/v4). One gateway account serves all three: Claude, the custom GLM
// models and the Jev classifier. Real model calls, a few tokens each.
import { journey, expect, DEMO } from "../scripts/lib.mjs";

const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const GATEWAY = process.env.CLOUDFLARE_GATEWAY_ID;
const TOKEN = process.env.CLOUDFLARE_API_KEY;
const SLUG = "custom-zai-coding-plan";

await journey(
  "models-gateway",
  async ({ page, step, proof, cleanup, api, stamp }) => {
    const dialog = page.getByRole("dialog", { name: "Add models" });
    const accountName = `Gateway ${stamp}`;
    let accountId;
    let botId;
    cleanup(async () => {
      if (botId) await api.delete(`/bots/${botId}`);
      if (!accountId) return;
      // The roles this journey set point at the account: clear them first.
      const roles = await page.request.put("/api/v1/models/roles", {
        data: { bot_default: null, classifier: null },
      });
      if (!roles.ok()) throw new Error(`roles ${roles.status()}`);
      const stepUp = await page.request.post("/api/v1/vault/step-up", {
        data: { password: DEMO.password },
      });
      if (!stepUp.ok()) throw new Error(`step-up ${stepUp.status()}`);
      const { token } = (await stepUp.json()).data;
      const removed = await page.request.delete(`/api/v1/models/providers/${accountId}`, {
        headers: { "X-Vault-Step-Up": token },
      });
      if (!removed.ok()) throw new Error(`delete ${removed.status()}`);
    });

    /** In the checklist: search, then tick every model the search shows. */
    const keep = async (query) => {
      await dialog.getByLabel("Search models").fill(query);
      await dialog.getByRole("button", { name: "All" }).click();
    };

    await step("connect the gateway with its custom provider", async () => {
      await page.goto("/settings/models");
      await page.getByRole("button", { name: "Add models" }).click();
      await dialog.getByLabel("Kind").click();
      await page.getByRole("option", { name: "Cloudflare AI Gateway" }).click();
      await dialog.getByLabel("Account ID").fill(ACCOUNT);
      await dialog.getByLabel("Gateway ID").fill(GATEWAY);
      await dialog.getByRole("button", { name: "Add a custom provider" }).click();
      await dialog.getByLabel("Custom provider slug").fill(SLUG);
      await dialog.getByLabel("Custom provider base path").fill("api/coding/paas/v4");
      await dialog.getByLabel("Gateway token").fill(TOKEN);
      await dialog.getByLabel("Account name").fill(accountName);
      await dialog.getByRole("button", { name: "Check models" }).click();
      // The custom provider's own models are listed beside the gateway's catalog.
      await expect(dialog.getByText(new RegExp(`\\(${SLUG}\\)`)).first()).toBeVisible({
        timeout: 30_000,
      });
      await keep(`${SLUG}/glm-5.3`);
      await keep("claude-sonnet-5-5");
      await keep("typesafe/jev");
      await proof("gateway-checked");
      await dialog.getByRole("button", { name: "Connect" }).click();
      await page.getByLabel("Password").fill(DEMO.password);
      await page.getByRole("button", { name: "Confirm" }).click();
      // Saved once its card shows (the step-up prompt hides the dialog before that).
      await expect(page.getByRole("button", { name: accountName, exact: true })).toBeVisible({
        timeout: 60_000,
      });
      const { accounts } = await api.get("/models/providers");
      const account = accounts.find((a) => a.name === accountName);
      accountId = account?.id;
      expect(account?.models.map((m) => m.upstreamId)).toEqual(
        expect.arrayContaining([`${SLUG}/glm-5.3-flash`, "claude-sonnet-5-5"]),
      );
    });

    const card = page.locator("[data-slot=card]").filter({ hasText: accountName });
    /** A model row, by its exact upstream id. */
    const testRow = async (upstreamId) => {
      await card
        .getByRole("listitem")
        .filter({ has: page.getByText(upstreamId, { exact: true }) })
        .getByRole("button", { name: "Test" })
        .click();
      await expect(page.getByText(/answered in \d+ ms/).first()).toBeVisible({ timeout: 60_000 });
    };
    await step("Test answers on Claude Sonnet 5.5 and the custom GLM", async () => {
      await card.getByRole("button", { name: accountName, exact: true }).click();
      await testRow("claude-sonnet-5-5");
      await testRow(`${SLUG}/glm-5.3-flash`);
    });
    await proof("gateway-tested");

    await step("set the defaults: new bots on Sonnet 5.5, auto-review on Jev", async () => {
      await page.getByRole("button", { name: "New bots" }).click();
      await page.getByPlaceholder("Search models…").fill("sonnet 5.5");
      await page
        .getByRole("option", { name: /Claude Sonnet 5\.5/ })
        .first()
        .click();
      // The role saved (its Reset shows) before the next picker opens.
      await expect(page.getByRole("button", { name: "Reset" })).toHaveCount(1);
      await page.getByRole("button", { name: "Auto-review" }).click();
      await page.getByPlaceholder("Search models…").fill("jev");
      await page.getByRole("option", { name: /Jev/ }).first().click();
      const { roles } = await api.get("/models/roles");
      expect(roles.bot_default.fallback).toBe(false);
      expect(roles.classifier.fallback).toBe(false);
    });
    await proof("gateway-defaults");

    const name = `Gateway Bot ${stamp}`;
    const composer = page.getByPlaceholder(new RegExp(`(?:ask|message) ${name}`, "i"));
    const replies = page.getByRole("article");
    await step("a bot on Sonnet 5.5 answers", async () => {
      await page.goto("/chats");
      const empty = page.getByRole("button", { name: /create your first bot/i });
      if (await empty.isVisible()) await empty.click();
      else
        await page
          .getByRole("button", { name: /new bot/i })
          .first()
          .click();
      await expect(page.getByRole("button", { name: "Claude Sonnet 5.5" })).toBeVisible();
      await page.getByLabel("Name").fill(name);
      await page.getByRole("button", { name: /create bot/i }).click();
      await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 15_000 });
      botId = (await api.get("/bots")).find((b) => b.name === name)?.id;
      await composer.fill("Reply with only the word pong.");
      await composer.press("Enter");
      await expect(page.getByText(/^\s*pong\.?\s*$/i).first()).toBeVisible({ timeout: 90_000 });
    });
    await proof("gateway-sonnet-reply");

    await step("switched to the custom GLM, the bot answers again", async () => {
      await page.getByTestId("chat-model").click();
      await page.getByPlaceholder(/Search models/).fill("glm-5.3-flash");
      // Exactly GLM-5.3-Flash: the search also matches glm-5.3-flashx, which the plan lacks.
      await page
        .getByRole("option", { name: /^GLM-5\.3-Flash \(custom-zai-coding-plan\)/ })
        .click();
      await composer.fill("Reply with only the word ping.");
      await composer.press("Enter");
      await expect(page.getByText(/^\s*ping\.?\s*$/i).first()).toBeVisible({ timeout: 90_000 });
      expect(replies).toBeTruthy();
    });
    await proof("gateway-glm-reply");
  },
  {
    requires: ["env:CLOUDFLARE_ACCOUNT_ID", "env:CLOUDFLARE_GATEWAY_ID", "env:CLOUDFLARE_API_KEY"],
  },
);
