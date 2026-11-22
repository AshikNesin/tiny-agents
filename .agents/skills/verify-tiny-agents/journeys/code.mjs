// Feature: code (features/code.md). The Code workspace on the demo agent and the fake
// GitHub (`ta-verify up --demo-agent --fake-github`): the status-grouped list, moving by
// key, a streamed turn, steer, queue, stop, the Changes and Pull request panes, the key
// list and the command palette.
import { journey, expect } from "../scripts/lib.mjs";

const LOADED = { waitUntil: "domcontentloaded" };

await journey(
  "code",
  async ({ page, step, proof, cleanup, api, stamp }) => {
    let project;
    const ids = {};
    const threads = () => api.get("/code/threads");
    const row = (id) => page.locator(`[data-thread="${id}"]`);
    const section = (name) =>
      page.getByRole("navigation", { name: "Threads" }).getByRole("region", { name });
    const composer = page.getByRole("textbox", { name: "Message Demo agent" });
    const transcript = page.getByTestId("code-transcript");
    const working = (id) => threads().then((all) => all.find((t) => t.id === id)?.working);
    const on = (id) => expect(page).toHaveURL(new RegExp(`/code/t/${encodeURIComponent(id)}$`));
    const reason = (id) => threads().then((all) => all.find((t) => t.id === id)?.status?.reason);

    await step("setup: a project and three threads, one of them slow", async () => {
      project = await api.post("/code/projects", {
        repo: "acme/web",
        name: `web-${stamp}`,
        defaultInstanceId: "demo",
      });
      cleanup(() => api.delete(`/code/projects/${project.id}`));
      cleanup(async () => {
        for (const id of Object.values(ids)) {
          await api.delete(`/code/threads/${encodeURIComponent(id)}`);
        }
      });
      const start = async (message) =>
        (await api.post("/code/threads", { instanceId: "demo", projectId: project.id, message }))
          .threadId;
      ids.first = await start(`Note the release ${stamp} and commit it`);
      await expect.poll(() => working(ids.first), { timeout: 30_000 }).toBe(false);
      ids.second = await start(`Write the changelog ${stamp}`);
      await expect.poll(() => working(ids.second), { timeout: 30_000 }).toBe(false);
      ids.slow = await start(`slow: tidy the README ${stamp}`);
      expect(ids.first).not.toContain(":");
    });

    await step(
      "the list groups by status: finished turns need you, the slow one works",
      async () => {
        await page.goto("/code", LOADED);
        await expect(section("Needs you").locator(row(ids.first))).toBeVisible({ timeout: 20_000 });
        await expect(section("Needs you").locator(row(ids.second))).toBeVisible();
        await expect(section("Working").locator(row(ids.slow))).toBeVisible();
      },
    );
    await proof("list");

    await step("j opens the first thread in the list; reading it moves it to Done", async () => {
      await expect(row(ids.first)).toContainText("finished");
      await page.keyboard.press("j");
      const first = await page
        .getByRole("navigation", { name: "Threads" })
        .locator("[data-thread]")
        .first()
        .getAttribute("data-thread");
      await on(first);
      await expect(transcript.getByText(/^Done\. I noted/)).toBeVisible({ timeout: 20_000 });
      await expect(section("Done").locator(row(first))).toBeVisible({ timeout: 10_000 });
    });

    await step("u jumps to the next thread that needs you", async () => {
      await page.keyboard.press("u");
      await expect(page).toHaveURL(/\/code\/t\//);
      await expect(section("Needs you")).toHaveCount(0, { timeout: 10_000 });
    });

    await step("open the working thread: its tool call streams", async () => {
      await row(ids.slow).click();
      await on(ids.slow);
      await expect(transcript.getByText("ls", { exact: true }).first()).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.getByTestId("code-composer-hint")).toHaveText(
        "Enter steers · Alt+Enter queues · Esc stops",
      );
    });

    await step("c then Enter steers the running turn; Alt+Enter queues", async () => {
      await page.keyboard.press("c");
      await expect(composer).toBeFocused();
      await page.keyboard.type(`steer-${stamp}`);
      await page.keyboard.press("Enter");
      await expect(transcript.getByText(`steer-${stamp}`, { exact: true })).toBeVisible();
      expect(await working(ids.slow)).toBe(true);
      await page.keyboard.type(`later-${stamp}`);
      await page.keyboard.press("Alt+Enter");
      await expect(page.getByTestId("code-queued")).toContainText(`later-${stamp}`);
    });
    await proof("steer-and-queue");

    await step("cancel the queued message, then Escape twice stops the agent", async () => {
      await page.getByRole("button", { name: "Cancel queued message" }).click();
      await expect(page.getByTestId("code-queued")).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(composer).not.toBeFocused();
      await page.keyboard.press("Escape");
      await expect.poll(() => working(ids.slow), { timeout: 15_000 }).toBe(false);
      await expect(transcript.getByText("Stopped.")).toBeVisible();
    });
    await proof("stopped");

    await step("1 shows the branch's changes beside the thread", async () => {
      await row(ids.first).click();
      await on(ids.first);
      await page.keyboard.press("1");
      const pane = page.getByTestId("code-pane");
      await expect(page.getByRole("tab", { name: /^Changes/ })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await expect(pane.getByText("NOTES.md").first()).toBeVisible({ timeout: 20_000 });
      await expect(pane.getByText(`Note the release ${stamp}`).first()).toBeVisible();
    });
    await proof("changes");

    await step("2 shows the pull request pane: one commit ahead, ready to publish", async () => {
      await page.keyboard.press("2");
      const pane = page.getByTestId("code-pane");
      await expect(pane.getByText(/is 1 commit ahead of main/)).toBeVisible({ timeout: 20_000 });
      await expect(pane.getByRole("button", { name: /Publish/ })).toBeVisible();
    });

    await step("backslash hides the pane and brings it back; [ hides the list", async () => {
      await page.keyboard.press("\\");
      await expect(page.getByTestId("code-pane")).toHaveCount(0);
      await page.keyboard.press("\\");
      await expect(page.getByRole("tab", { name: /^Pull request/ })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await page.keyboard.press("[");
      await expect(page.getByRole("complementary", { name: "Threads" })).toBeHidden();
      await page.keyboard.press("[");
      await expect(page.getByRole("complementary", { name: "Threads" })).toBeVisible();
    });

    await step(
      "3 opens Files: p finds a file by name, s searches, an edit saves and shows in Changes",
      async () => {
        await page.keyboard.press("p");
        const files = page.getByTestId("code-files");
        await expect(files.getByRole("textbox", { name: "Open a file by name" })).toBeFocused();
        await page.keyboard.type("notes");
        await page.keyboard.press("Enter");
        await expect(files.getByText("Editing NOTES.md, saved to the worktree")).toBeVisible({
          timeout: 20_000,
        });
        await page.keyboard.press("Escape");
        await page.keyboard.press("s");
        await page.keyboard.type(`release ${stamp}`);
        await page.keyboard.press("Enter");
        await expect(files.getByTestId("code-files-list")).toContainText("NOTES.md", {
          timeout: 20_000,
        });
        const saved = await api.put(`/code/threads/${encodeURIComponent(ids.first)}/review/file`, {
          path: "NOTES.md",
          original: `- Note the release ${stamp} and commit it\n`,
          content: `- Note the release ${stamp} and commit it\n- edited by hand ${stamp}\n`,
        });
        expect(saved.saved).toBe(true);
        await page.keyboard.press("Escape");
        await page.keyboard.press("1");
        await expect(
          page.getByTestId("code-pane").getByText(`edited by hand ${stamp}`).first(),
        ).toBeVisible({ timeout: 20_000 });
      },
    );
    await proof("files");

    await step("backtick opens a terminal in the thread's worktree", async () => {
      const frames = [];
      page.on("websocket", (ws) => {
        if (!ws.url().includes("/api/v1/terminal/ws/")) return;
        ws.on("framereceived", (f) =>
          frames.push(typeof f.payload === "string" ? f.payload : f.payload.toString("utf8")),
        );
      });
      await page.keyboard.press("`");
      const terminal = page.getByTestId("code-terminal");
      await expect(terminal).toHaveAttribute("data-state", "live", { timeout: 30_000 });
      await terminal.click();
      await page.keyboard.type(`echo "t$((6*7))-${stamp}" && git branch --show-current`);
      await page.keyboard.press("Enter");
      await expect.poll(() => frames.join(""), { timeout: 20_000 }).toContain(`t42-${stamp}`);
      expect(frames.join("")).toMatch(/ta\/note-release/);
      const sessions = (await api.get("/terminal/sessions")).sessions.map((s) => s.name);
      cleanup(async () => {
        for (const name of sessions) await api.delete(`/terminal/sessions/${name}?force=1`);
      });
      await page.getByRole("button", { name: "Hide the terminal" }).click();
      await expect(terminal).toHaveCount(0);
    });
    await proof("terminal");

    await step("? lists the keys; the palette runs the same commands", async () => {
      await page.keyboard.press("?");
      const keys = page.getByTestId("code-keys");
      await expect(keys).toContainText("Next thread that needs you");
      await expect(keys).toContainText("Stop the agent");
      await page.keyboard.press("Escape");
      await expect(keys).toHaveCount(0);
      await page.keyboard.press("ControlOrMeta+k");
      const palette = page.getByRole("dialog");
      await palette.getByRole("combobox").fill("Changes");
      await palette.getByRole("option", { name: /^Changes/ }).click();
      await expect(page.getByRole("tab", { name: /^Changes/ })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });
    await proof("pane-and-keys");

    await step(
      "n opens the new thread dialog; Enter starts a thread on its own branch",
      async () => {
        await page.keyboard.press("Escape");
        await page.keyboard.press("n");
        const dialog = page.getByTestId("code-new-thread");
        await dialog.getByTestId("code-new-message").fill(`Add a changelog entry ${stamp}`);
        await page.keyboard.press("Enter");
        await expect(dialog).toHaveCount(0, { timeout: 30_000 });
        await expect(page).toHaveURL(/\/code\/t\/[a-z0-9]+$/);
        ids.dialog = decodeURIComponent(new URL(page.url()).pathname.split("/").pop());
        await expect(page.getByTestId("code-branch")).toContainText("ta/", { timeout: 20_000 });
        await expect(transcript.getByText(/^Done\. I noted/)).toBeVisible({ timeout: 30_000 });
      },
    );

    await step("t runs the last turn again from the files as they were before it", async () => {
      await expect.poll(() => working(ids.dialog), { timeout: 20_000 }).toBe(false);
      await composer.fill(`second note ${stamp}`);
      await composer.press("Enter");
      await expect(transcript.getByText(/^Done\. I noted "second note/)).toBeVisible({
        timeout: 30_000,
      });
      await expect.poll(() => working(ids.dialog), { timeout: 20_000 }).toBe(false);
      await page.keyboard.press("Escape");
      await page.keyboard.press("t");
      await expect(page.getByText(/Went back to before that turn, files included/)).toBeVisible({
        timeout: 20_000,
      });
      await expect(transcript.getByText(`second note ${stamp}`, { exact: true })).toHaveCount(1);
      await expect.poll(() => working(ids.dialog), { timeout: 30_000 }).toBe(false);
      await page.keyboard.press("1");
      const notes = page.getByTestId("code-pane").getByText(`second note ${stamp}`);
      await expect(notes).toHaveCount(1, { timeout: 20_000 });
    });
    await proof("rewound");

    await step("a failed turn puts the thread under Needs you as failed", async () => {
      await expect.poll(() => working(ids.dialog), { timeout: 20_000 }).toBe(false);
      await composer.fill("fail on purpose");
      await composer.press("Enter");
      await expect.poll(() => reason(ids.dialog), { timeout: 20_000 }).toBe("failed");
    });
    await proof("new-thread");

    await step("an old thread link still opens the thread", async () => {
      await page.goto(`/code/${encodeURIComponent(ids.second)}/pr`, LOADED);
      await on(ids.second);
      await expect(page.getByRole("tab", { name: /^Pull request/ })).toHaveAttribute(
        "aria-selected",
        "true",
        { timeout: 20_000 },
      );
    });
  },
  { requires: ["demo-agent", "fake-github", "local-sandbox"] },
);
