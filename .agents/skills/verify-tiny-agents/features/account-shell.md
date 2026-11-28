# Account and app shell

The frame around every signed-in page: a sidebar with the account button (initial + name) whose menu holds the set-up pages, Settings, Send feedback and Log out; a ⌘K palette; light/dark/system themes from Settings or the palette; a sidebar that collapses to an icon rail and stays collapsed; and on phones a drawer opened from each page's menu button, with Back buttons on detail pages. Settings is a full page (`/settings/<section>`, its own `Back to tiny-agents` bar, no app sidebar) and also holds People (guests); the Claude plan lives in its account card under Models.

## Sub-features

- `shell-account-menu` lists Routines, Skills, Memory, Connections, Vault, Settings, Send feedback, Log out; the open page is `aria-current="page"` in the menu; the tab title follows the page (`Memory · tiny-agents`).
- `shell-feedback` opens the FeedbackBee panel `Tell us more` (or toasts `Feedback isn't available right now` when the embed did not load).
- `shell-palette` opens with Ctrl/⌘+K or `Search`, filters, navigates and closes.
- `shell-theme` switches Light/Dark/System from Settings → Appearance (`/settings/appearance`, `aria-pressed`) or the palette's Theme group (`Dark ✓`); persists across reload (`localStorage["groot.theme"]`, `dark` class on `<html>`).
- `shell-collapse` collapses the sidebar to a rail (palette `Toggle sidebar` or Ctrl+B; no button), persisted across reload.
- `shell-settings-sections` lists the Settings sections (navigation `Settings sections`); there is no Claude plan section.
- `shell-people` adds a guest (Settings → People) and removes it after confirming.
- `shell-phone` at 390x844: sidebar off-canvas, `Open menu` opens the drawer (the same primary pages and bots as the desktop sidebar; the set-up pages stay in the account menu, #234), a drawer link navigates and closes it, detail pages show `Back`, the Settings sections strip scrolls.

## How to get to it (user POV)

- Account menu: the `Account and navigation` button at the bottom of the sidebar.
- Palette: `Search` (top of the sidebar) or Ctrl+K / ⌘K.
- Settings sections: `Account`, `Appearance`, `Security`, `Models`, `Notifications`, `People`, `Configuration`, `Updates` (the bare `/settings` opens Account).
- Phone: `Open menu` at the top of each page; detail pages (vault item, new vault item, skill, connection, credential request) show `Back` instead.

## Driving it with ta-verify

Preconditions:

- Baseline run, doctor OK, signed in as demo (account name `Demo User`). Theme and collapse live in the drive's browser storage, so nothing needs restoring.

- **Account menu.** Account button contains `Demo User`; menu has the eight items. `Memory` → `/memory`, title `Memory · tiny-agents`; reopen: menuitem `Memory` has `aria-current="page"`; Escape.
- **Feedback.** Menu → `Send feedback` → dialog `Tell us more` with textbox `Your feedback`; `Close` (never send). Without the embed: the toast.
- **Palette.** Ctrl+K → dialog `Command menu`; type `Tasks`; option `Tasks` → `/tasks`, palette closed. Expected exactly one `Tasks` option.
- **Theme.** `/settings/appearance`, group `Theme` → `Light`: `aria-pressed=true`, no `dark` class, stored `light`; reload keeps it. `Search` → option `Dark` → `dark` class, stored `dark`, Settings shows `Dark` pressed; reopen palette: option `Dark ✓`.
- **Collapse.** Back on `/tasks` (Settings has no app sidebar): palette `Toggle sidebar` → `Demo User` hidden, link `Tasks` has `title="Tasks"`; reload: still collapsed; Ctrl+B restores.
- **Settings sections.** `/settings` → `/settings/account`; navigation `Settings sections` links are exactly the eight above.
- **People.** Link `People` → `/settings/people`: `Name`, `Email`, `Password` (exact; the feedback embed has its own `Email (optional)`) → `Add guest`; toast `Guest added`; `guest-row` with the email and `No bots shared`. `Remove <name>` → alertdialog `Remove` → row gone; `GET /api/v1/people` no longer has it.
- **Phone.** Viewport 390x844, `/tasks`: complementary `Sidebar` out of viewport; `Open menu` → in viewport with links Tasks, Terminal, Computer, Browser and no `Routines`. Link `Terminal` → `/terminal`, drawer closed. `Open menu` → account button → menuitem `Routines` → `/routines`, drawer closed. `/vault/new/login`: no `Open menu`; `Back` (exact) → `/vault`, `Open menu` back. `/settings`: section links `People` and `Account` both open their page (level-1 heading).
- **Proof.** `ta-verify drive $S/journeys/account-shell.mjs` → `account-shell/account-menu`, `feedback-panel`, `theme-light`, `theme-dark`, `sidebar-rail`, `settings-sections`, `guest-added`, `phone-drawer`, `phone-back`, `phone-settings`.
- **Phone pages and Settings links.** `ta-verify drive $S/journeys/app-phone.mjs` (iPhone 13): `/vault`, `/memory`, `/routines` and `/skills` each show exactly one `Open menu`; `/settings/notifications` opened directly stays on Notifications instead of falling to Appearance while the role loads → `app-phone/one-menu`, `settings-link`.

## Gotchas

- Regression check for #166 (fixed 2026-11): the palette used to list every destination twice (the shell's Navigation group plus the app's own). The step `⌘K palette lists each destination once` asserts one.
- There is no profile page or profile editing: the account button shows the name (or email) and initial; identity is set at setup or by the admin API.
- The FeedbackBee embed runs headless (`data-headless`): no floating `Feedback` launcher, only the account menu opens it. The embed is third-party (feedbackbee.nesin.io): a slow fetch can delay the page `load` event of any journey.
- Claude Code sign-in (`Sign in to Claude`, `Check again`) is unreachable: it needs a sandbox (`up --sandbox`) with Claude Code installed and a real Claude subscription login.
- Logging in as a guest (the guest shell) is not covered here.
