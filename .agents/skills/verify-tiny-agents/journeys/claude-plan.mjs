// Feature: claude-plan (features/claude-plan.md). The Claude plan card in Settings → Models and the
// Claude Code harness on /code. A verify run cannot sign in to a Claude account and
// Verify runs have no Claude plan account, so this proves the engine-off
// state the owner sees and that nothing Claude-Code-only is offered; the signed-in
// paths are recorded as unreachable in the feature file.
import { journey, expect, caps, DEMO } from "../scripts/lib.mjs";

// The full load event can wait on a third-party embed; the SPA is usable at DOMContentLoaded.
const LOADED = { waitUntil: "domcontentloaded" };

await journey(
  "claude-plan",
  async ({ page, step, proof, api, cleanup }) => {
    await step("engine status reads off (verify runs have no Claude plan account)", async () => {
      const status = await api.get("/claude-code/status");
      expect(status.enabled).toBe(false);
      expect(status.fallback).toBe("pause");
    });

    /** Step-up for the account calls that need it. */
    const stepUp = async () => {
      const res = await page.request.post("/api/v1/vault/step-up", {
        data: { password: DEMO.password },
      });
      if (!res.ok()) throw new Error(`step-up ${res.status()}`);
      return { "X-Vault-Step-Up": (await res.json()).data.token };
    };
    let planId;
    cleanup(async () => {
      if (!planId) return;
      const removed = await page.request.delete(`/api/v1/models/providers/${planId}`, {
        headers: await stepUp(),
      });
      if (!removed.ok()) throw new Error(`delete ${removed.status()}`);
    });
    const card = page.locator("[data-slot=card]").filter({
      has: page.getByRole("button", { name: "Claude plan", exact: true }),
    });
    const engine = card.getByRole("region", { name: "Claude plan engine" });

    await step(
      "a disabled Claude plan account's card explains how to turn the engine on",
      async () => {
        // Added, then disabled at once: the engine stays off, as in the steps above.
        const created = await page.request.post("/api/v1/models/providers", {
          headers: await stepUp(),
          data: { kind: "claude-plan", models: [] },
        });
        if (!created.ok()) throw new Error(`create ${created.status()}`);
        planId = (await created.json()).data.id;
        await api.patch(`/models/providers/${planId}`, { enabled: false });
        expect((await api.get("/claude-code/status")).enabled).toBe(false);
        await page.goto("/settings/models", LOADED);
        await card.getByRole("button", { name: "Claude plan", exact: true }).click();
        await expect(engine.getByText(/The engine is off\. Enable this account/)).toBeVisible();
        await expect(engine.getByText(/turns pause\./)).toBeVisible();
        // With the engine off no worker is wired: no account line, nothing to sign in to.
        await expect(page.getByTestId("claude-plan-account")).toHaveCount(0);
        await expect(page.getByTestId("claude-plan-sign-in")).toHaveCount(0);
        await expect(engine.getByText(/Never paste a Claude token into tiny-agents/)).toBeVisible();
      },
    );
    await proof("settings-engine-off");

    await step("/code offers no Claude Code harness", async () => {
      if (!caps.has("shelley")) {
        // Neither harness configured: the sidebar has no Code at all.
        await expect(
          page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Code" }),
        ).toHaveCount(0);
        return;
      }
      await page.goto("/code/new", LOADED);
      await expect(page.getByRole("textbox", { name: /^Message / })).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.getByTestId("code-harness")).toHaveCount(0);
      expect((await api.get("/code/status")).harnesses.map((h) => h.id)).toEqual(["shelley"]);
    });
    await proof("code-no-claude-harness");

    // Regression for #171: with the engine off the account check reports
    // "unconfigured", and the card used to tell an owner whose sandbox works
    // (terminal, computer, browser) to set SANDBOX_HOST.
    await step("with a sandbox configured, the card does not say there is none", async () => {
      await expect(engine.getByText(/The engine is off/)).toBeVisible();
      expect((await api.get("/terminal/sessions")).status.kind).toBe("ready"); // the sandbox works
      await expect(engine).not.toContainText("No sandbox is configured");
    });
  },
  { requires: ["sandbox"] },
);
