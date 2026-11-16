// Feature: code-extras (features/code-extras.md). The /code workspace beyond the basic
// turn (journeys/code.mjs), on the keyless predictable Shelley (`ta-verify up --shelley`):
// the folder browser, a new git worktree, the thread list's repository groups, the composer chips
// (model, reasoning; no permissions on Shelley), `/` command hints, `@` file completion,
// skills for a message, attachments (an image and a text file) and how they render
// (asset route), the usage popover, fork, change directory, the queued messages'
// Send now / Cancel buttons, and the refusal's "Try another model" recovery.
//
// Shelley runs on the HOST: every thread works in a throwaway git repo under
// data/verify/<run>/work-<stamp> (and its worktree, a sibling `work-<stamp>-<date>`);
// uploads land in the host's /tmp/shelley-uploads under stamped names. All removed.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { journey, expect } from "../scripts/lib.mjs";

// The full load event can wait on a third-party embed; the SPA is usable at DOMContentLoaded.
const LOADED = { waitUntil: "domcontentloaded" };
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// A valid 1x1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

await journey(
  "code-extras",
  async ({ page, step, proof, cleanup, api, stamp }) => {
    const run = process.env.TA_VERIFY_RUN;
    const dir = path.join(process.cwd(), "data", "verify", run, `work-${stamp}`);
    const short = `…/${run}/work-${stamp}`;
    const composer = page.getByRole("textbox", { name: "Message Shelley" });
    const transcript = page.getByRole("region", { name: "Messages" });
    const list = page.getByRole("navigation", { name: "Code threads" });
    const stop = page.getByRole("button", { name: "Stop Shelley" });
    const image = `shot-${stamp}.png`;
    const notes = `notes-${stamp}.txt`;
    const notesBody = `notes for ${stamp}\n`;
    let worktree; // the new worktree's path, from the harness
    const ours = (t) =>
      t.cwd && (t.cwd === dir || t.cwd.startsWith(`${dir}/`) || (worktree && t.cwd === worktree));
    const threads = async (view) =>
      (await api.get(`/code/threads${view ? `?view=${view}` : ""}`)).filter(ours);
    const snapshot = (id) => api.get(`/code/threads/${encodeURIComponent(id)}`);
    const idOf = () => decodeURIComponent(new URL(page.url()).pathname.split("/").pop());
    const reply = (text) => transcript.getByText(text, { exact: true });
    const posted = (suffix, method = "POST") =>
      page.waitForResponse(
        (r) => r.request().method() === method && new URL(r.url()).pathname.endsWith(suffix),
        { timeout: 30_000 },
      );
    let mainId;
    let wtId;

    await step("setup: a throwaway git repo (a sub-folder, a stamped file)", async () => {
      mkdirSync(path.join(dir, "sub"), { recursive: true });
      cleanup(() => rmSync(dir, { recursive: true, force: true }));
      writeFileSync(path.join(dir, "a.txt"), "a\n");
      writeFileSync(path.join(dir, `alpha-${stamp}.txt`), "alpha\n");
      writeFileSync(path.join(dir, "sub", "keep.txt"), "sub\n");
      const git = (...args) =>
        execFileSync("git", ["-c", "user.email=v@example.com", "-c", "user.name=verify", ...args], {
          cwd: dir,
          stdio: "ignore",
        });
      git("init", "-q");
      git("add", ".");
      git("commit", "-qm", `init ${stamp}`);
      // The worktree (if one is made) goes before the repo it belongs to.
      cleanup(() => {
        if (!worktree || !worktree.startsWith(`${dir}-`)) return;
        try {
          execFileSync("git", ["-C", dir, "worktree", "remove", "--force", worktree], {
            stdio: "ignore",
          });
        } catch {
          // already gone: the directory removal below covers it
        }
        rmSync(worktree, { recursive: true, force: true });
      });
      // Uploads land on the host under these stamped names.
      cleanup(() => {
        for (const name of [image, notes])
          rmSync(path.join("/tmp/shelley-uploads", name), { force: true });
      });
      // Every thread in these directories (forks and the worktree's too), archived ones too.
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
    });

    // ---- new thread: folder browser, worktree ---------------------------------------
    await step("folder browser: Browse folders… lists the repo, opens sub, goes up", async () => {
      await page.goto("/code/new", LOADED);
      await expect(composer).toBeVisible({ timeout: 20_000 });
      await page.getByRole("button", { name: "Working directory" }).click();
      await page.getByRole("combobox").fill(dir);
      await page.getByRole("combobox").press("Enter");
      await expect(page.getByRole("button", { name: "Working directory" })).toHaveText(short);
      await page.getByRole("button", { name: "Working directory" }).click();
      const listed = posted("/code/harnesses/shelley/directories", "GET");
      await page.getByRole("option", { name: "Browse folders…" }).click();
      const dialog = page.getByRole("dialog", { name: "Choose a working directory" });
      await expect(dialog).toBeVisible();
      expect((await listed).status()).toBe(200);
      await expect(dialog.getByText(`${dir} · git`, { exact: true })).toBeVisible();
      // Hidden folders (.git) are not offered; files are not listed.
      await expect(dialog.getByRole("button", { name: ".git" })).toHaveCount(0);
      await dialog.getByRole("button", { name: "sub", exact: true }).click();
      await expect(dialog.getByText(`${dir}/sub · git`, { exact: true })).toBeVisible();
      await expect(dialog.getByText("No folders here.")).toBeVisible();
      await proof("folder-browser");
      await dialog.getByRole("button", { name: "..", exact: true }).click();
      await expect(dialog.getByText(`${dir} · git`, { exact: true })).toBeVisible();
      await dialog.getByRole("button", { name: "Use this folder" }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Working directory" })).toHaveText(short);
    });

    await step("New worktree: Start makes a git worktree and the thread works in it", async () => {
      const toggle = page.getByRole("button", { name: "New worktree" });
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-pressed", "true");
      const created = posted("/code/harnesses/shelley/worktrees");
      await composer.fill(`echo: wt-${stamp}`);
      await page.getByRole("button", { name: "Start" }).click();
      const res = await created;
      expect(res.status()).toBe(201);
      worktree = (await res.json()).data.path;
      expect(worktree.startsWith(`${dir}-`)).toBe(true);
      await expect(page).toHaveURL(/\/code\/shelley%3A/, { timeout: 20_000 });
      wtId = idOf();
      await expect(reply(`wt-${stamp}`)).toBeVisible({ timeout: 30_000 });
      // A second view: git lists the worktree; the thread's directory is it.
      const worktrees = execFileSync("git", ["-C", dir, "worktree", "list", "--porcelain"], {
        encoding: "utf8",
      });
      expect(worktrees).toContain(`worktree ${worktree}`);
      expect(existsSync(path.join(worktree, "a.txt"))).toBe(true);
      await expect
        .poll(async () => (await threads()).find((t) => t.id === wtId)?.cwd, { timeout: 20_000 })
        .toBe(worktree);
    });
    await proof("worktree-thread");

    await step(
      "a second thread in the repo itself (directory remembered, no worktree)",
      async () => {
        // `exact`: each list group also has a "New thread in <label>" link.
        await page.getByRole("link", { name: "New thread", exact: true }).click();
        await expect(page.getByRole("button", { name: "Working directory" })).toHaveText(short);
        await expect(page.getByRole("button", { name: "New worktree" })).toHaveAttribute(
          "aria-pressed",
          "false",
        );
        await composer.fill(`echo: main-${stamp}`);
        await page.getByRole("button", { name: "Start" }).click();
        await expect(page).toHaveURL(/\/code\/shelley%3A/, { timeout: 20_000 });
        mainId = idOf();
        expect(mainId).not.toBe(wtId);
        await expect(reply(`main-${stamp}`)).toBeVisible({ timeout: 30_000 });
        await expect
          .poll(async () => (await threads()).find((t) => t.id === mainId)?.cwd, {
            timeout: 20_000,
          })
          .toBe(dir);
      },
    );
    await step("setup: stamp both thread titles (predictable titles them all alike)", async () => {
      await api.post(`/code/threads/${encodeURIComponent(mainId)}/rename`, {
        title: `main-${stamp}`,
      });
      await api.post(`/code/threads/${encodeURIComponent(wtId)}/rename`, { title: `wt-${stamp}` });
      await expect(list.getByRole("link", { name: new RegExp(`^main-${stamp}`) })).toBeVisible({
        timeout: 20_000,
      });
      await expect(list.getByRole("link", { name: new RegExp(`^wt-${stamp}`) })).toBeVisible();
    });

    await step(
      "repository groups: the repo and its worktree each list their own thread",
      async () => {
        // A folder group is named by its basename: `work-<stamp>` is a prefix of the
        // worktree's `work-<stamp>-<date>`, so match exactly.
        const wtLabel = path.basename(worktree);
        const repoGroup = list.getByRole("region", { name: `work-${stamp}`, exact: true });
        const wtGroup = list.getByRole("region", { name: wtLabel, exact: true });
        await expect(repoGroup).toBeVisible({ timeout: 20_000 });
        await expect(
          repoGroup.getByRole("link", { name: new RegExp(`^main-${stamp}`) }),
        ).toBeVisible();
        await expect(repoGroup.getByRole("link", { name: new RegExp(`^wt-${stamp}`) })).toHaveCount(
          0,
        );
        await expect(wtGroup.getByRole("link", { name: new RegExp(`^wt-${stamp}`) })).toBeVisible();
        await expect(
          wtGroup.getByRole("link", { name: `New thread in ${wtLabel}`, exact: true }),
        ).toHaveAttribute("href", `/code/new?cwd=${encodeURIComponent(worktree)}`);
        // Folding the worktree's group hides its thread and leaves the repo's.
        const fold = wtGroup.getByRole("button", { name: wtLabel, exact: true });
        await fold.click();
        await expect(fold).toHaveAttribute("aria-expanded", "false");
        await expect(list.getByRole("link", { name: new RegExp(`^wt-${stamp}`) })).toHaveCount(0);
        await expect(list.getByRole("link", { name: new RegExp(`^main-${stamp}`) })).toBeVisible();
        await proof("repo-groups");
        await fold.click();
        await expect(fold).toHaveAttribute("aria-expanded", "true");
        await expect(list.getByRole("link", { name: new RegExp(`^wt-${stamp}`) })).toBeVisible();
      },
    );

    // ---- composer chips -------------------------------------------------------------
    await step("Reasoning chip → High: saved on the thread, survives a reload", async () => {
      const saved = posted(`/code/threads/${encodeURIComponent(mainId)}/settings`);
      await page.getByRole("button", { name: "Reasoning" }).click();
      await page.getByRole("option", { name: /^High/ }).click();
      const res = await saved;
      expect(res.request().postDataJSON()).toEqual({ effort: "high" });
      expect(res.status()).toBe(200);
      await expect(page.getByText("Takes effect on the next turn")).toBeVisible();
      expect((await snapshot(mainId)).settings.effort).toBe("high");
      await page.reload(LOADED);
      await expect(page.getByRole("button", { name: "Reasoning" })).toContainText("High", {
        timeout: 20_000,
      });
    });
    await step("Model chip lists the harness's models; picking one saves it", async () => {
      const saved = posted(`/code/threads/${encodeURIComponent(mainId)}/settings`);
      await page.getByRole("button", { name: "Model" }).click();
      const option = page.getByRole("option", { name: /^predictable/ });
      await expect(option).toBeVisible();
      await option.click();
      const res = await saved;
      expect(res.request().postDataJSON()).toEqual({ model: "predictable" });
      expect(res.status()).toBe(200);
      expect((await snapshot(mainId)).settings.model).toBe("predictable");
      // Shelley enforces no permission mode, so no Permissions chip is offered.
      await expect(page.getByTestId("code-permission")).toHaveCount(0);
    });

    // ---- composer completion --------------------------------------------------------
    await step("`/` lists Shelley's commands with hints; Enter inserts one", async () => {
      await composer.fill("/fo");
      const commands = page.getByRole("listbox", { name: "Commands" });
      await expect(commands).toBeVisible();
      await expect(
        commands.getByRole("option", { name: /\/fork.*copy of this conversation/ }),
      ).toBeVisible();
      await proof("slash-commands");
      await composer.press("Enter");
      await expect(composer).toHaveValue("/fork ");
      await expect(commands).toHaveCount(0);
      await composer.fill("");
    });
    await step(
      "`@` completes a file from the thread's directory; the reply echoes it",
      async () => {
        const found = posted("/code/harnesses/shelley/find-files", "GET");
        await composer.fill("echo: see @alph");
        const files = page.getByRole("listbox", { name: "Files" });
        await expect(files.getByRole("option", { name: `alpha-${stamp}.txt` })).toBeVisible({
          timeout: 15_000,
        });
        expect(new URL((await found).url()).searchParams.get("dir")).toBe(dir);
        await proof("at-files");
        await composer.press("Enter");
        await expect(composer).toHaveValue(`echo: see @alpha-${stamp}.txt `);
        await composer.press("Enter");
        await expect(reply(`see @alpha-${stamp}.txt`)).toBeVisible({ timeout: 30_000 });
      },
    );
    await step(
      "+ menu: Skills for this message; a picked skill goes with the message",
      async () => {
        const skillsLoaded = posted("/code/harnesses/shelley/skills", "GET");
        await page.getByRole("button", { name: "Add files or skills" }).click();
        const menu = page.getByRole("menu");
        await expect(menu.getByText("Skills for this message")).toBeVisible();
        expect((await skillsLoaded).status()).toBe(200);
        const skill = menu.getByRole("menuitemcheckbox").first();
        await expect(skill).toBeVisible({ timeout: 15_000 });
        const skillName = (await skill.locator("span span").first().textContent()).trim();
        await skill.click();
        await expect(skill).toHaveAttribute("aria-checked", "true");
        await proof("skills-menu");
        await page.keyboard.press("Escape");
        await expect(page.getByRole("button", { name: `Remove skill ${skillName}` })).toBeVisible();
        const sent = posted(`/code/threads/${encodeURIComponent(mainId)}/messages`);
        await composer.fill(`echo: skill-${stamp}`);
        await composer.press("Enter");
        const body = (await sent).request().postDataJSON();
        expect(body.skills).toEqual([skillName]);
        await expect(page.getByRole("button", { name: `Remove skill ${skillName}` })).toHaveCount(
          0,
        );
        await expect(transcript.getByText(`echo: skill-${stamp}`)).toBeVisible({ timeout: 30_000 });
      },
    );

    // ---- attachments and assets ----------------------------------------------------
    await step("attachments: an image and a text file upload as chips, then send", async () => {
      await page.getByRole("button", { name: "Add files or skills" }).click();
      const chooser = page.waitForEvent("filechooser");
      await page.getByRole("menuitem", { name: /Add files or images/ }).click();
      const uploads = [];
      const onUpload = (r) => {
        if (r.request().method() === "POST" && r.url().includes("/code/uploads/shelley"))
          uploads.push(r);
      };
      page.on("response", onUpload);
      await (
        await chooser
      ).setFiles([
        { name: image, mimeType: "image/png", buffer: PNG },
        { name: notes, mimeType: "text/plain", buffer: Buffer.from(notesBody) },
      ]);
      await expect(page.getByRole("button", { name: `Remove ${image}` })).toBeVisible();
      await expect(page.getByRole("button", { name: `Remove ${notes}` })).toBeVisible();
      await expect.poll(() => uploads.length, { timeout: 30_000 }).toBe(2);
      page.off("response", onUpload);
      for (const r of uploads) expect(r.status()).toBe(201);
      await proof("attachments-chips");
      // Shelley keeps uploads on its machine (here, the host).
      expect(readFileSync(path.join("/tmp/shelley-uploads", notes), "utf8")).toBe(notesBody);
      const sent = posted(`/code/threads/${encodeURIComponent(mainId)}/messages`);
      await composer.fill(`echo: att-${stamp}`);
      await composer.press("Enter");
      const body = (await sent).request().postDataJSON();
      expect(body.attachments).toEqual([
        `file:/tmp/shelley-uploads/${image}`,
        `file:/tmp/shelley-uploads/${notes}`,
      ]);
      await expect(page.getByRole("button", { name: `Remove ${image}` })).toHaveCount(0);
    });
    await step(
      "the message shows the image inline and the file as a link (asset route)",
      async () => {
        const img = transcript.getByRole("img", { name: image });
        await expect(img).toBeVisible({ timeout: 30_000 });
        await expect
          .poll(() => img.evaluate((el) => el.complete && el.naturalWidth), { timeout: 15_000 })
          .toBe(1);
        const src = await img.getAttribute("src");
        expect(src).toContain("/api/v1/code/harnesses/shelley/asset?ref=");
        const imgRes = await page.request.get(src);
        expect(imgRes.status()).toBe(200);
        expect(imgRes.headers()["content-type"]).toMatch(/image\/png/);
        expect(Buffer.compare(await imgRes.body(), PNG)).toBe(0);
        const link = transcript.getByRole("link", { name: notes });
        await expect(link).toBeVisible();
        const fileRes = await page.request.get(await link.getAttribute("href"));
        expect(fileRes.status()).toBe(200);
        expect(await fileRes.text()).toBe(notesBody);
        // The user bubble hides the upload tokens the composer appends (the predictable
        // echo reply repeats them verbatim, so only the bubble is checked).
        await expect(transcript.getByText(`echo: att-${stamp}`, { exact: true })).toBeVisible();
        await expect(reply(`att-${stamp}`)).toBeVisible({ timeout: 30_000 });
      },
    );
    await proof("attachments-rendered");

    // ---- usage ---------------------------------------------------------------------
    await step("usage popover: the context ring opens Context usage", async () => {
      const ring = page.getByRole("button", { name: /^Context \d+% full\. Usage$/ });
      await expect(ring).toBeVisible({ timeout: 20_000 });
      const usage = posted(`/code/threads/${encodeURIComponent(mainId)}/usage`, "GET");
      await ring.click();
      const popup = page.getByRole("dialog", { name: "Context usage" });
      await expect(popup).toBeVisible();
      expect((await usage).status()).toBe(200);
      await expect(popup.getByRole("heading", { name: "Context usage" })).toBeVisible();
      await expect(popup.getByText(/tokens/).first()).toBeVisible();
      await expect(popup.getByText(/Total|No usage data yet\./).first()).toBeVisible({
        timeout: 15_000,
      });
      await expect(popup.getByRole("button", { name: "Compact in Place" })).toBeVisible();
      await proof("usage-popover");
      await page.keyboard.press("Escape");
      await expect(popup).toHaveCount(0);
    });

    // ---- fork ----------------------------------------------------------------------
    let forkId;
    await step("Fork from here on a message opens a copy of the thread", async () => {
      const first = transcript.getByText(`echo: main-${stamp}`, { exact: true });
      await first.hover();
      const forked = posted(`/code/threads/${encodeURIComponent(mainId)}/fork`);
      await transcript.getByRole("button", { name: "Fork from here" }).first().click();
      const res = await forked;
      expect(res.status()).toBe(201);
      forkId = (await res.json()).data.threadId;
      await expect(page).toHaveURL(new RegExp(`/code/${escape(encodeURIComponent(forkId))}$`), {
        timeout: 20_000,
      });
      expect(forkId).not.toBe(mainId);
      await expect(transcript.getByText(`echo: main-${stamp}`, { exact: true })).toBeVisible({
        timeout: 20_000,
      });
      // Second view: the fork is its own thread in the same directory; the original is intact.
      await expect
        .poll(async () => (await threads()).find((t) => t.id === forkId)?.cwd, { timeout: 20_000 })
        .toBe(dir);
      const original = await snapshot(mainId);
      expect(JSON.stringify(original.items)).toContain(`att-${stamp}`);
    });
    await proof("forked");

    // ---- change directory ----------------------------------------------------------
    await step("Change directory: a missing path is refused, the dialog stays", async () => {
      await page.goto(`/code/${encodeURIComponent(mainId)}`, LOADED);
      await expect(page.getByTestId("code-title")).toHaveText(`main-${stamp}`, { timeout: 20_000 });
      await page.getByRole("button", { name: /: thread actions$/ }).click();
      await page.getByRole("menuitem", { name: "Change directory" }).click();
      const dialog = page.getByRole("dialog", { name: "Change working directory" });
      const field = dialog.getByRole("textbox", { name: "Change working directory" });
      await expect(field).toHaveValue(dir);
      await field.fill(`/nonexistent-${stamp}`);
      await dialog.getByRole("button", { name: "Change" }).click();
      await expect(page.getByText(/does not exist/)).toBeVisible();
      await expect(dialog).toBeVisible();
      expect((await snapshot(mainId)).thread.cwd).toBe(dir);
    });
    await step("Change directory to sub: the thread's tools now run there", async () => {
      const dialog = page.getByRole("dialog", { name: "Change working directory" });
      await dialog.getByRole("textbox", { name: "Change working directory" }).fill(`${dir}/sub`);
      await dialog.getByRole("button", { name: "Change" }).click();
      await expect(dialog).toHaveCount(0);
      await expect
        .poll(async () => (await snapshot(mainId)).thread.cwd, { timeout: 15_000 })
        .toBe(`${dir}/sub`);
      await composer.fill(`bash: pwd > pwd-${stamp}.txt`);
      await composer.press("Enter");
      await expect(transcript.getByText("Done.").last()).toBeVisible({ timeout: 30_000 });
      await expect
        .poll(() => existsSync(path.join(dir, "sub", `pwd-${stamp}.txt`)), { timeout: 15_000 })
        .toBe(true);
      expect(readFileSync(path.join(dir, "sub", `pwd-${stamp}.txt`), "utf8").trim()).toBe(
        `${dir}/sub`,
      );
    });
    await proof("cwd-changed");

    // ---- queued: Send now / Cancel -------------------------------------------------
    await step("queue two messages behind a long turn", async () => {
      await composer.fill("delay: 45");
      await composer.press("Enter");
      await expect(stop).toBeVisible({ timeout: 15_000 });
      for (const word of ["later", "dropped"]) {
        await composer.fill(`echo: ${word}-${stamp}`);
        await composer.press("Alt+Enter");
        await expect(page.getByTestId("code-queued")).toContainText(`${word}-${stamp}`);
      }
      await expect(page.getByTestId("code-queued").getByRole("listitem")).toHaveCount(2);
      expect((await snapshot(mainId)).queued).toHaveLength(2);
    });
    await proof("queued-two");
    await step("Cancel queued message removes it before it runs", async () => {
      const row = page
        .getByTestId("code-queued")
        .getByRole("listitem")
        .filter({
          hasText: `dropped-${stamp}`,
        });
      const cancelled = page.waitForResponse(
        (r) => r.request().method() === "POST" && /\/queued\/[^/]+\/cancel$/.test(r.url()),
      );
      await row.getByRole("button", { name: "Cancel queued message" }).click();
      expect((await cancelled).status()).toBe(200);
      await expect(row).toHaveCount(0);
      await expect
        .poll(async () => (await snapshot(mainId)).queued.map((q) => q.text))
        .toEqual([`echo: later-${stamp}`]);
    });
    await step("Send now interrupts the turn and runs the queued message at once", async () => {
      const startedAt = Date.now();
      const row = page
        .getByTestId("code-queued")
        .getByRole("listitem")
        .filter({
          hasText: `later-${stamp}`,
        });
      const sentNow = page.waitForResponse(
        (r) => r.request().method() === "POST" && /\/queued\/[^/]+\/send$/.test(r.url()),
      );
      await row.getByRole("button", { name: "Send now" }).click();
      expect((await sentNow).status()).toBe(200);
      await expect(reply(`later-${stamp}`)).toBeVisible({ timeout: 25_000 });
      // Well before the 45 s delay would have ended.
      expect(Date.now() - startedAt).toBeLessThan(30_000);
      await expect(page.getByTestId("code-queued")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Send" })).toBeVisible({ timeout: 20_000 });
      await expect(transcript.getByText(`dropped-${stamp}`)).toHaveCount(0);
      expect((await snapshot(mainId)).queued).toHaveLength(0);
    });
    await proof("queued-sent-now");

    // ---- recovery --------------------------------------------------------------------
    await step(
      "a refusal offers Try another model; clicking it asks Shelley to continue (it has no other model)",
      async () => {
        await composer.fill("refusal");
        await composer.press("Enter");
        await expect(transcript.getByText(/The model declined to continue/)).toBeVisible({
          timeout: 30_000,
        });
        const button = transcript.getByRole("button", { name: "Try another model" });
        await expect(button).toBeVisible();
        await proof("refusal");
        const recovered = posted(`/code/threads/${encodeURIComponent(mainId)}/recover`);
        await button.click();
        const res = await recovered;
        expect(res.request().postDataJSON()).toEqual({ action: "continue" });
        // Predictable-only Shelley has no fallback model, so it refuses; the app says why.
        expect(res.status()).toBeGreaterThanOrEqual(400);
        await expect(page.getByText(/Unknown or unavailable model/)).toBeVisible();
      },
    );
    await proof("recover-continue");
  },
  { requires: ["shelley"] },
);
