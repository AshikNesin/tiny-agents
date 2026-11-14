// P11 live proof: deleting a bot releases what it owned. Replays #88 (a deleted bot's
// tab in the shared browser closes, the other bot's tab stays), #173 (an own desktop
// and profile go with the bot, also after the bot switched to the shared browser),
// a delete while the bot is replying, and a second delete from another tab.
import { execFileSync } from "node:child_process";
import { journey, expect, showLiveView } from "../scripts/lib.mjs";

const LOADED = { waitUntil: "domcontentloaded" };
const CONTAINER = process.env.TA_VERIFY_SANDBOX_CONTAINER ?? "tiny-agents-sandbox-sandbox-1";
const vm = (script) => {
  try {
    return execFileSync("docker", ["exec", "-u", "exedev", CONTAINER, "bash", "-c", script], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (error) {
    return String(error.stdout ?? "");
  }
};
const procs = (pattern) =>
  Number(vm(`pgrep -c -f -- '[${pattern[0]}]${pattern.slice(1)}' || true`).trim() || "0");
const exists = (p) => vm(`test -e ${p} && echo yes || echo no`).trim() === "yes";
/** Page targets of the shared Chrome on the VM, through its DevTools port. */
const sharedPages = () => {
  const port = vm(
    "pgrep -af -- '[u]ser-data-dir=[^ ]*browser-profiles/shared' | grep -o 'remote-debugging-port=[0-9]*' | head -1 | cut -d= -f2",
  ).trim();
  if (!port) return -1;
  const list = vm(`curl -s http://127.0.0.1:${port}/json/list`);
  try {
    return JSON.parse(list).filter((t) => t.type === "page").length;
  } catch {
    return -1;
  }
};

await journey(
  "bot-delete",
  async ({ page, step, proof, cleanup, api, stamp }) => {
    const { defaultModelId: defaultModel } = await api.get("/models");
    const make = async (name, extra = {}) => {
      const id = (await api.post("/bots", { name, modelId: defaultModel, ...extra })).id;
      cleanup(async () => {
        if ((await page.request.get(`/api/v1/bots/${id}`)).ok()) await api.delete(`/bots/${id}`);
      });
      return id;
    };
    const deleteInUi = async (p, name) => {
      await p.getByRole("button", { name: `${name} menu` }).click();
      await p.getByRole("menuitem", { name: "Bot settings" }).click();
      const dialog = p.getByRole("dialog", { name: `Edit ${name}` });
      await dialog.getByRole("button", { name: "Delete bot" }).click();
      await expect(dialog.getByText(`Delete ${name}? This cannot be undone.`)).toBeVisible();
      const answer = p.waitForResponse(
        (r) => /\/api\/v1\/bots\/[^/]+$/.test(r.url()) && r.request().method() === "DELETE",
      );
      await dialog.getByRole("button", { name: "Delete bot" }).click();
      return (await answer).status();
    };
    const openBrowser = async (id) => {
      await page.goto(`/chats/${id}`, LOADED);
      const panel = page.getByTestId("browser-panel");
      await showLiveView(page, "browser");
      const open = panel.getByRole("button", { name: "Open browser" });
      await expect(panel.getByText("Live").or(open)).toBeVisible({ timeout: 30_000 });
      // A live shared browser gives the bot its tab without the button, which can vanish mid-click.
      if (await open.isVisible()) await open.click({ timeout: 5_000 }).catch(() => {});
      await expect
        .poll(async () => (await api.get(`/bots/${id}/browser`)).url, { timeout: 120_000 })
        .not.toBeNull();
    };
    const toasts = () => page.locator("[data-sonner-toast]").allInnerTexts();

    // ---- #88: a deleted bot's tab in the shared browser closes, others stay ----
    const keepName = `Keep ${stamp}`;
    const goneName = `Gone ${stamp}`;
    const keep = await make(keepName);
    const gone = await make(goneName);
    await step("#88 setup: two bots each open a tab in the shared browser", async () => {
      await openBrowser(keep);
      await openBrowser(gone);
      await expect.poll(sharedPages, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
    });
    const before = sharedPages();
    await proof("tab-before");
    await step("#88 delete the second bot in its settings", async () => {
      expect(await deleteInUi(page, goneName)).toBe(200);
    });
    await step("#88 its tab closed, the other bot's tab and the shared browser stay", async () => {
      await expect.poll(sharedPages, { timeout: 30_000 }).toBe(before - 1);
      expect((await api.get(`/bots/${keep}/browser`)).url).not.toBeNull();
      expect(procs("user-data-dir=[^ ]*browser-profiles/shared")).toBeGreaterThan(0);
    });
    await page.goto(`/chats/${keep}`, LOADED);
    await proof("tab");

    // ---- #173: own desktop and own browser go with the bot ----
    const ownName = `Own ${stamp}`;
    const own = await make(ownName, { browserProfile: "own" });
    const profile = `bot-${own}`;
    const desktopDir = `~/.tiny-agents/computer-profiles/${profile}`;
    const browserDir = `~/data/browser-profiles/${profile}`;
    await step("#173 setup: an own-profile bot opens its browser and desktop", async () => {
      await openBrowser(own);
      const panel = page.getByTestId("computer-panel");
      await showLiveView(page, "computer");
      await panel.getByRole("button", { name: "Open computer" }).click();
      await expect
        .poll(async () => (await api.get(`/bots/${own}/computer`)).active, { timeout: 120_000 })
        .toBe(true);
      expect(exists(`${desktopDir}/.desktop-env`)).toBe(true);
      expect(procs(`browser-profiles/${profile}`)).toBeGreaterThan(0);
    });
    await step("#173 switch the bot to the shared browser (its own stays behind)", async () => {
      await api.patch(`/bots/${own}`, { browserProfile: "shared" });
      expect(exists(desktopDir)).toBe(true);
    });
    await proof("desktop-before");
    await step("#173 delete the bot in its settings", async () => {
      expect(await deleteInUi(page, ownName)).toBe(200);
    });
    await step("#173 its desktop and browser stopped, both profile folders are gone", async () => {
      expect((await api.get("/computer")).desktops.some((d) => d.profile === profile)).toBe(false);
      await expect.poll(() => procs(`computer-profiles/${profile}`), { timeout: 30_000 }).toBe(0);
      await expect.poll(() => procs(`browser-profiles/${profile}`), { timeout: 30_000 }).toBe(0);
      await expect.poll(() => exists(desktopDir), { timeout: 30_000 }).toBe(false);
      await expect.poll(() => exists(browserDir), { timeout: 30_000 }).toBe(false);
    });
    await page.goto("/computer", LOADED);
    await proof("desktop");

    // ---- a delete while the bot replies, and a second delete from another tab ----
    const busyName = `Busy ${stamp}`;
    const busy = await make(busyName);
    const second = await page.context().newPage();
    const composer = page.getByPlaceholder(`Message ${busyName}`);
    const reply = () =>
      second
        .getByText(/Echo: mid/)
        .last()
        .innerText()
        .catch(() => "");
    await step("mid-turn setup: a long reply streams, a second tab follows the chat", async () => {
      await page.goto(`/chats/${busy}`, LOADED);
      await second.goto(`/chats/${busy}`, LOADED);
      await expect(composer).toBeVisible({ timeout: 30_000 });
      await composer.fill(`mid ${Array.from({ length: 60 }, (_, i) => `w${i}`).join(" ")}`);
      await composer.press("Enter");
      await expect(page.getByRole("button", { name: "Stop generating" })).toBeVisible({
        timeout: 15_000,
      });
      await expect
        .poll(async () => (await reply()).length, { timeout: 30_000 })
        .toBeGreaterThan(12);
    });
    await proof("mid-turn-before");
    await step("mid-turn delete answers 200 and shows no error toast", async () => {
      expect(await deleteInUi(page, busyName)).toBe(200);
      await page.waitForTimeout(2_000);
      expect((await toasts()).filter((t) => /error|fail|not found|404/i.test(t))).toEqual([]);
    });
    await proof("mid-turn");
    await step("the reply stopped: the other tab's transcript stops growing", async () => {
      const at = (await reply()).length;
      await second.waitForTimeout(5_000);
      expect((await reply()).length).toBe(at);
    });
    await step("a second delete from the other tab answers 404", async () => {
      await second.screenshot({ path: `${process.env.TA_VERIFY_EVIDENCE}/bot-delete/twice.png` });
      expect((await second.request.delete(`/api/v1/bots/${busy}`)).status()).toBe(404);
    });
    await second.close();
  },
  { requires: ["sandbox"] },
);
