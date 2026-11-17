// Feature: code (features/code.md), the suggested next message. A Shelley turn ends
// (`ta-verify up --shelley`), the thread asks once for the next prompt, and the empty
// composer offers it: Tab fills it in, Esc dismisses it, and a phone gets a Use button.
//
// Faux mode has no side-call model, so the server answers `{ text: null }` (checked
// first); the journey then answers the browser's ask with a canned line through
// page.route, the AI provider boundary, and counts the asks.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { devices } from "@playwright/test";
import { journey, expect } from "../scripts/lib.mjs";

const SUGGESTION = "Run the tests and open a draft PR";

await journey(
  "code-next-prompt",
  async ({ page, context, step, proof, cleanup, api, stamp }) => {
    const dir = path.join(
      process.cwd(),
      "data",
      "verify",
      process.env.TA_VERIFY_RUN,
      `np-${stamp}`,
    );
    const composer = page.getByRole("textbox", { name: "Message Shelley" });
    const transcript = page.getByRole("region", { name: "Messages" });
    const asks = [];
    let threadId;

    await step("setup: a throwaway git repo, and the canned next prompt", async () => {
      mkdirSync(dir, { recursive: true });
      cleanup(() => rmSync(dir, { recursive: true, force: true }));
      writeFileSync(path.join(dir, "a.txt"), "a\n");
      const git = (...args) =>
        execFileSync("git", ["-c", "user.email=v@example.com", "-c", "user.name=v", ...args], {
          cwd: dir,
          stdio: "ignore",
        });
      git("init", "-q");
      git("add", ".");
      git("commit", "-qm", "init");
      cleanup(async () => {
        const all = await api.get("/code/threads");
        for (const t of all.filter((t) => t.cwd === dir)) {
          await api.delete(`/code/threads/${encodeURIComponent(t.id)}`);
        }
      });
    });

    await step("start a thread and let its turn end", async () => {
      await page.goto("/code", { waitUntil: "domcontentloaded" });
      await expect(composer).toBeVisible({ timeout: 20_000 });
      await page.getByRole("button", { name: "Working directory" }).click();
      await page.getByRole("combobox").fill(dir);
      await page.getByRole("combobox").press("Enter");
      await composer.fill(`echo: Added the retry ${stamp}. Want me to run the tests?`);
      await page.getByRole("button", { name: "Start" }).click();
      await expect(page).toHaveURL(/\/code\/shelley%3A/, { timeout: 20_000 });
      threadId = decodeURIComponent(new URL(page.url()).pathname.split("/").pop());
      await expect(
        transcript.getByText(`Added the retry ${stamp}.`, { exact: false }).last(),
      ).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByRole("button", { name: "Stop Shelley" })).toHaveCount(0);
    });

    await step("the server's own answer with no model: no suggestion", async () => {
      const snapshot = await api.get(`/code/threads/${encodeURIComponent(threadId)}`);
      const after = snapshot.items.at(-1).id;
      const answer = await api.get(
        `/code/threads/${encodeURIComponent(threadId)}/next-prompt?after=${encodeURIComponent(after)}`,
      );
      expect(answer).toEqual({ text: null });
    });

    await step("reopen: the composer asks once and offers the suggestion", async () => {
      await context.route("**/api/v1/code/threads/*/next-prompt?*", (route) => {
        asks.push(new URL(route.request().url()).searchParams.get("after"));
        return route.fulfill({ json: { success: true, data: { text: SUGGESTION } } });
      });
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(composer).toHaveAttribute("placeholder", SUGGESTION, { timeout: 15_000 });
      await expect(page.getByTestId("code-composer-hint")).toHaveText(
        "Tab uses the suggestion · Esc dismisses it",
      );
      expect(asks).toHaveLength(1);
    });
    await proof("suggested");

    await step("Tab fills it in", async () => {
      await composer.click();
      await composer.press("Tab");
      await expect(composer).toHaveValue(SUGGESTION);
    });
    await proof("tab-filled");

    await step("cleared, then Esc dismisses it for this turn", async () => {
      await composer.fill("");
      await expect(composer).toHaveAttribute("placeholder", SUGGESTION);
      await composer.press("Escape");
      await expect(composer).toHaveAttribute("placeholder", "Send a message…");
      await expect(page.getByTestId("code-composer-hint")).toHaveCount(0);
      expect(asks).toHaveLength(1);
    });
    await proof("dismissed");

    await step("a phone: the suggestion with a Use button", async () => {
      const phone = await context.browser().newContext({
        ...devices["Pixel 7"],
        baseURL: new URL(page.url()).origin,
        storageState: await context.storageState(),
      });
      cleanup(() => phone.close());
      await phone.route("**/api/v1/code/threads/*/next-prompt?*", (route) =>
        route.fulfill({ json: { success: true, data: { text: SUGGESTION } } }),
      );
      const p = await phone.newPage();
      await p.goto(`/code/${encodeURIComponent(threadId)}`, { waitUntil: "domcontentloaded" });
      const box = p.getByRole("textbox", { name: "Message Shelley" });
      await expect(box).toHaveAttribute("placeholder", SUGGESTION, { timeout: 15_000 });
      await p.screenshot({
        path: path.join(process.env.TA_VERIFY_EVIDENCE, "code-next-prompt", "phone-suggested.png"),
      });
      await p.getByRole("button", { name: "Use the suggested message" }).tap();
      await expect(box).toHaveValue(SUGGESTION);
    });
  },
  { requires: ["shelley"] },
);
