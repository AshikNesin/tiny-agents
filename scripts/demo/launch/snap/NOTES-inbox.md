# Inbox states (`tools/stage-inbox.mjs`)

Run `node scripts/demo/launch/tools/stage-inbox.mjs` (both modes, desktop
first) or pass `desktop` or `mobile`. It rebuilds its own instance on port 3130
(data in `data/verify/inbox/`) before each mode and leaves it running in the
end state. `--down` stops it.

## How the instance is staged

- **Account:** first-run setup (`POST /auth/setup`) with the name `Ashik`.
- **Bots and chats:** created and sent through `/api/v1`, oldest first. The
  fake model is the app's own faux provider, wrapped by `inbox-director.mjs`
  (loaded by `inbox-register.mjs` and `inbox-hooks.mjs`) so it says the CAST lines.
  Chief of Staff's `create_bot` card and Travel Planner's card come from real
  tool calls. Travel Planner's card is a `create_routine` for `Morning fare check`
  that stands in for the vault card.
- **Times:** the server clock is set back while each chat is seeded
  (`inbox-register.mjs` shifts `Date` in the server process only), so the list
  shows 12m, 1h, 3h and 5h in CAST order. The browser uses real time, and
  `relativeTime` compares calendar days in the browser's time zone (UTC here), so
  a run within 5 hours after midnight shows `Yesterday` for Researcher.
- **Seeded in app.db:** `bots.last_message_preview` for Chief of Staff and Travel
  Planner is set to the bot's own line. A turn that is waiting on an approval has
  not finished, and the app only writes the preview when a turn finishes, so the
  row would otherwise show the owner's message. For the end state,
  `bots.last_activity_at` of Expense Tracker is set to now so it sorts first. Chief
  of Staff's reply comes a moment after the bot is created, so it would otherwise
  sit on top.
- **Read state:** the browser signs in before any bot exists. On desktop,
  `/chats` opens the top bot, and that would mark Code Buddy read. Code Buddy's
  chat is opened last of the four side states, so the other three frames show its
  unread dot.
- **Dev reloads:** the page's Vite HMR socket (port 3131) is answered by
  Playwright with a silent socket. Without that, other helpers' snapshot writes
  reload the page in the middle of a run.

## States (desktop and mobile; verify for both was 0.00000 to 0.00040)

- `list-start` (mobile only): the phone's bot list (`/chats`) in the start state.
  Code Buddy shows the unread dot, Travel Planner and Chief of Staff show `1`.
  Real flow plus the seeds above.
- `side-researcher`: the start table with Researcher open and its CAST messages.
  Real flow plus the seeds.
- `side-travel`, `side-chief`, `side-codebuddy`: the same start state with that
  chat open. Each opened chat is marked read by the app. Real flow plus the seeds.
- `chief-pending`: Chief of Staff's chat with CAST 1 and 2 and the real waiting
  `create_bot` card (Description, `Model default model`, instructions folded
  behind `Read more`), scrolled into view. The app draws a message's tool cards
  above its text, so the card sits above `Expense Tracker is ready for your OK.`
- `chief-approved`: after a click on the card's real Approve button. The app
  shows an approved call as the row `Created bot “Expense Tracker” · 1ms · waited 3h
  for you` (3h because the card was seeded 3h back), then CAST 4. On desktop
  Expense Tracker is in the sidebar.
- `side-end`: five bots with Expense Tracker on top, nothing unread or waiting,
  Researcher open. Travel Planner's card was approved in the UI with the clock
  set 1h back, so its row keeps 1h and now reads `Done. You're in 14A and 14B.`
  Every bot was then marked read (`POST /bots/:id/read`).
- `list-end` (mobile only): the phone's bot list in the end state.

## DOM edits

One edit, mobile only, before each snapshot. On the chat scroller
(`[data-slot="message-scroller-viewport"]`) the class `[scrollbar-gutter:stable]`
is replaced with the app's `scrollbar-hide`. A phone has overlay scrollbars, so
the gutter takes no width and the screenshot is unchanged. Desktop Chrome, where
the film mounts the markup, reserves 10px for the gutter and rewraps every chat
line, which put the verify score between 0.010 and 0.036. Desktop has no edits.

## Selectors

- Sidebar rows (desktop): `aside[aria-label="Sidebar"] section[aria-label="Bots"] li > a`.
  The link's accessible name is the row state, for example `Code Buddy, unread`,
  `Travel Planner, 1 awaiting approval`, `Researcher`. The active row has
  `aria-current="page"`. The preview is `#bot-preview-<botId>`.
- Phone bot list: `main section[aria-label="Bots"] li > a`.
- Unread dot: `[aria-label="Unread"]`. It is hidden on the active row.
- Waiting mark: `[aria-label="1 awaiting approval"]` (the count badge).
- Messages: `[role="region"][aria-label="Messages"]`.
- Approval card: `[data-slot="item"]` containing
  `Chief of Staff wants to create a new bot`, with its title in
  `[data-slot="item-title"]` and `Read more` in `button[aria-expanded]`.
  Approve is `getByRole("button", { name: "Approve", exact: true })` inside the card.
- Approved call: the text `Created bot “Expense Tracker”` in Messages.

## Not done

- The composer's model chip reads `Test Model (faux)`, the faux model's name.
- On mobile, the chat states show no sidebar, so `chief-approved` shows Expense
  Tracker only in `list-end`.
