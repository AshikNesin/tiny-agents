# Command palette

The ⌘K / Ctrl+K search palette jumps anywhere from anywhere. It opens from the sidebar's Search button or the keyboard, lists Actions (New bot), Bots, Navigation pages, Theme and Account commands, filters as you type, runs the highlighted entry with Enter or a click, and closes on Escape, on a second Ctrl+K, on an outside click, and after running a command.

## Sub-features

- `palette-open` sidebar button `Search (⌘K)` or Ctrl+K opens dialog `Command Menu` with the input `Type a command or search...` focused; groups `Actions`, `Bots`, `Navigation`, `Theme`, `Account`.
- `palette-close` Escape, Ctrl+K again, and a pointer click outside the dialog close it.
- `palette-filter` typing filters the options; nothing matching shows `No results found.`
- `palette-bot` picking a bot (Enter on the highlighted option) opens `/chats/<botId>`.
- `palette-page` picking a page (`Memory`, `Settings`, `Tasks`, …) navigates there.
- `palette-new-bot` Actions → `New bot` opens the `New bot` dialog.
- `palette-unique` each group and command is listed once, and destinations that aren't configured (Code without Claude Code) are left out.

## How to get to it (user POV)

- Sidebar header: the magnifier button `Search (⌘K)`. Keyboard: ⌘K on macOS, Ctrl+K elsewhere, on any signed-in page.

## Driving it with ta-verify

Preconditions:

- Baseline run, doctor OK, signed in. A bot of the journey's own to jump to (`setup:` via the API). Start on `/tasks` so the bot jump is a real navigation.

- **Open.** Click `Search (⌘K)`: dialog `Command Menu`, input focused, the five group headings, option `<bot>`.
- **Close.** Escape → gone. Ctrl+K → open, Ctrl+K → gone. Open, `page.mouse.click(8, 400)` → gone.
- **Empty.** Fill the input with nonsense: `No results found.`, no options.
- **Bot.** Fill the bot's name: its option is `aria-selected=true`; Enter → URL `/chats/<botId>`, composer `Message <bot>`.
- **Page.** Ctrl+K, type `Memory`, click option `Memory` → `/memory`. Type `Settings`, Enter → `/settings`.
- **New bot.** Option `New bot` → dialog `New bot`; `Cancel`.
- **Unique.** Reopen; collect group names and option labels: no duplicates (ignoring the ` ✓` / ` theme` suffixes), no `Code`.
- **Proof.** `ta-verify drive $S/journeys/command-palette.mjs` → `command-palette/open`, `no-results`, `navigated`, `new-bot`, `listing`.

## Gotchas

- Known product bug (2026-11): the palette shows the shell's built-in groups (`Navigation`, `Theme`, `Account`) as well as the app's own copies, so Navigation, Theme and Account (Log out) each appear twice, the shell's Navigation lists `Code` although Claude Code isn't configured, and a filter like `Tasks` highlights two options at once. Use `.first()` when picking options; the journey's last step asserts the de-duplicated listing and fails until it is fixed.
- Headless Chromium on Linux: use `Control+k`, not `Meta+k`.
- The dialog's accessible name is the screen-reader title `Command Menu`, not the input's placeholder.
- `New coding thread` and the Code threads group only appear when Claude Code is configured (not in the baseline); `Log out` in Account is covered by `auth.mjs`'s sign-out path, not run here (it would end the session).
- The outside click must be a real pointer click on the overlay (left of the centred dialog), not a click on the sidebar behind it via a locator.
