// Feature: account-shell (features/account-shell.md). Account menu, ⌘K palette, theme switching
// (settings, palette), sidebar collapse to a rail (persisted), guests (People tab), the Claude
// plan card's no-sandbox state, and the phone layout (drawer nav, back buttons).
import { journey, expect } from "../scripts/lib.mjs";

await journey("account-shell", async ({ page, step, proof, cleanup, api, stamp }) => {
  const guestName = `Verify Guest ${stamp}`;
  const guestEmail = `guest-${stamp}@example.com`;
  const sidebar = page.getByRole("complementary", { name: "Sidebar" });
  const account = page.getByRole("button", { name: "Account and navigation" });
  const isDark = () => page.evaluate(() => document.documentElement.classList.contains("dark"));
  const storedTheme = () => page.evaluate(() => localStorage.getItem("groot.theme"));
  // A product bug fails the drive at the end but lets the rest of the recipe run.
  const bugs = [];
  const bugStep = async (name, body) => {
    try {
      await step(name, body);
    } catch {
      bugs.push(name);
      await proof(`bug-${bugs.length}`);
    }
  };

  await step("account button shows who is signed in", async () => {
    await expect(account).toContainText("Demo User");
    await expect(account).toContainText("D");
  });
  await step("account menu lists the set-up pages, Settings, feedback and Log out", async () => {
    await account.click();
    const menu = page.getByRole("menu");
    for (const name of ["Routines", "Skills", "Memory", "Connections", "Vault", "Settings"]) {
      await expect(menu.getByRole("menuitem", { name })).toBeVisible();
    }
    await expect(menu.getByRole("menuitem", { name: "Send feedback" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Log out" })).toBeVisible();
  });
  await proof("account-menu");
  await step("a menu page opens and is marked current in the menu", async () => {
    await page.getByRole("menuitem", { name: "Memory" }).click();
    await expect(page).toHaveURL(/\/memory$/);
    await expect(page).toHaveTitle("Memory · tiny-agents");
    await account.click();
    await expect(page.getByRole("menuitem", { name: "Memory" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await page.keyboard.press("Escape");
  });
  await step("Send feedback opens the FeedbackBee panel (closed without sending)", async () => {
    await account.click();
    await page.getByRole("menuitem", { name: "Send feedback" }).click();
    // Third-party embed loaded from feedbackbee.nesin.workers.dev; without it the app toasts.
    const panel = page.getByRole("dialog", { name: "Tell us more" });
    const unavailable = page.getByText("Feedback isn't available right now");
    await expect(panel.or(unavailable)).toBeVisible();
    if (await panel.isVisible()) {
      await expect(panel.getByRole("textbox", { name: "Your feedback" })).toBeVisible();
      await proof("feedback-panel");
      await panel.getByRole("button", { name: "Close" }).click();
      await expect(panel).toBeHidden();
    } else {
      await proof("feedback-unavailable");
    }
  });
  await step("⌘K palette opens (Ctrl+K) and filters", async () => {
    await page.keyboard.press("Control+k");
    const palette = page.getByRole("dialog", { name: "Command Menu" });
    await expect(palette).toBeVisible();
    await palette.getByRole("combobox").fill("Tasks");
    await expect(palette.getByRole("option", { name: "Tasks" }).first()).toBeVisible();
  });
  // PRODUCT BUG (reported): the shell adds a Navigation group from ShellConfig.nav and the app
  // adds its own, so every destination is listed twice.
  await bugStep("⌘K palette lists each destination once", async () => {
    await expect(page.getByRole("dialog").getByRole("option", { name: "Tasks" })).toHaveCount(1, {
      timeout: 2000,
    });
  });
  await step("choosing a palette entry navigates and closes it", async () => {
    const palette = page.getByRole("dialog", { name: "Command Menu" });
    await palette.getByRole("option", { name: "Tasks" }).first().click();
    await expect(page).toHaveURL(/\/tasks$/);
    await expect(palette).toHaveCount(0);
  });
  await step("theme: Settings → General → Appearance switches and persists", async () => {
    await page.goto("/settings");
    const theme = page.getByRole("group", { name: "Theme" });
    await theme.getByRole("button", { name: "Light" }).click();
    await expect(theme.getByRole("button", { name: "Light" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(await isDark()).toBe(false);
    expect(await storedTheme()).toBe("light");
    await page.reload();
    await expect(
      page.getByRole("group", { name: "Theme" }).getByRole("button", { name: "Light" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(await isDark()).toBe(false);
  });
  await proof("theme-light");
  await step("theme: the palette's Theme group switches to Dark (marked ✓)", async () => {
    await page.getByRole("button", { name: "Search" }).click();
    const palette = page.getByRole("dialog");
    await palette.getByRole("option", { name: "Dark", exact: true }).click();
    expect(await isDark()).toBe(true);
    expect(await storedTheme()).toBe("dark");
    await expect(
      page.getByRole("group", { name: "Theme" }).getByRole("button", { name: "Dark" }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.getByRole("dialog").getByRole("option", { name: "Dark ✓" })).toBeVisible();
    await page.keyboard.press("Escape");
  });
  await proof("theme-dark");
  await step("sidebar collapses to an icon rail, persists across reload, expands", async () => {
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
    await expect(sidebar.getByText("Demo User")).toBeHidden();
    await expect(sidebar.getByRole("link", { name: "Tasks" })).toHaveAttribute("title", "Tasks");
    await page.reload();
    await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  });
  await proof("sidebar-rail");
  await step("expand the sidebar again", async () => {
    await page.getByRole("button", { name: "Expand sidebar" }).click();
    await expect(page.getByRole("button", { name: "Collapse sidebar" })).toBeVisible();
    await expect(sidebar.getByText("Demo User")).toBeVisible();
  });
  await step("Claude plan tab: engine off, no sandbox, no sign-in button", async () => {
    await page.getByRole("tab", { name: "Claude plan" }).click();
    const panel = page.getByRole("tabpanel", { name: "Claude plan" });
    await expect(panel).toContainText("The engine is off. Set CLAUDE_CODE_ENGINE_ENABLED=1");
    await expect(panel.getByTestId("claude-plan-account")).toHaveText(
      "No sandbox is configured. Set SANDBOX_HOST, or run pnpm sandbox:up for a local one.",
    );
    await expect(panel.getByTestId("claude-plan-sign-in")).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "Check again" })).toHaveCount(0);
  });
  await proof("claude-plan");
  await step("People tab: add a guest", async () => {
    await page.getByRole("tab", { name: "People" }).click();
    const panel = page.getByRole("tabpanel", { name: "People" });
    await panel.getByLabel("Name").fill(guestName);
    await panel.getByLabel("Email").fill(guestEmail);
    await panel.getByLabel("Password").fill(`pw-${stamp}`); // gitleaks:allow (throwaway test password)
    await panel.getByRole("button", { name: "Add guest" }).click();
    cleanup(async () => {
      const guests = await api.get("/people");
      const g = (guests.people ?? guests).find?.((p) => p.email === guestEmail);
      if (g) await api.delete(`/people/${g.id}`);
    });
    await expect(page.getByText("Guest added")).toBeVisible();
    await expect(panel.getByTestId("guest-row").filter({ hasText: guestEmail })).toContainText(
      "No bots shared",
    );
  });
  await proof("guest-added");
  await step("People tab: remove the guest after confirming", async () => {
    await page.getByRole("button", { name: `Remove ${guestName}` }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Remove" }).click();
    await expect(page.getByTestId("guest-row").filter({ hasText: guestEmail })).toHaveCount(0);
    expect(JSON.stringify(await api.get("/people"))).not.toContain(guestEmail);
  });
  await step("phone (390x844): sidebar hidden, Open menu opens the drawer", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/tasks");
    await expect(sidebar).not.toBeInViewport();
    await page.getByRole("button", { name: "Open menu" }).click();
    await expect(sidebar).toBeInViewport();
    // The drawer surfaces the account-menu pages directly (issue #127).
    for (const name of ["Routines", "Skills", "Memory", "Connections", "Vault"]) {
      await expect(sidebar.getByRole("link", { name })).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "Collapse sidebar" })).toBeHidden();
  });
  await proof("phone-drawer");
  await step("phone: a drawer link navigates and closes the drawer", async () => {
    await sidebar.getByRole("link", { name: "Routines" }).click();
    await expect(page).toHaveURL(/\/routines$/);
    await expect(sidebar).not.toBeInViewport();
  });
  await step("phone: a detail page shows Back instead of the menu button", async () => {
    await page.goto("/vault/new/login");
    await expect(page.getByRole("button", { name: "Open menu" })).toHaveCount(0);
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page).toHaveURL(/\/vault$/);
    await expect(page.getByRole("button", { name: "Open menu" })).toBeVisible();
  });
  await proof("phone-back");
  await step("phone: Settings tabs stay reachable (scrollable strip)", async () => {
    await page.goto("/settings");
    await page.getByRole("tab", { name: "Claude plan" }).click();
    await expect(page.getByRole("tabpanel", { name: "Claude plan" })).toBeVisible();
    await page.getByRole("tab", { name: "General" }).click();
    await expect(page.getByRole("tabpanel", { name: "General" })).toBeVisible();
  });
  await proof("phone-settings");
  if (bugs.length) throw new Error(`product bug(s): ${bugs.join("; ")}`);
});
