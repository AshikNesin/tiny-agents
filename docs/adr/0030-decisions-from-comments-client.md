# 0030 — Decisions recorded from code comments: web client

- Status: accepted
- Date: 2026-11-20

## Context

These decisions were recorded as comments in `apps/web/src/client` (pages,
lib, queries, store, `App.tsx`, `main.tsx`, `app.css`; not `components/`).
The comment sweep under [ADR 0028](./0028-code-carries-no-comments.md) moved
them here. Each one is a choice that a reader could not get back from the
code or its tests, or an outside constraint that the code works around.

## Toasts sit at the top of the screen

`App.tsx` puts the toaster at the top. At bottom right the toasts covered
the chat composer's Send and Stop button and caught clicks for the few
seconds they showed.

## Clipboard on plain http

`lib/clipboard.ts` degrades instead of failing. `navigator.clipboard` exists
only in secure contexts, and people often reach the app over plain http (a
tailnet IP, a LAN box). Writes then fall back to a hidden textarea and
`execCommand("copy")`, which still works inside a user gesture. Reads have no
fallback: the browser's own paste event (Ctrl/Cmd+V) is the only way in, so
callers tell the owner which shortcut to press.

## The terminal's xterm handling

`lib/xterm.ts` is the only module that touches xterm.js. It owns the
following choices:

- **Paste.** xterm turns Ctrl+V into a `^V` byte and cancels the event, so
  the browser never fired `paste` and paste did not work on Windows or
  Linux. `classifyKey` lets the paste shortcuts (including Shift+Insert)
  through to the browser, and xterm answers the native paste event with
  bracketed paste. This also works on plain http.
- **Copy.** Ctrl+C with no selection stays `^C`, so an interrupt is never
  lost. With a selection it copies, and the next Ctrl+C interrupts (the
  Windows Terminal rule). Ctrl+Shift+C always copies, because it would
  otherwise open Chrome's inspector. On macOS Ctrl is left alone: `^V` is a
  convention there, and Cmd does the clipboard. Shift+drag (Option+drag on
  macOS) makes a local selection even while tmux has the mouse.
- **OSC 52.** tmux sends an empty selection parameter, which the stock
  clipboard provider ignores (it only takes `c`), so every tmux copy was
  dropped. The custom provider accepts it. It refuses reads, so a program on
  the VM can never read the owner's clipboard.
- **Glyph widths.** tmux measures emoji and CJK with a modern width table.
  xterm defaults to Unicode 6, and the mismatch smeared TUIs. The unicode11
  addon makes the two agree.
- **Fonts and colours.** Only system monospace faces are used, so the first
  cell measurement is the real one. When `document.fonts` settles, the glyph
  atlas is rebuilt and the grid refitted once. Every colour given to xterm is
  hex, because its WebGL atlas cannot take oklch and a translucent token made
  it throw. Each theme has its own ANSI palette: xterm's stock palette made
  yellow and white unreadable on the light theme.
- **Hidden hosts never fit.** A `display:none` host measures 0x0. Fitting it
  would shrink the grid to its minimum, and tmux would redraw everything
  twice.
- **Smooth scrolling is off.** It feels laggy over a remote pty, and tmux
  owns the history anyway.

## The terminal page's layout

