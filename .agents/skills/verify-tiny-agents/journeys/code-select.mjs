// Feature: code-select (features/code-select.md). Select mode on the Code thread
// list (`ta-verify up --shelley`): pick two of three threads, Archive them in one
// go, Undo brings both back, archive again, then Restore both from Archived.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { journey, expect } from "../scripts/lib.mjs";

await journey(
  "code-select",
  async ({ page, step, proof, cleanup, api, stamp }) => {
    const dir = path.join(
      process.cwd(),
      "data",
      "verify",
      process.env.TA_VERIFY_RUN,
      `select-${stamp}`,
    );
    const list = page.getByRole("navigation", { name: "Code threads" });
    const bar = page.getByRole("toolbar", { name: "Selected threads" });
    const threads = async (view) =>
      (await api.get(`/code/threads${view ? `?view=${view}` : ""}`)).filter((t) => t.cwd === dir);
    const rowLink = (title) => list.getByRole("link", { name: new RegExp(`^${title}\\b`) });
    const ids = async (view) => (await threads(view)).map((t) => t.id).sort();
    let picked;
    let kept;

    await step("setup: three finished Shelley threads in a throwaway repo", async () => {
      mkdirSync(dir, { recursive: true });
      cleanup(() => rmSync(dir, { recursive: true, force: true }));
      writeFileSync(path.join(dir, "a.txt"), "a\n");
      const git = (...args) =>
        execFileSync("git", ["-c", "user.email=v@example.com", "-c", "user.name=verify", ...args], {
          cwd: dir,
          stdio: "ignore",
        });
      git("init", "-q");
      git("add", ".");
      git("commit", "-qm", `init ${stamp}`);
      cleanup(async () => {
        await expect
          .poll(
            async () => {
              const left = [...(await threads()), ...(await threads("archived"))];
              for (const t of left) await api.delete(`/code/threads/${encodeURIComponent(t.id)}`);
              return left.length;
            },
            { timeout: 30_000, intervals: [2_000] },
          )
          .toBe(0);
      });
      const rows = [];
      for (const n of [1, 2, 3]) {
        const { threadId } = await api.post("/code/threads", {
          instanceId: "shelley",
          message: `echo: select-${n}-${stamp}`,
          cwd: dir,
          model: "predictable",
        });
        rows.push({ id: threadId, title: `sel-${n}-${stamp}` });
      }
      await expect
        .poll(async () => (await threads()).filter((t) => !t.working).length, {
          timeout: 60_000,
          intervals: [2_000],
        })
        .toBe(3);
      for (const t of rows) {
        await api.post(`/code/threads/${encodeURIComponent(t.id)}/rename`, { title: t.title });
      }
      await expect
        .poll(async () => (await threads()).map((t) => t.title).sort(), { timeout: 15_000 })
        .toEqual(rows.map((t) => t.title).sort());
      picked = rows.slice(0, 2);
      kept = rows[2];
    });

    await step("Select turns the rows into checkboxes", async () => {
      await page.goto("/code");
      for (const t of [...picked, kept])
        await expect(rowLink(t.title)).toBeVisible({ timeout: 20_000 });
      await page.getByRole("button", { name: "Select threads" }).click();
      await expect(bar).toBeVisible();
      await expect(bar.getByText("Select threads")).toBeVisible();
      await expect(list.getByRole("button", { name: `Archive ${kept.title}` })).toHaveCount(0);
      for (const t of picked)
        await list.getByRole("checkbox", { name: `Select ${t.title}` }).click();
      await expect(bar.getByText("2 selected")).toBeVisible();
      await expect(list.getByRole("checkbox", { name: `Select ${kept.title}` })).not.toBeChecked();
    });
    await proof("selected");

    await step("Archive moves both picked threads; the third stays", async () => {
      await bar.getByRole("button", { name: "Archive" }).click();
      await expect(page.getByText("Archived 2 threads")).toBeVisible({ timeout: 15_000 });
      await expect(bar).toHaveCount(0);
      for (const t of picked) await expect(rowLink(t.title)).toHaveCount(0, { timeout: 15_000 });
      await expect(rowLink(kept.title)).toBeVisible();
      await expect
        .poll(() => ids("archived"), { timeout: 15_000 })
        .toEqual(picked.map((t) => t.id).sort());
      await expect.poll(() => ids(), { timeout: 15_000 }).toEqual([kept.id]);
    });
    await proof("archived");

    await step("one Undo brings both back", async () => {
      await page.getByRole("button", { name: "Undo" }).click();
      await expect
        .poll(() => ids(), { timeout: 15_000 })
        .toEqual([...picked, kept].map((t) => t.id).sort());
      expect(await ids("archived")).toEqual([]);
      await page.reload();
      for (const t of picked) await expect(rowLink(t.title)).toBeVisible({ timeout: 20_000 });
    });
    await proof("undone");

    await step("archive both again, then Restore both from the Archived view", async () => {
      await page.getByRole("button", { name: "Select threads" }).click();
      for (const t of picked)
        await list.getByRole("checkbox", { name: `Select ${t.title}` }).click();
      await bar.getByRole("button", { name: "Archive" }).click();
      await expect.poll(() => ids("archived"), { timeout: 15_000 }).toHaveLength(2);
      await page.getByRole("radio", { name: "Archived" }).click();
      for (const t of picked) await expect(rowLink(t.title)).toBeVisible({ timeout: 15_000 });
      await page.getByRole("button", { name: "Select threads" }).click();
      await bar.getByRole("button", { name: "Select all" }).click();
      await expect(bar.getByText("2 selected")).toBeVisible();
      await proof("archived-view-selected");
      await bar.getByRole("button", { name: "Restore" }).click();
      await expect(page.getByText("Restored 2 threads")).toBeVisible({ timeout: 15_000 });
      for (const t of picked) await expect(rowLink(t.title)).toHaveCount(0, { timeout: 15_000 });
      await expect
        .poll(() => ids(), { timeout: 15_000 })
        .toEqual([...picked, kept].map((t) => t.id).sort());
      expect(await ids("archived")).toEqual([]);
    });
    await proof("restored");
  },
  { requires: ["shelley"] },
);
