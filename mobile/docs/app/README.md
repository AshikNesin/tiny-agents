# Tiny Agents for Android: app guide

The Android client for a tiny-agents server. This guide covers how the app is put together, which server routes
each screen calls, the live view and terminal protocols, security, testing and the known limits. Build and first
run are in the [README](../../README.md).

## Modules

| Module | Holds |
|---|---|
| `android/app` | Screens, ViewModels, navigation, the API client, stores and the chat reducer |
| `android/vnc` | An RFB 3.8 (VNC) client and a Compose viewer, for the Browser and Computer live views |
| `android/terminal` | An xterm-compatible emulator and a Compose view, for the Terminal screen |
| `android/kit` | The boilerplate's theme, tokens, settings screen and build info (synced, never edited here) |

The `vnc` and `terminal` modules know nothing about tiny-agents: they take byte streams and draw. The app module
connects them to the server's WebSockets. The one runtime dependency added to the boilerplate is OkHttp, used for
HTTP, server-sent events and WebSockets.

## Architecture

App code is under `android/app/src/main/kotlin/groot/mobile/`, in four layers:

- `data/api/`: `ApiClient` is the only code that talks HTTP. It sends JSON under `/api/v1` with
  `Authorization: Bearer <token>`, unwraps the `{ success, data, error }` envelope into data or an
  `ApiException`, uploads multipart files, reads event streams and opens WebSockets. `TinyAgentsApi` has one
  function per server route. `WireChat.kt` and `WireApp.kt` hold the wire types; they mirror the server's
  `apps/web/src/shared/api/` and `apps/web/src/shared/bot-stream.ts` field for field.
- `data/`: stores that live as long as the process, wired by hand in `AppContainer` (no DI framework).
  `SessionStore` keeps the server, token and user. `BotsStore` holds the bot list, models and tool catalog and
  follows the activity feed. `ChatStore` runs every open chat. `StepUp` holds the vault step-up token.
  `ImageStore` and `FileActions` load and save attachments.
- `feature/`: one folder per area. Screens are stateless composables; a `...Route` wrapper connects a ViewModel
  or a store.
- `navigation/`: route strings in `Routes.kt`, the graph in `AppNavHost.kt` and `FeatureScreens.kt`.

When the session changes (sign-in, sign-out, another server), `AppContainer` stops the feed, clears chats,
images and the step-up token, and starts `BotsStore` again if someone is signed in.

### The chat reducer

`data/chat/ChatSession.kt` is a port of the web client's `lib/chat-session.ts`. A chat is one pure value,
`ChatSession`, and every change goes through one function, `reduceChat(state, action)`: stream events (snapshot,
deltas, tool calls, queue, YOLO), the stream opening or dropping, Echoes, and older pages. `chatView()` turns
the session into what the chat screen draws, including the "New messages" divider and routine run lines.

Routine runs that finish back to back on the same day fold into one quiet, centred line, as on the web
(`components/RoutineRuns.tsx`): "Process emails · ran 24× · last 16:20", with a second line for any that failed
or need attention. Tapping it lists the runs newest first: the latest five plus every run with a problem, then
"Show N earlier". `feature/chat/RoutineRuns.kt` draws it; times are IST, like the server.

