# Account and app shell

The frame around every signed-in page: a sidebar with the account button (initial + name) whose menu holds the set-up pages, Settings, Send feedback and Log out; a ⌘K palette; light/dark/system themes from Settings or the palette; a sidebar that collapses to an icon rail and stays collapsed; and on phones a drawer opened from each page's menu button, with Back buttons on detail pages. Settings also holds the People tab (guests); the Claude plan lives in its account card under Models.

## Sub-features

- `shell-account-menu` lists Routines, Skills, Memory, Connections, Vault, Settings, Send feedback, Log out; the open page is `aria-current="page"` in the menu; the tab title follows the page (`Memory · tiny-agents`).
- `shell-feedback` opens the FeedbackBee panel `Tell us more` (or toasts `Feedback isn't available right now` when the embed did not load).
- `shell-palette` opens with Ctrl/⌘+K or `Search`, filters, navigates and closes.
- `shell-theme` switches Light/Dark/System from Settings → General → Appearance (`aria-pressed`) or the palette's Theme group (`Dark ✓`); persists across reload (`localStorage["groot.theme"]`, `dark` class on `<html>`).
- `shell-collapse` collapses the sidebar to a rail (`Collapse sidebar` / `Expand sidebar`), persisted across reload.
- `shell-settings-tabs` lists the Settings tabs; there is no Claude plan tab, and `?tab=claude` lands on Models.
- `shell-people` adds a guest (Settings → People) and removes it after confirming.
- `shell-phone` at 390x844: sidebar off-canvas, `Open menu` opens the drawer with the set-up pages listed directly, a drawer link navigates and closes it, detail pages show `Back`, the Settings tab strip scrolls.

## How to get to it (user POV)

- Account menu: the `Account and navigation` button at the bottom of the sidebar.
- Palette: `Search` (top of the sidebar) or Ctrl+K / ⌘K.
- Settings tabs: `General`, `Models`, `Notifications`, `Security`, `People`.
- Phone: `Open menu` at the top of each page; detail pages (vault item, new vault item, skill, connection, credential request) show `Back` instead.

## Driving it with ta-verify

Preconditions:

- Baseline run, doctor OK, signed in as demo (account name `Demo User`). Theme and collapse live in the drive's browser storage, so nothing needs restoring.

- **Account menu.** Account button contains `Demo User`; menu has the eight items. `Memory` → `/memory`, title `Memory · tiny-agents`; reopen: menuitem `Memory` has `aria-current="page"`; Escape.
- **Feedback.** Menu → `Send feedback` → dialog `Tell us more` with textbox `Your feedback`; `Close` (never send). Without the embed: the toast.
- **Palette.** Ctrl+K → dialog `Command Menu`; type `Tasks`; option `Tasks` → `/tasks`, palette closed. Expected exactly one `Tasks` option.
- **Theme.** `/settings`, group `Theme` → `Light`: `aria-pressed=true`, no `dark` class, stored `light`; reload keeps it. `Search` → option `Dark` → `dark` class, stored `dark`, Settings shows `Dark` pressed; reopen palette: option `Dark ✓`.
- **Collapse.** `Collapse sidebar` → `Expand sidebar` shown, `Demo User` hidden, link `Tasks` has `title="Tasks"`; reload: still collapsed; `Expand sidebar` restores.
- **Settings tabs.** Tabs are exactly `General`, `Models`, `Notifications`, `Security`, `People`; `/settings?tab=claude` selects `Models`.
- **People.** Tab `People`: `Name`, `Email`, `Password` → `Add guest`; toast `Guest added`; `guest-row` with the email and `No bots shared`. `Remove <name>` → alertdialog `Remove` → row gone; `GET /api/v1/people` no longer has it.
- **Phone.** Viewport 390x844, `/tasks`: complementary `Sidebar` out of viewport; `Open menu` → in viewport with links Routines…Vault, no `Collapse sidebar`. Link `Routines` → `/routines`, drawer closed. `/vault/new/login`: no `Open menu`; `Back` (exact) → `/vault`, `Open menu` back. `/settings`: tabs `People` and `General` both selectable.
- **Proof.** `ta-verify drive $S/journeys/account-shell.mjs` → `account-shell/account-menu`, `feedback-panel`, `theme-light`, `theme-dark`, `sidebar-rail`, `settings-tabs`, `guest-added`, `phone-drawer`, `phone-back`, `phone-settings`.

## Gotchas

- Regression check for #166 (fixed 2026-11): the palette used to list every destination twice (the shell's Navigation group plus the app's own). The step `⌘K palette lists each destination once` asserts one.
- There is no profile page or profile editing: the account button shows the name (or email) and initial; identity is set at setup or by the admin API.
- `getByRole("button", { name: "Back" })` also matches the FeedbackBee launcher `Feedback`; use `exact: true`. The embed is third-party (feedbackbee.nesin.workers.dev): a slow fetch can delay the page `load` event of any journey.
- Claude Code sign-in (`Sign in to Claude`, `Check again`) is unreachable: it needs a sandbox (`up --sandbox`) with Claude Code installed and a real Claude subscription login.
- Logging in as a guest (the guest shell) is not covered here.
