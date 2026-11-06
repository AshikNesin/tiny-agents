// Feature: code (features/code.md). /code with the Shelley harness on its keyless
// predictable model (`ta-verify up --shelley`): working-directory validation, a new
// thread, streamed reply, steer, queue, stop, rename + /code/s/<title>, Changes, the
// thread list (Working now / Recent / unread / search / Archived + restore) and a
// bot hand-off (`/code cwd=<dir> <task>` on the faux model).
//
// That Shelley runs on the HOST, so every thread works in a throwaway git repo under
// data/verify/<run>/work-<stamp>, never the checkout or $HOME. Predictable prompts:
// `echo: X` answers X, `delay: N` works N seconds, `bash: CMD` runs CMD in the cwd.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { journey, expect } from "../scripts/lib.mjs";

// The full load event can wait on a third-party embed; the SPA is usable at DOMContentLoaded.
const LOADED = { waitUntil: "domcontentloaded" };

await journey(
  "code",
  async ({ page, step, proof, cleanup, api, stamp }) => {
    const dir = path.join(
      process.cwd(),
      "data",
      "verify",
      process.env.TA_VERIFY_RUN,
      `work-${stamp}`,
    );
    const short = `…/${process.env.TA_VERIFY_RUN}/work-${stamp}`;
    const title = `verify-${stamp}`;
    const composer = page.getByRole("textbox", { name: "Message Shelley" });
    const transcript = page.getByRole("region", { name: "Messages" });
    const list = page.getByRole("navigation", { name: "Code threads" });
    const stop = page.getByRole("button", { name: "Stop Shelley" });
    const threads = async (view) =>
      (await api.get(`/code/threads${view ? `?view=${view}` : ""}`)).filter((t) => t.cwd === dir);
    const idOf = () => decodeURIComponent(new URL(page.url()).pathname.split("/").pop());
    let mainId;

    await step("setup: a throwaway git repo for Shelley to work in", async () => {
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
      // Every thread started in it (UI or bot) is deleted, archived ones too.
      cleanup(async () => {
        // The thread list lags a new thread by a few seconds: delete whatever is
        // listed until nothing in this directory is left.
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
    });

    await step(
      "open Code from the sidebar: Shelley composer with the predictable model",
      async () => {
        await page
          .getByRole("navigation", { name: "Primary" })
          .getByRole("link", { name: "Code" })
          .click();
        await expect(page).toHaveURL(/\/code(\/new)?$/);
        await expect(composer).toBeVisible({ timeout: 20_000 });
        await expect(page.getByRole("button", { name: "Model" })).toHaveText(/predictable/);
        // One harness configured: no harness picker (that needs Claude Code as well).
        await expect(page.getByTestId("code-harness")).toHaveCount(0);
      },
    );

    await step("working directory: a missing path is rejected by the harness", async () => {
      await page.getByRole("button", { name: "Working directory" }).click();
      await page.getByRole("combobox").fill(`/nonexistent-${stamp}`);
      await page.getByRole("combobox").press("Enter");
      await expect(page.getByRole("alert")).toHaveText(/does not exist/);
    });
    await proof("cwd-invalid");
    await step("working directory: the throwaway repo is accepted", async () => {
      await page.getByRole("button", { name: "Working directory" }).click();
      await page.getByRole("combobox").fill(dir);
      await expect(page.getByRole("option", { name: `Use “${dir}”` })).toBeVisible();
      await page.getByRole("combobox").press("Enter");
      await expect(page.getByRole("button", { name: "Working directory" })).toHaveText(short);
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "New worktree" })).toBeEnabled(); // a git repo
    });

    await step("start a thread: it is Working now, the composer steers, Stop shows", async () => {
      await composer.fill("delay: 20");
      await page.getByRole("button", { name: "Start" }).click();
      await expect(page).toHaveURL(/\/code\/shelley%3A/, { timeout: 20_000 });
      mainId = idOf();
      await expect(stop).toBeVisible({ timeout: 15_000 });
      await expect(composer).toHaveAttribute("placeholder", /Steer Shelley/);
      await expect(list.getByRole("heading", { name: "Working now" })).toBeVisible();
      await expect(list.getByRole("status", { name: "Working" }).first()).toBeVisible();
    });
    await step("steer: Enter puts the message into the running turn", async () => {
      await composer.fill(`echo: steer-${stamp}`);
      await composer.press("Enter");
      await expect(transcript.getByText(`echo: steer-${stamp}`)).toBeVisible();
      // Shelley drops the answer to a steer that a queued message follows within
      // ~1 s (upstream behaviour, reproduced on its API alone); give it time to land.
      // 8 s, not less: under load (several runs at once) 4 s still lost the answer.
      // The 20 s delay keeps the turn running long enough to queue behind it.
      await page.waitForTimeout(8_000);
    });
    await step("queue: Alt+Enter holds a message, listed with Send now / Cancel", async () => {
      await composer.fill(`echo: queued-${stamp}`);
      await composer.press("Alt+Enter");
      const queued = page.getByTestId("code-queued");
      await expect(queued).toContainText(`queued-${stamp}`);
      await expect(queued.getByRole("button", { name: "Send now" })).toBeVisible();
      await expect(queued.getByRole("button", { name: "Cancel queued message" })).toBeVisible();
    });
    await proof("working-steer-queue");
    await step(
      "the turn ends: delay reply, the steer answered, then the queued one runs",
      async () => {
        await expect(transcript.getByText("Delayed for 20 seconds")).toBeVisible({
          timeout: 30_000,
        });
        await expect(transcript.getByText(`steer-${stamp}`, { exact: true })).toBeVisible({
          timeout: 30_000,
        });
        await expect(transcript.getByText(`queued-${stamp}`, { exact: true })).toBeVisible({
          timeout: 30_000,
        });
        await expect(page.getByTestId("code-queued")).toHaveCount(0);
        await expect(transcript.getByText(/Worked for \d/).first()).toBeVisible();
        await expect(list.getByRole("heading", { name: "Recent" })).toBeVisible();
      },
    );
    await proof("turn-done");

    await step("a reply streams over the thread's event stream", async () => {
      const events = page.waitForResponse(
        (r) => r.url().includes(`/code/threads/${encodeURIComponent(mainId)}/events`),
        { timeout: 20_000 },
      );
      await page.reload(LOADED); // re-subscribes; the stream starts with a snapshot
      expect((await events).headers()["content-type"]).toMatch(/text\/event-stream/);
      await expect(transcript.getByText(`queued-${stamp}`, { exact: true })).toBeVisible({
        timeout: 20_000,
      });
      await composer.fill(`echo: hello-${stamp}`);
      await composer.press("Enter");
      await expect(transcript.getByText(`hello-${stamp}`, { exact: true })).toBeVisible({
        timeout: 30_000,
      });
    });

    await step("Stop ends a running turn: the turn is cancelled, Send is back", async () => {
      await composer.fill("delay: 60");
      await composer.press("Enter");
      await expect(stop).toBeVisible({ timeout: 15_000 });
      await stop.click();
      await expect(transcript.getByText("[Operation cancelled]")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
      await expect
        .poll(async () => (await threads()).find((t) => t.id === mainId)?.working)
        .toBe(false);
    });
    await proof("stopped");

    await step("rename from thread actions; /code/s/<title> opens it", async () => {
      await page.getByRole("button", { name: /: thread actions$/ }).click();
      await page.getByRole("menuitem", { name: "Rename" }).click();
      const dialog = page.getByRole("dialog", { name: "Rename thread" });
      await dialog.getByRole("textbox", { name: "Rename thread" }).fill(title);
      await dialog.getByRole("button", { name: "Rename" }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByTestId("code-title")).toHaveText(title);
      await expect
        .poll(async () => (await threads()).find((t) => t.id === mainId)?.title)
        .toBe(title);
      await page.goto("/", LOADED);
      await page.goto(`/code/s/${title}`, LOADED);
      await expect(page.getByTestId("code-title")).toHaveText(title, { timeout: 20_000 });
      await expect(transcript.getByText(`hello-${stamp}`, { exact: true })).toBeVisible();
    });

    await step("Changes shows the uncommitted file Shelley wrote, with its diff", async () => {
      await composer.fill(`bash: echo changed-${stamp} > b.txt`);
      await composer.press("Enter");
      await expect(transcript.getByText("Done.").last()).toBeVisible({ timeout: 30_000 });
      await page.getByRole("button", { name: "Changes" }).click();
      const changes = page.getByTestId("code-changes");
      await expect(changes).toBeVisible();
      const file = changes.getByTestId("code-file").filter({ hasText: "b.txt" });
      await expect(file).toBeVisible({ timeout: 20_000 });
      await expect(file).toContainText(`changed-${stamp}`);
      expect(
        execFileSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" }),
      ).toContain("b.txt");
    });
    await proof("changes");
    await step("close Changes", async () => {
      await page.getByRole("button", { name: "Close changes" }).click();
      await expect(page.getByTestId("code-changes")).toHaveCount(0);
    });

    let otherTitle;
    await step("a second thread starts in the same directory (remembered)", async () => {
      await page.getByRole("link", { name: "New thread" }).click();
      // The directory is remembered per harness.
      await expect(page.getByRole("button", { name: "Working directory" })).toHaveText(short);
      await composer.fill("delay: 15");
      await page.getByRole("button", { name: "Start" }).click();
      await expect(page).toHaveURL(/\/code\/shelley%3A/, { timeout: 20_000 });
      const otherId = idOf();
      await expect
        .poll(async () => (otherTitle = (await threads()).find((t) => t.id === otherId)?.title), {
          timeout: 20_000,
        })
        .toBeTruthy();
    });
    await step("it finishes while another thread is open: its row turns unread", async () => {
      await list.getByRole("link", { name: new RegExp(`^${title}`) }).click();
      await expect(page.getByTestId("code-title")).toHaveText(title);
      const row = list.getByRole("listitem").filter({ hasText: otherTitle });
      await expect(row.getByRole("status", { name: "Working" })).toBeVisible();
      await expect(row.getByLabel("Unread")).toBeVisible({ timeout: 30_000 });
      expect((await threads()).find((t) => t.title === otherTitle).unread).toBe(true);
    });
    await proof("unread");

    await step("search threads filters the list by title", async () => {
      await page.getByRole("textbox", { name: "Search threads" }).fill(title);
      await expect(list.getByRole("link", { name: new RegExp(`^${title}`) })).toBeVisible({
        timeout: 15_000,
      });
      await expect(list.getByRole("listitem").filter({ hasText: otherTitle })).toHaveCount(0);
      await page.getByRole("textbox", { name: "Search threads" }).fill("");
    });

    await step("archive a thread from its row; it moves to Archived; restore it", async () => {
      await list.getByRole("button", { name: `Archive ${title}` }).click();
      await expect(list.getByRole("link", { name: new RegExp(`^${title}`) })).toHaveCount(0, {
        timeout: 15_000,
      });
      await expect
        .poll(async () => (await threads("archived")).some((t) => t.id === mainId))
        .toBe(true);
      await page.getByRole("radio", { name: "Archived" }).click();
      await expect(list.getByRole("link", { name: new RegExp(`^${title}`) })).toBeVisible({
        timeout: 15_000,
      });
      await proof("archived");
      await list.getByRole("button", { name: `Restore ${title}` }).click();
      await expect.poll(async () => (await threads()).some((t) => t.id === mainId)).toBe(true);
      await page.getByRole("radio", { name: "Active" }).click();
      await expect(list.getByRole("link", { name: new RegExp(`^${title}`) })).toBeVisible({
        timeout: 15_000,
      });
    });

    // ---- bot hand-off --------------------------------------------------------
    await step("bot hand-off: /code cwd=<dir> starts a Shelley thread from a chat", async () => {
      const name = `Verify Coder ${stamp}`;
      const bot = await api.post("/bots", { name, modelId: "test-model" });
      cleanup(() => api.delete(`/bots/${bot.id}`));
      await page.goto(`/chats/${bot.id}`, LOADED);
      const chat = page.getByPlaceholder(new RegExp(`(?:ask|message) ${name}`, "i"));
      await chat.fill(`/code cwd=${dir} echo: handoff-${stamp}`);
      await chat.press("Enter");
      const log = page.getByRole("region", { name: "Messages" });
      await expect(log.getByRole("link", { name: "Open in Code" })).toBeVisible({
        timeout: 60_000,
      });
      await expect(log.getByText(/Shelley started a thread/)).toBeVisible({ timeout: 60_000 });
      // The outcome arrives once, as a relayed "Reply from Shelley".
      await expect(log.getByText("reply relayed into this chat")).toBeVisible({
        timeout: 60_000,
      });
      await expect(log.getByText(`handoff-${stamp}`, { exact: true }).first()).toBeVisible();
    });
    await proof("handoff");
    await step("Open in Code lands on the handed-off thread", async () => {
      await page
        .getByRole("region", { name: "Messages" })
        .getByRole("link", { name: "Open in Code" })
        .click();
      await expect(page).toHaveURL(/\/code\/shelley%3A/);
      await expect(transcript.getByText(`handoff-${stamp}`, { exact: true })).toBeVisible({
        timeout: 20_000,
      });
      expect((await threads()).some((t) => t.preview === `handoff-${stamp}`)).toBe(true);
    });
  },
  { requires: ["shelley"] },
);