An owner message is first an Echo (an optimistic copy with a `requestId` minted once), then a queued item if the
server holds it behind a running reply, then a transcript message. `ChatStore.send` retries a send that got no
answer with the same `requestId`, which the server dedupes; a refused send removes the Echo and puts the draft
back. `ToolCallText.kt`, `ToolCallView.kt` and `AttachmentNotes.kt` port the web client's `lib/tool-call-text.ts`,
`lib/tool-call-view.ts` and `lib/attachment-notes.ts` the same way (the last hides the server's notes for the model
from the owner's bubble). A change to these rules in one client must be made in the other.

### Streams and reconnects

- **Event streams.** `ApiClient.events()` reads `GET /bots/:id/stream` (one chat) and `GET /events` (the
  activity feed). After a drop it waits 1.5 s, doubling to 10 s, and goes back to 1.5 s once a stream opens.
  The server pings every 25 s, so 60 s of silence counts as a drop. A 401 or 403 ends the stream, and a 401
  signs the app out.
- **Chat.** A chat stream always opens with a snapshot of the newest messages. On a reconnect the reducer keeps
  the older pages already loaded above it (`mergeSnapshot`). A chat's stream runs only while it is on screen;
  its cached session stays for the next visit.
- **Feed.** `BotsStore` applies busy, approval and question counts from the feed and refetches the bot list
  shortly after activity settles. Connection status and model changes also arrive on the feed.
- **Sockets.** The live view and terminal reconnect on their own, 1 s doubling to 10 s (below).

## Screens

The sign-in screen (`feature/auth/`) shows while there is no session; every other screen is a route. All server
paths are under `/api/v1`. `{surface}` is `browser` or `computer`.

| Screen | Route | Server routes |
|---|---|---|
| Sign in | (no session) | `GET /auth/setup`, `POST /auth/login`, `POST /auth/setup` |
| Home: drawer and chat | `home` | `GET /bots`, `GET /models`, `GET /capabilities`, `GET /people/me`, `GET /events`; `GET /bots/:id/stream`, `GET /bots/:id/messages`, `POST /bots/:id/messages`, `DELETE /bots/:id/messages/:requestId`, `POST /bots/:id/abort`, `POST /bots/:id/reset`, `POST /bots/:id/read`, `POST /bots/:id/pin`, `PUT /bots/:id/yolo`, `POST /bots/:id/approvals/:taskId`, `POST /bots/:id/questions/:taskId`, `POST /vault/requests/:taskId/submit`, `POST /vault/requests/:taskId/cancel`, `POST /uploads`, `GET /uploads/:id/content`, `DELETE /uploads/:id` |
| New bot | `bot/new` | `GET /skills`, `GET /connections`, `GET /people`, `POST /bots` |
| Edit bot | `bot/{botId}/edit` | `GET /bots/:id`, `GET /skills`, `GET /connections`, `GET /people`, `PATCH /bots/:id`, `DELETE /bots/:id` |
| Past chats | `bot/{botId}/history` | `GET /bots/:id/chats` |
| Past chat | `bot/{botId}/history/{chatId}` | `GET /bots/:id/chats/:chatId`, `GET /bots/:id/chats/:chatId/messages`, `POST /bots/:id/chats/:chatId/continue`, `DELETE /bots/:id/chats/:chatId` |
| A bot's Browser or Computer | `live/{surface}/bot/{botId}` | `GET /bots/:id/{surface}`, `POST /bots/:id/{surface}/start`, `POST /bots/:id/{surface}/vnc-ticket`, `POST /bots/:id/{surface}/driver`, `POST /bots/:id/browser/resize`, `DELETE /bots/:id/{surface}/profile`, `GET /computer/:profile/apps`, `POST /computer/:profile/apps` |
| Browser or Computer page | `live/{surface}` | `GET /{surface}` |
| A profile's live view | `live/{surface}/profile/{profile}` | `GET /{surface}`, `POST /{surface}/:profile/start`, `POST /{surface}/:profile/vnc-ticket`, `POST /{surface}/:profile/driver`, `POST /browser/:profile/resize`, `DELETE /{surface}/:profile`, `GET /computer/:profile/apps`, `POST /computer/:profile/apps` |
| Terminal | `terminal` | `GET /terminal/sessions`, `POST /terminal/sessions`, `DELETE /terminal/sessions/:name`, `POST /terminal/sessions/:name/ticket` |
| Tasks | `tasks` | `GET /tasks`, `POST /tasks`, `PATCH /tasks/:id`, `DELETE /tasks/:id` |
| Routines | `routines` | `GET /routines`, `POST /routines`, `PATCH /routines/:id`, `DELETE /routines/:id`, `POST /routines/:id/run`, `POST /routines/:id/pause`, `POST /routines/:id/resume`, `GET /routines/:id/runs` |
| Skills | `skills` | `GET /skills`, `POST /skills`, `PATCH /skills/:id`, `DELETE /skills/:id` |
| Memory | `memory?botId={botId}` | `GET /bots/:id/memories`, `POST /bots/:id/memories`, `PATCH /memories/:id`, `DELETE /memories/:id` |
| Connections | `connections` | `GET /connections`, `POST /connections` (step-up), `PATCH /connections/:id`, `DELETE /connections/:id` (step-up), `POST /connections/:id/reconnect`, `POST /connections/:id/authorize`, `PATCH /connections/:id/tools/:server` |
| Vault | `vault` | `GET /vault`, `GET /vault/items/:handle`, `POST /vault/step-up`, `POST /vault/items/:handle/reveal`, `PUT /vault/items/:handle`, `DELETE /vault/items/:handle` (the last three with step-up) |
| People | `people` | `GET /people`, `POST /people`, `DELETE /people/:id` |
| Settings | `settings` | `POST /auth/logout` |
| About | `about` | none |

The drawer lists the bots, then a three-wide grid of tiles for Tasks, Terminal, Computer, Browser, Routines,
Skills, Memory, Connections and Vault, and the account row that opens Settings. The Home top bar holds only the
menu, the open bot (its avatar and name) and New chat. Tapping the bot opens its menu: tiles for that bot's
Browser, Computer, Past chats and Memory, then the YOLO switch, Pin and Edit bot. People opens from Settings. A guest sees the bots shared with them and their live
views, not the management screens.

## Live views (Browser and Computer)

`feature/live/LiveViewModel.kt` drives one view; `android/vnc` speaks the protocol.

- **Status.** While the screen is visible it polls the status route every 3 s (1.5 s while starting). Off screen
  it stops polling and closes the viewer, since the server caps viewers and idles a desktop nobody watches.
- **Ticket.** When there is a picture to show, it asks `POST .../vnc-ticket` for `{ path, scale }` and opens a
  WebSocket on that path. The request sends no `Origin` header, so the server treats it as a non-browser client
  and the ticket is the credential.
- **RFB over WebSocket.** The socket carries raw RFB 3.8 with security type None in binary frames. Each client
  message goes out as one frame. The client sends only standard messages: SetPixelFormat, SetEncodings,
  FramebufferUpdateRequest, KeyEvent, PointerEvent, ClientCutText and SetDesktopSize.
- **Resize (browser only).** 150 ms after the viewer's box settles, the app asks the remote display for that size
  times the ticket's `scale` over RFB (SetDesktopSize), and asks for the Chrome window size in CSS pixels with
  `POST .../resize` (at least 320 x 240). A box narrower than 500 CSS pixels gets a 500-pixel-wide window scaled
  down, as in the web client's `lib/remote-window.ts`.
- **Take control.** `POST .../driver` with `"human"` takes control and pauses the bots on it; `"agent"` hands it
  back and also answers a bot's takeover request. Until the owner drives, the viewer is view-only: touches pan
  and zoom locally. While driving, tap is a click, long press a right click, one-finger drag a drag, two-finger
  drag a scroll, and pinch zooms (1x to 4x). A guest only watches.
- **Reconnect.** A dropped viewer retries after 1 s, doubling to 10 s. A 404 or 409 on the ticket means the
  session closed or is headless; the view waits for the poll to say it is back.

## Terminal

`feature/terminal/TerminalViewModel.kt` attaches one tmux tab at a time; `android/terminal` turns the bytes into a
screen for `TERM=xterm-256color`.

- **Ticket.** `POST /terminal/sessions/:name/ticket` returns a WebSocket path. The app appends `&cols=&rows=`
  with the view's grid and opens it.
- **Frames.** Binary frames carry raw pty bytes both ways. Text frames are JSON control messages from the app:
  `{"t":"resize","cols":N,"rows":N}` when the grid changes, `{"t":"pause"}` when more than 512 KiB of output is
  waiting to be drawn and `{"t":"resume"}` once it is under 64 KiB, and `{"t":"ping"}` every 20 s. A pong that
  does not come within 8 s counts as a drop.
- **Close codes.** 1000: the session ended or this client was detached; the app stops and offers Reconnect. 4000:
  idle; the app reattaches at once. Anything else: a drop; retry after 1 s, doubling to 10 s. A 404 or 409 on the
  ticket means the tab is gone, and the app stops.
- **Closing a tab.** `DELETE /terminal/sessions/:name` returns 409 while something runs in the tab. The app names
  the process and asks before it sends `?force=1`.
- The screen detaches when it leaves the screen, so the server's idle timer can free the attach.

## Links from notifications

`data/AppLinks.kt` maps the server's notification links (`/chats/<bot>?focus=approval:<task>`,
`/vault/requests/<task>`, `/vault`, `/routines`, `/tasks`) onto screens; `MainActivity` (`singleTask`) hands them
over on a cold start or in `onNewIntent`, and `AppNavHost` acts on them once signed in. A chat scrolls to the
focused card when it shows it. The manifest claims `https://<linkHost>` (`app/build.gradle.kts`); the server
verifies the claim with `/.well-known/assetlinks.json`. Setup (the server's `ANDROID_APP_CERT_SHA256`) is in the
tiny-agents mobile app guide, "Links from notifications".

## Share sheet

Sharing from another app (a file, photos, a link, selected text) lists Tiny Agents in Android's share sheet.
`ShareActivity` opens a sheet over the sharing app, in that app's task: a To field that searches the bots and shows
the chosen one as a chip, the bot list, and a composer with what was shared (each file or the text as a removable
card), a note, a paperclip to add more files, and Send.

- **What is read.** `data/Share.kt` reads `ACTION_SEND` and `ACTION_SEND_MULTIPLE`: files from `EXTRA_STREAM` (or the
  clip data), text from `EXTRA_TEXT`, and a link's page title from `EXTRA_SUBJECT`, set above the link.
- **Sending.** Files upload as soon as the sheet opens (`POST /uploads`), while the read grant lasts. Send waits for
  them, then posts one message: the note, a blank line, then the shared text, with the files attached. The send runs
  through `ChatStore`, so a message the server does not answer keeps retrying with the same request id. The sheet
  closes when the server takes it, or after 8 s with "Sending when you are back online". Closing the sheet without
  sending deletes what it uploaded. The app then opens on the chat the share went to.
- **Direct Share.** `data/ShareTargets.kt` publishes the top four bots in the drawer's order (pinned, then recent) as
  sharing shortcuts with their faces (`res/xml/shortcuts.xml`). Android's share sheet lists them, and picking one
  opens the sheet with that bot chosen (`EXTRA_SHORTCUT_ID` is `bot:<id>`). The same shortcuts appear on a long press
  of the launcher icon and open that bot's chat. Signing out removes them.
- **Signed out.** The sheet asks the owner to open the app and sign in.

## Security

- **Token.** `POST /auth/login` (or `/auth/setup`) returns a session token. The app sends it as
  `Authorization: Bearer` and stores it in DataStore sealed with AES-GCM under a key that stays in the Android
  Keystore. If the key is gone the token cannot be opened and the owner signs in again. A `SESSION_INVALID`
  answer signs the app out. Sign out calls `POST /auth/logout` and forgets the token and user but keeps the
  server address.
- **Cleartext.** The manifest allows plain HTTP so a server on a home network or `localhost` works. The sign-in
  screen warns that passwords and chats then travel unencrypted. Use HTTPS for anything else.
- **Step-up.** Revealing, disabling or deleting a vault item, and adding or removing a connection, need a step-up
  token. The app asks for the password, calls `POST /vault/step-up`, keeps the token in memory only, and sends it
  as `X-Vault-Step-Up`. It is used until 10 s before it expires and is cleared on any session change.
- **Bot avatars.** A bot's avatar is the web app's DiceBear "gaze" face for its name
  (`https://api.dicebear.com/10.x/gaze/png?seed=<name>`, PNG because Android draws no SVG without a library),
  loaded by `data/AvatarStore.kt` and cached in memory and on disk. The request carries only the bot's name, as
  the web client's does. When it cannot be fetched, the bot's initial is drawn instead.
- **Credential requests.** Values typed into a bot's credential request go to the server's vault route, never into
  the chat.

## Testing

Unit tests run on the JVM with Robolectric; no device or emulator is needed.

```bash
cd android
./gradlew testDebugUnitTest          # every module: app, vnc, terminal, kit
./gradlew :app:recordRoborazziDebug  # same as pnpm screenshots
```

There are three kinds of test in `android/app/src/test/kotlin/groot/mobile/`, plus each protocol module's own
tests under `android/vnc/src/test/` and `android/terminal/src/test/`:

1. **Unit tests** with fakes: the chat reducer (`ChatSessionTest.kt`), tool call text (`ToolCallTextTest.kt`) and
   app logic (`AppLogicTest.kt`). No network, clock or disk.
2. **Screenshots.** `ScreenshotTest.kt` renders sign-in, chat, the drawer, Settings and About in light and dark.
   A normal test run checks they render; `pnpm screenshots` writes the PNGs to
   android/app/build/outputs/roborazzi/ for review. They are not a golden-image gate.
3. **Live-server tests.** `LiveServerTest.kt` runs the data layer against a real tiny-agents server: sign-in, a
   streamed chat, steering, approvals, questions, uploads, past chats and the management routes. It creates and
   deletes its own rows. `SandboxLiveTest.kt` also opens a terminal tab and streams a bot's browser and computer
   over the VNC bridge. Both are skipped unless the environment variables below are set.

Start a disposable server in the tiny-agents repo (faux model, own database, demo account), then run the tests
from this folder:

```bash
# in the tiny-agents repo
node .agents/skills/verify-tiny-agents/scripts/ta-verify.mjs up              # add --sandbox after pnpm sandbox:up

# in mobile/android
TINY_AGENTS_URL=http://localhost:3100 ./gradlew :app:testDebugUnitTest --tests groot.mobile.LiveServerTest --rerun
TINY_AGENTS_URL=http://localhost:3100 TINY_AGENTS_SANDBOX=1 ./gradlew :app:testDebugUnitTest --tests groot.mobile.SandboxLiveTest --rerun
```

`TINY_AGENTS_EMAIL` and `TINY_AGENTS_PASSWORD` override the demo account. `--rerun` is there because Gradle does
not count environment variables as test inputs and would otherwise reuse an earlier skipped result.
`SandboxLiveTest` saves its frames as PNGs under android/app/build/outputs/sandbox-live/.

## Known limits

- Android only. There is no iOS app.
- No push notifications. The app shows activity only while it is open.
- These stay in the web app: the Code page (coding agents), the Models section of Settings (providers), passkey sign-in,
  creating vault items, importing skills from GitHub, and the connection tool playground.
- Routine schedules are entered and shown in IST, like the server.
- Plain-HTTP servers are allowed, with a warning on the sign-in screen.
- The app has not been run on a device or emulator in the build environment. It is verified by JVM tests
  against a real server and by rendered screenshots only.
