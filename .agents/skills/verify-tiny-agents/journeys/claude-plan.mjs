// Feature: claude-plan (features/claude-plan.md). Settings → Claude plan and the
// Claude Code harness on /code. A verify run cannot sign in to a Claude account and
// `ta-verify up` blanks CLAUDE_CODE_ENGINE_ENABLED, so this proves the engine-off
// state the owner sees and that nothing Claude-Code-only is offered; the signed-in
// paths are recorded as unreachable in the feature file.
import { journey, expect, caps } from "../scripts/lib.mjs";

await journey(
  "claude-plan",
  async ({ page, step, proof, api }) => {
    await step(
      "engine status reads off (verify runs blank CLAUDE_CODE_ENGINE_ENABLED)",
      async () => {
        const status = await api.get("/claude-code/status");
        expect(status.enabled).toBe(false);
        expect(status.fallback).toBe("pause");
      },
    );

    await step("Settings → Claude plan explains how to turn the engine on", async () => {
      await page.goto("/settings");
      await page.getByRole("tab", { name: "Claude plan" }).click();
      const card = page.getByRole("tabpanel", { name: "Claude plan" });
      await expect(card.getByText("Claude plan", { exact: true })).toBeVisible();
      await expect(
        card.getByText(/The engine is off\. Set CLAUDE_CODE_ENGINE_ENABLED=1/),
      ).toBeVisible();
      await expect(card.getByText(/turns pause\./)).toBeVisible();
      // With the engine off no worker is wired, so there is no account to sign in to.
      await expect(page.getByTestId("claude-plan-account")).toBeVisible();
      await expect(page.getByTestId("claude-plan-sign-in")).toHaveCount(0);
      await expect(card.getByText(/Never paste a Claude token into tiny-agents/)).toBeVisible();
    });
    await proof("settings-engine-off");

    await step("/code offers no Claude Code harness", async () => {
      if (!caps.has("shelley")) {
        // Neither harness configured: the sidebar has no Code at all.
        await expect(
          page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Code" }),
        ).toHaveCount(0);
        return;
      }
      await page.goto("/code/new");
      await expect(page.getByRole("textbox", { name: /^Message / })).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.getByTestId("code-harness")).toHaveCount(0);
      expect((await api.get("/code/status")).harnesses.map((h) => h.id)).toEqual(["shelley"]);
    });
    await proof("code-no-claude-harness");

    // Last, because it currently fails (PRODUCT BUG): with the engine off the
    // account check reports "unconfigured", and the card tells an owner whose
    // sandbox works (terminal, computer, browser) to set SANDBOX_HOST.
    await step("with a sandbox configured, the card does not say there is none", async () => {
      await page.goto("/settings");
      await page.getByRole("tab", { name: "Claude plan" }).click();
      await expect(page.getByTestId("claude-plan-account")).toBeVisible();
      expect((await api.get("/terminal/sessions")).status.kind).toBe("ready"); // the sandbox works
      await expect(page.getByTestId("claude-plan-account")).not.toHaveText(
        /No sandbox is configured/,
      );
    });
  },
  { requires: ["sandbox"] },
);
