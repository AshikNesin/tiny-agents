# 0036 — Decisions recorded from code comments: Android app

- Status: accepted
- Date: 2026-11-20

## Context

These decisions came out of the comment sweep of `mobile/` under
[ADR 0028](./0028-code-carries-no-comments.md). Most of the app's comments
restated the code, or repeated what `mobile/AGENTS.md`,
`mobile/docs/app/README.md` and `mobile/docs/guides/android.md` already
say: the web client modules the chat and Code rules port, the stream and
socket timings, the terminal close codes, push registration, IST routine
times, and the first-frame theme read. Those documents stay the reference.
The sections below hold only what was written nowhere else.

## The stored session is read before the first frame

`MainActivity.onCreate` reads the stored session with `runBlocking` before
`setContent`, because the session decides whether the first screen is
sign-in or the chats. Reading it asynchronously would flash the sign-in
screen at a signed-in owner. `ShareActivity` and `TinyAgentsPushService`
also read it before they act, because a share or a push can start the
process, and both need the server's address.

## App build identity

In `mobile/android/app/build.gradle.kts` the Kotlin `namespace` stays
`groot.mobile`; the boilerplate's `groot:setup` script changes only
`applicationId`. The host
whose links open the app comes from the `tinyAgents.linkHost` Gradle
property, so a build for another server passes
`-PtinyAgents.linkHost=<host>` and never edits the manifest.

In `mobile/android/terminal/build.gradle.kts`, `TERMINAL_TMUX_TEST` is a
declared input of the test task. Without it, setting the variable to run
`TmuxDifferentialTest` would reuse an up-to-date, skipped result.

## Platform limits the app code works around

- `data/AppLinks.kt` decodes URLs with `URLDecoder.decode(String, String)`
  and the charset's name. The `Charset` overload is API 33, above the app's
  minimum SDK.
- `data/api/Json.kt` reads JSON with the platform's `org.json`, so the app
  ships no JSON library. Every reader treats a missing key and an explicit
  `null` alike, because the server leaves out optional fields in some
  places and sends `null` in others.
- `ui/components/Format.kt` builds its date formatters on every call, not
  in a field, because the owner can change the locale while the app runs.
- `push/PushNotifier.kt` suppresses lint's `MissingPermission` on `show`
  and `note`: `areNotificationsEnabled()` is checked first, and it covers
  `POST_NOTIFICATIONS`.

## The bot list refreshes when the app comes back

`feature/home/HomeScreen.kt` calls `HomeViewModel.retry()` from a
`LifecycleStartEffect`. The server's event feed has no event for a bot
created, renamed or pinned elsewhere (the web app, another phone), so
returning to the app is when those changes are picked up.

## Chat details from the server's protocol

In `data/chat/ChatSession.kt`:

- A confirmed user message matches its Echo by `requestId`. A message with
  no `requestId` (an older server) matches by text and attachments, with
  its server time allowed to run up to `LEGACY_ECHO_SKEW_MS` behind the
  Echo's device time.
- In a shared chat a bot that decides a message is not for it replies with
  `[skip]`. That reply is hidden, and so is a streaming reply whose text so
  far is a prefix of `[skip]`, so `[sk` never flashes on screen.

## Compose details that prevent visible bugs

- `ui/components/Common.kt` `BotAvatar` keys its `produceState` on the
  avatar store and the bot's name. A restart alone would let a reused slot,
  such as the top bar after a bot switch, show the previous bot's face
  until the new one loads.
- `ui/components/RemoteInput.kt` `RemoteKeyboard` keeps one sentinel
  character in its hidden field, so a backspace on an empty draft still
  reaches it, and asks for a password-style keyboard, so nothing is
  composed, suggested or autocorrected before it is sent to the remote
  screen.

## The terminal emulator follows tmux

`mobile/android/terminal` is measured against tmux, the screen producer in
production.

- `CharWidth` gives code points the widths glibc's `wcwidth` gives them,
  because tmux measures with it. Its tables are generated from glibc 2.39
  (Unicode 15.1).
- `TerminalEmulator.resize` does not reflow: the program redraws on
  SIGWINCH. A second `?1049h` on the alternate screen changes nothing, as in
  xterm.js. An OSC 52 request to read the clipboard is never answered.
- `TerminalColors.dark()` and `light()` are the web terminal's palettes
  (`apps/web/src/client/lib/xterm.ts`), not xterm's stock colours, which
  are unreadable on a light background.
- `TerminalRenderer` places every glyph at its own column, so a fallback
  font with other metrics (CJK, emoji) cannot shift the grid. A run of
  plain ASCII goes out as one `drawText` only when every ASCII advance of
  the monospace face equals the cell width. Box drawing and block elements
  are drawn as geometry, because font glyphs leave gaps between cells and
  break tmux borders and progress bars. Ligatures and contextual forms are
  turned off, and bold is faked on the regular face when the bold face's
  advance differs.

`TmuxDifferentialTest` uses `tmux capture-pane` as the oracle. Its random
`RawSequences` generator avoids the sequences where tmux and xterm
disagree (IL and DL outside the scroll region, origin mode after DECSTBM,
saving a pending wrap, erasing half a wide character, ICH and REP at the
margin, RIS and `1049l` on the main screen), so a failure means the
emulator is wrong, not that the two references differ. Its tmux settings
use `tmux-256color`, because a `screen` terminal shows italics as reverse,
and the `RGB` feature, because without it tmux squashes 24-bit colours to
the 256-colour palette. `PRODUCTION_SETTINGS` must match `TERMINAL_SETTINGS`
in `packages/sandbox/src/terminal/tmux.ts`.

## The VNC client

In `mobile/android/vnc`:

- `ByteQueueInputStream` never blocks on `offer` and its queue is
  unbounded. That is safe because an RFB server only sends an update after
  the client asks for one, so the backlog stays about one update deep.
  `offer` keeps the caller's array without copying it.
- `RfbClient` advertises no Cursor pseudo-encoding: the server draws the
  pointer into the framebuffer. The ZRLE inflater is freed only on the
  thread that runs `run()`, so `close()` cannot free it during a decode.
- `VncView` sends the second tap of a double tap at the first tap's
  position, because two finger taps never land on the same pixel and a
  remote double click must.
- `VncViewState` suppresses lint's `UseKtx` because the module has no
  `androidx.core` dependency to supply the `createBitmap` extension.
