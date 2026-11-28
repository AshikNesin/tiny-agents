// Feature: account-shell (features/account-shell.md). Account menu, ⌘K palette, theme switching
// (settings, palette), sidebar collapse to a rail (persisted), guests (Settings → People), the Claude
// plan card's no-sandbox state, and the phone layout (drawer nav, back buttons).
import { journey, expect } from "../scripts/lib.mjs";

await journey("account-shell", async ({ page, step, proof, cleanup, api, stamp }) => {
  const guestName = `Verify Guest ${stamp}`;
  const guestEmail = `guest-${stamp}@example.com`;
  const sidebar = page.getByRole("complementary", { name: "Sidebar" });
  const account = page.getByRole("button", { name: "Account and navigation" });
  const isDark = () => page.evaluate(() => document.documentElement.classList.contains("dark"));
  const storedTheme = () => page.evaluate(() => localStorage.getItem("groot.theme"));
  const sections = page.getByRole("navigation", { name: "Settings sections" });
  // The settings screen's own content column, inside the app's main.
  const content = page.getByRole("main").getByRole("main");
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
    // Third-party embed loaded from feedbackbee.nesin.io; without it the app toasts.
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
    const palette = page.getByRole("dialog", { name: "Command menu" });
    await expect(palette).toBeVisible();
    await palette.getByRole("combobox").fill("Tasks");
    await expect(palette.getByRole("option", { name: "Tasks" }).first()).toBeVisible();
  });
  // Regression check for #166: the shell used to add its Navigation group from
  // ShellConfig.nav next to the app's own, listing every destination twice.
  await bugStep("⌘K palette lists each destination once", async () => {
    await expect(page.getByRole("dialog").getByRole("option", { name: "Tasks" })).toHaveCount(1, {
      timeout: 2000,
    });
  });
  await step("choosing a palette entry navigates and closes it", async () => {
    const palette = page.getByRole("dialog", { name: "Command menu" });
    await palette.getByRole("option", { name: "Tasks" }).first().click();
    await expect(page).toHaveURL(/\/tasks$/);
    await expect(palette).toHaveCount(0);
  });
  await step("theme: Settings → Appearance switches and persists", async () => {
    await page.goto("/settings/appearance");
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
    // Settings is a full page with its own chrome: the app sidebar lives elsewhere.
    await page.goto("/tasks");
    await sidebar.getByRole("button", { name: "Search" }).click();
    await page
      .getByRole("dialog")
      .getByRole("option", { name: /Toggle sidebar/ })
      .click();
    await expect(sidebar.getByText("Demo User")).toBeHidden();
    await expect(sidebar.getByRole("link", { name: "Tasks" })).toHaveAttribute("title", "Tasks");
    await page.reload();
    await expect(sidebar.getByText("Demo User")).toBeHidden();
  });
  await proof("sidebar-rail");
  await step("expand the sidebar again with Ctrl+B", async () => {
    await page.keyboard.press("Control+b");
    await expect(sidebar.getByText("Demo User")).toBeVisible();
  });
  await step(
    "Settings sections: the Claude plan lives in Models, not a section of its own",
    async () => {
      await page.goto("/settings");
      await expect(page).toHaveURL(/\/settings\/account$/);
      await expect(sections.getByRole("link")).toHaveText([
        "Account",
        "Appearance",
        "Security",
        "Models",
        "Notifications",
        "People",
        "Configuration",
        "Updates",
      ]);
    },
  );
  await proof("settings-sections");
  await step("Settings → People: add a guest", async () => {
    await sections.getByRole("link", { name: "People" }).click();
    await expect(page).toHaveURL(/\/settings\/people$/);
    const panel = content;
    await panel.getByLabel("Name", { exact: true }).fill(guestName);
    await panel.getByLabel("Email", { exact: true }).fill(guestEmail);
    await panel.getByLabel("Password", { exact: true }).fill(`pw-${stamp}`); // gitleaks:allow (throwaway test password)
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
  await step("Settings → People: remove the guest after confirming", async () => {
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
    // The drawer matches the desktop sidebar (#234): primary pages and bots;
    // Routines, Skills, ... stay in the account menu.
    for (const name of ["Tasks", "Terminal", "Computer", "Browser"]) {
      await expect(sidebar.getByRole("link", { name })).toBeVisible();
    }
    await expect(sidebar.getByRole("link", { name: "Routines" })).toHaveCount(0);
  });
  await proof("phone-drawer");
  await step("phone: a drawer link navigates and closes the drawer", async () => {
    await sidebar.getByRole("link", { name: "Terminal" }).click();
    await expect(page).toHaveURL(/\/terminal$/);
    await expect(sidebar).not.toBeInViewport();
  });
  await step("phone: the drawer's account menu opens the secondary pages", async () => {
    await page.getByRole("button", { name: "Open menu" }).click();
    await account.click();
    await page.getByRole("menuitem", { name: "Routines" }).click();
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
  await step("phone: Settings sections stay reachable (scrollable strip)", async () => {
    await page.goto("/settings");
    await sections.getByRole("link", { name: "People" }).click();
    await expect(content.getByRole("heading", { name: "People", level: 1 })).toBeVisible();
    await sections.getByRole("link", { name: "Account" }).click();
    await expect(content.getByRole("heading", { name: "Account", level: 1 })).toBeVisible();
  });
  await proof("phone-settings");
  if (bugs.length) throw new Error(`product bug(s): ${bugs.join("; ")}`);
});