- `pages/terminal/Terminal.tsx` makes full screen a CSS state
  (`fixed inset-0`) because iOS Safari never makes a div full screen (#170).
  The Fullscreen API only hides the browser's chrome when it is available.
  The exit control sits inside the full-screen region, because the region
  covers the page header.
- The terminal column is `min-w-0 overflow-hidden`. Without that, a bigger
  font widened the column, which refitted the grid, which widened the column
  again, and the keys panel got squeezed.
- The keys in `TerminalKeysPanel.tsx` never take focus. On a phone, moving
  focus out of xterm's textarea closes the soft keyboard after every press.

## The SSE client

`lib/sse.ts` reads SSE through `fetch` streaming, not `EventSource`.
`EventSource` reconnects on its own schedule, and the app needs to abort
and resubscribe for a fresh snapshot.

- **A hidden tab gives its stream back.** Over plain HTTP/1.1 a browser opens
  at most 6 connections per origin, and each open stream holds one. Two or
  three tabs' streams left every new request queued. A hidden tab closes its
  stream and opens a fresh one, with a fresh snapshot, when it is shown again.
- **Going offline drops the attempt at once.** An open stream rarely breaks
  right away when the network goes, so the transcript looked live while
  nothing arrived.
- **Retry policy.** Transient failures (a 502 during a deploy) retry
  forever. Auth failures do not retry, because the next API call redirects
  to `/login`. A healthy connection resets the backoff.

## OAuth popups open inside the click

`lib/connection-auth.ts` opens the sign-in popup synchronously in the click
handler and only points it at the authorization page once the server names
the URL. Browsers block a popup opened after an `await`. Callers such as
`pages/connections/ConnectionDetail.tsx` start the sign-in before awaiting
anything.

## Secrets on the client

This applies [ADR 0015](./0015-one-secrets-subsystem.md) to the browser:

- The vault step-up token (`lib/vault-api.ts`) lives in module memory for its
  five minutes. It is never written to storage.
- A write whose request or answer carries a secret goes through
  `useSecretMutation` (`queries/resource.ts`). Once answered, it is reset and
  dropped from the mutation cache (`gcTime: 0`), so the secret lives only
  where the caller keeps it.
- A revealed vault value (`pages/vault/VaultItemDetail.tsx`) lives only in
  the field that shows it. It is never in a query cache.

## Boot: fonts and stale chunks

- `main.tsx` imports Inter from JavaScript, not from the shell CSS. Tailwind
  inlined an `@import` before Vite saw it, so the fonts' relative `url()`s
  were never emitted, and production served `index.html` in their place
  (#82).
- After a deploy, a tab still on the old bundle asks for chunks that no
  longer exist. On `vite:preloadError` the page reloads once. The guard is
  cleared only after the build has run for 10 seconds, so a chunk that fails
  right after boot cannot cause a reload loop.

## Approval cards show enough to judge

`lib/tool-call-text.ts`:

- Past a length threshold, the approval card folds the payload behind "Read
  more" instead of cutting it. Approving a 700-word change from a 60-character
  slice is rubber-stamping.
- The `create_bot` card shows the description, the model and the
  instructions, not only the name, because approval is the only gate on what
  a new bot will be (#149).

## Overlapping bot-list loads

`store/bots.ts` `loadBots` lets only the newest request land. Loads overlap
(mount, a create, activity events), and an older list that answered last
would drop a bot that had just been created, so the chat route would treat
its link as stale. A caller whose request was superseded resolves with the
newest list once it lands, not with the store as it was. Without that, the
Memory page snapshotted a stale store and showed "No bots yet" (#119). Local
patches (replying, waiting counts, pin, read) made after a request started
are re-applied on top of its response.

## Live views never open themselves

`lib/browser-panel.ts`: when a bot uses its browser or computer, the
header's live-view toggle lights up. The panel no longer pops open over the
chat. The owner opens it when they want it.

## Streamdown markup fixes

- `lib/markdown.tsx` renders a paragraph that holds an image next to text as
  a `<div>`. Streamdown puts its image wrapper `<div>` inside the `<p>`,
  which is invalid HTML and triggers a React warning.
- `app.css` restores list markers inside replies. Tailwind's source scan
  does not include Streamdown's list utilities, and preflight strips the
  default markers.

## New Code threads start in Bypass

`composerPermission` in `pages/code/controls.tsx` starts a new thread's
composer in Bypass (`bypassPermissions`) wherever the harness offers it to
the viewer. Otherwise it uses the harness's own default. This was the
owner's decision on 18 Nov 2026. The picker can still change it per thread.

## Routines, tasks and memories

- `pages/routines/routine-form.ts`: the Daily and Weekly presets are only a
  shortcut when creating a routine. An existing cron opens on the Custom tab
  and is never parsed back into a preset.
- Quick-add on the Tasks page (`pages/tasks/Tasks.tsx`) files a dated task
  without a time at 23:59 local time, and the list reads 23:59 (or midnight)
  as "date only". A task added on the Today tab is due at the end of today,
  and one added on Upcoming at the end of tomorrow, because an undated to-do
  counts as upcoming (friction #36). A day typed into the box wins over the
  tab's default.
- `pages/memory/Memory.tsx`: restoring a memory whose expiry has passed clears
  that expiry, so it does not expire again at once. An ordinary edit leaves an expiry that
  memory capture set alone.

## Enter on touch devices

`lib/composer-browser.ts`: when the primary pointer is coarse (phones and
tablets), Enter inserts a newline and only the Send button sends.
Enter-to-send is for physical keyboards (issue #1).

## The guest shell is cosmetic

`apps/web/src/client/queries/viewer.ts` says whether the viewer is loading,
unknown, the owner or a guest, and `App.tsx` hides
the pages a guest cannot open only so the shell does not fill with errors.
The server guards every route on its own (#145), so the client's guest
checks are never a security boundary.

## Running CI jobs show steps, not logs

`pages/code/PullChecks.tsx` shows a running Actions job's steps, read again
every few seconds. GitHub serves a job's log only after the job finishes.
Then the log excerpt replaces the steps.
