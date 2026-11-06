// Feature: shared-bots (features/shared-bots.md). Owner adds a guest in
// Settings → People, shares one bot from its Sharing tab; the guest signs in
// in a second browser context, sees only that bot, chats in the same live
// conversation (messages labeled by sender) and is kept out of owner pages
// and routes. Unsharing hides the bot again; removing the guest deletes the
// account.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { journey, expect } from "../scripts/lib.mjs";

await journey("shared-bots", async ({ page, step, proof, cleanup, api, stamp }) => {
  const shared = `Shared Bot ${stamp}`;
  const privateBot = `Private Bot ${stamp}`;
  const guest = {
    name: `Guest ${stamp}`,
    email: `guest-${stamp}@example.com`,
    password: `guest-pass-${stamp}`,
  };
  const ids = {};
  let guestId;
  let guestPage;
  let guestContext;

  const peopleTab = async () => {
    await page.goto("/settings");
    await page.getByRole("tab", { name: "People" }).click();
  };
  const guestRow = () => page.getByTestId("guest-row").filter({ hasText: guest.email });
  const ownerComposer = page.getByRole("textbox", { name: `Message ${shared}` });
  const editDialog = page.getByRole("dialog", { name: `Edit ${shared}` });
  // proof() captures the owner's page; this does the same for the guest's.
  const guestProof = async (label) => {
    const dir = path.join(process.env.TA_VERIFY_EVIDENCE, "shared-bots");
    await guestPage.screenshot({ path: path.join(dir, `${label}.png`) });
    const aria = await guestPage.locator("body").ariaSnapshot();
    writeFileSync(path.join(dir, `${label}.aria.yml`), `# ${guestPage.url()}\n${aria}\n`);
  };
  const guestApi = async (method, url) =>
    (await guestPage.request.fetch(`/api/v1${url}`, { method })).status();

  await step("setup: create a bot to share and a private bot through the API", async () => {
    for (const name of [shared, privateBot]) {
      const bot = await api.post("/bots", { name, modelId: "test-model" });
      ids[name] = bot.id;
      cleanup(async () => {
        await api.delete(`/bots/${bot.id}`);
        expect((await api.get("/bots")).some((b) => b.id === bot.id)).toBe(false);
      });
    }
  });

  await step("Settings → People: add a guest", async () => {
    await peopleTab();
    // exact: the feedback embed also has an "Email (optional)" field.
    await page.getByRole("textbox", { name: "Name", exact: true }).fill(guest.name);
    await page.getByRole("textbox", { name: "Email", exact: true }).fill(guest.email);
    await page.getByLabel("Password", { exact: true }).fill(guest.password);
    await page.getByRole("button", { name: "Add guest" }).click();
    await expect(page.getByText("Guest added")).toBeVisible();
    await expect(guestRow()).toContainText("No bots shared");
    guestId = (await api.get("/people")).guests.find((g) => g.email === guest.email)?.id;
    expect(guestId, "guest row in GET /people").toBeTruthy();
    cleanup(async () => {
      const left = (await api.get("/people")).guests.some((g) => g.id === guestId);
      if (left) await api.delete(`/people/${guestId}`);
    });
  });
  await proof("guest-added");

  await step("share the bot from Edit bot → Sharing", async () => {
    await page.goto(`/chats/${ids[shared]}`);
    await page.getByRole("button", { name: `Edit ${shared}` }).click({ timeout: 15_000 });
    await editDialog.getByRole("tab", { name: "Sharing" }).click();
    const share = editDialog.getByRole("switch", { name: `Share with ${guest.name}` });
    await expect(share).toHaveAttribute("aria-checked", "false");
    await share.click();
    await expect(share).toHaveAttribute("aria-checked", "true");
    await editDialog.getByRole("button", { name: "Save changes" }).click();
    await expect(editDialog).not.toBeVisible({ timeout: 15_000 });
    await expect(page.getByTitle("Shared chat: everyone in it sees every message")).toBeVisible();
    expect((await api.get(`/bots/${ids[shared]}`)).guestIds).toEqual([guestId]);
  });
  await step("second view: People lists the shared bot for the guest", async () => {
    await peopleTab();
    await expect(guestRow()).toContainText(`Shared: ${shared}`);
  });

  await step("owner says hello in the shared chat", async () => {
    await page.goto(`/chats/${ids[shared]}`);
    await ownerComposer.fill(`owner hello ${stamp}`);
    await ownerComposer.press("Enter");
    await expect(page.getByText(new RegExp(`^Echo: .*owner hello ${stamp}$`)).first()).toBeVisible({
      timeout: 30_000,
    });
  });
  await proof("owner-shared-chat");

  await step("guest signs in in a second browser context", async () => {
    guestContext = await page
      .context()
      .browser()
      .newContext({
        baseURL: new URL(page.url()).origin,
        viewport: { width: 1280, height: 860 },
      });
    cleanup(() => guestContext.close());
    guestPage = await guestContext.newPage();
    // domcontentloaded: the page's third-party feedback embed can hold "load" for 30 s+.
    await guestPage.goto("/login", { waitUntil: "domcontentloaded" });
    await guestPage.getByLabel("Email", { exact: true }).fill(guest.email);
    await guestPage.getByLabel(/password/i).fill(guest.password);
    await guestPage.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect(guestPage).toHaveURL(/\/chats(\/[^/]+)?$/);
  });
  await step("guest sees only the shared bot, and no owner controls", async () => {
    const bots = guestPage.getByRole("region", { name: "Bots" });
    await expect(bots.getByRole("link", { name: new RegExp(`^${shared}`) })).toBeVisible({
      timeout: 15_000,
    });
    await expect(bots.getByRole("link", { name: new RegExp(`^${privateBot}`) })).toHaveCount(0);
    await expect(bots.getByRole("button", { name: "New bot" })).toHaveCount(0);
    await expect(bots.getByRole("button", { name: `${shared} actions` })).toHaveCount(0);
    const nav = guestPage.getByRole("complementary", { name: "Sidebar" });
    // Code is the guest's only page, and it is hidden without a coding agent (verify runs).
    for (const link of ["Tasks", "Terminal", "Computer", "Browser"]) {
      await expect(nav.getByRole("link", { name: link, exact: true })).toHaveCount(0);
    }
  });
  await step("guest opens the shared chat: history visible, sender labeled", async () => {
    await guestPage.goto(`/chats/${ids[shared]}`);
    await expect(guestPage.getByText(`owner hello ${stamp}`).first()).toBeVisible({
      timeout: 15_000,
    });
    // The owner's message is someone else's for the guest: labeled with the sender.
    await expect(
      guestPage.locator(`[data-author="Demo User"]`).filter({ hasText: `owner hello ${stamp}` }),
    ).toBeVisible();
    await expect(guestPage.getByRole("button", { name: shared, exact: true })).toBeDisabled();
    await expect(guestPage.getByRole("button", { name: `Edit ${shared}` })).toHaveCount(0);
    await expect(guestPage.getByTestId("yolo-toggle")).toHaveCount(0);
    await expect(guestPage.getByRole("button", { name: "Start a new chat" })).toHaveCount(0);
  });
  await guestProof("guest-view");
  await step("guest sends: owner sees it live with the guest's name", async () => {
    const composer = guestPage.getByRole("textbox", { name: `Message ${shared}` });
    await composer.fill(`guest hello ${stamp}`);
    await composer.press("Enter");
    await expect(
      page.locator(`[data-author="${guest.name}"]`).filter({ hasText: `guest hello ${stamp}` }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(guest.name, { exact: true }).first()).toBeVisible();
    // Everyone sees the bot's reply to the guest.
    // Anchored: an unanchored regex also matches the whole transcript's text.
    const reply = new RegExp(`^Echo: .*guest hello ${stamp}$`);
    await expect(guestPage.getByText(reply).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(reply).first()).toBeVisible({ timeout: 30_000 });
  });
  await proof("owner-sees-guest");
  await guestProof("guest-chat");

  await step("owner pages redirect a guest to chats; Settings is theirs only", async () => {
    for (const path of ["/tasks", "/memory", "/routines"]) {
      await guestPage.goto(path);
      await expect(guestPage).toHaveURL(/\/chats(\/[^/]+)?$/, { timeout: 15_000 });
    }
    await guestPage.goto("/settings");
    await expect(guestPage.getByText("Your theme and sign-in.")).toBeVisible({ timeout: 15_000 });
    await expect(guestPage.getByRole("tab", { name: "People" })).toHaveCount(0);
  });
  await step("the server refuses a guest's owner-only and unshared routes", async () => {
    expect(await guestApi("GET", "/tasks")).toBe(403);
    expect(await guestApi("GET", "/people")).toBe(403);
    expect(await guestApi("GET", `/bots/${ids[privateBot]}`)).toBe(404);
    expect(await guestApi("PATCH", `/bots/${ids[shared]}`)).toBe(403);
    expect(await guestApi("GET", `/bots/${ids[shared]}`)).toBe(200);
  });

  await step("owner unshares: the bot leaves the guest's sidebar", async () => {
    await page.goto(`/chats/${ids[shared]}`);
    await page.getByRole("button", { name: `Edit ${shared}` }).click({ timeout: 15_000 });
    await editDialog.getByRole("tab", { name: "Sharing" }).click();
    await editDialog.getByRole("switch", { name: `Share with ${guest.name}` }).click();
    await editDialog.getByRole("button", { name: "Save changes" }).click();
    await expect(editDialog).not.toBeVisible({ timeout: 15_000 });
    await guestPage.goto("/chats");
    // The sidebar and the empty chats page can both say it.
    await expect(guestPage.getByText("Nothing shared with you yet.").first()).toBeVisible({
      timeout: 15_000,
    });
    expect(await guestApi("GET", `/bots/${ids[shared]}`)).toBe(404);
  });
  await guestProof("guest-unshared");
  await step("owner removes the guest: account gone, sign-in refused", async () => {
    await peopleTab();
    await guestRow()
      .getByRole("button", { name: `Remove ${guest.name}` })
      .click();
    const confirm = page.getByRole("alertdialog", { name: `Remove ${guest.name}?` });
    await confirm.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(guestRow()).toHaveCount(0);
    await expect
      .poll(async () => (await api.get("/people")).guests.some((g) => g.id === guestId))
      .toBe(false);
    const login = await guestPage.request.post("/api/v1/auth/login", {
      data: { email: guest.email, password: guest.password },
    });
    expect(login.status()).toBe(401);
  });
  await proof("guest-removed");
});
