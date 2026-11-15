# Android app

`mobile/` holds Tiny Agents for Android, a native client (Kotlin and Jetpack
Compose) for a tiny-agents server. It is a second client of the same server,
not a separate product: it signs in to the server you run and calls the same
`/api/v1` routes as the web app. The app guide, with every screen and the
routes it calls, is
[`mobile/docs/app/README.md`](../../mobile/docs/app/README.md).

## What it does

The app covers the messenger and most of the workspace: chats with streamed
replies, attachments, steering and queued messages, approvals, questions,
credential requests and YOLO mode; creating and editing bots; past chats; the
Browser and Computer live views with take control; Terminal tabs; and Tasks,
Routines, Skills, Memory, Connections, Vault and People. Guests see the bots
shared with them.

## How it talks to the server

- **Sign-in.** `POST /api/v1/auth/login` returns a session token. The app
  sends it as `Authorization: Bearer` and stores it sealed with an Android
  Keystore key. The web app's cookie session is not used.
- **Streams.** Chats and the activity feed use the same server-sent event
  routes as the web client (`GET /api/v1/bots/:id/stream`,
  `GET /api/v1/events`) and reconnect with a backoff.
- **Live views and terminal.** The app asks a ticket route for a WebSocket
  path, then speaks raw RFB (VNC) or pty bytes over it. The protocol clients
  are their own Gradle modules, `mobile/android/vnc` and
  `mobile/android/terminal`.
- **Step-up.** Vault changes and adding or removing a connection ask for the
  password and send the step-up token, as the web app does.

## Links from notifications

A push notification links to the web app (`/chats/<bot>?focus=approval:<task>`,
see [notifications](./notifications.md)). The Android app claims those links
for one server, so tapping one on the phone opens the app on that bot's chat,
scrolled to the waiting card, instead of the browser.

| Link                                                     | Opens                                      |
| -------------------------------------------------------- | ------------------------------------------ |
| `/chats/<bot>?focus=approval\|question\|takeover:<task>` | The bot's chat, scrolled to the card       |
| `/chats/<bot>`                                           | The bot's chat                             |
| `/vault/requests/<task>`                                 | The asking bot's chat, on the sign-in card |
| `/vault`, `/routines`, `/tasks`                          | That screen                                |

`/code/…` links stay in the browser. A link to another server than the one the
app is signed in to just opens the app.

**Setup.**

1. The server's host is built into the app: `linkHost` in
   `mobile/android/app/build.gradle.kts` (build with
   `-PtinyAgents.linkHost=agents.example.com` for another).
2. Android opens the links in the app without asking only once it has
   verified them against the server. Set `ANDROID_APP_CERT_SHA256` on the
   server to the app's signing certificate SHA-256 (comma-separated for
   several); the server then serves `/.well-known/assetlinks.json`
   (`apps/web/src/server/api/system/app-links.ts`). Read the fingerprint from
   a release APK with `apksigner verify --print-certs app-release.apk`.
   `ANDROID_APP_PACKAGE` overrides the app id `io.nesin.tinyagents`.
3. Install (or reinstall) the app after the server serves the file: Android
   verifies at install time. Until then, the links open in the app only if
   App info → Open by default → Add links lists the server and it is ticked.

## Keeping it in step with the web app

The app's wire types mirror `apps/web/src/shared/api/` and
`apps/web/src/shared/bot-stream.ts`. Its chat reducer is a port of the web
client's `apps/web/src/client/lib/chat-session.ts`, and its tool call text and
view tables port `lib/tool-call-text.ts` and `lib/tool-call-view.ts`, and
`AttachmentNotes.kt` ports `lib/attachment-notes.ts`. A
change to a wire type or to these chat rules needs the matching change in
`mobile/android/app/src/main/kotlin/groot/mobile/data/`.

## Where it lives

`mobile/` was created from the groot-mobile-app boilerplate with
`scripts/new-app.sh ... --platforms android`. It has its own `package.json`,
lockfile and checks, and the web repo's lint and format skip it (`mobile/**`
in the root `vite.config.ts`). App code is under
`mobile/android/app/src/main/kotlin/groot/mobile/`. The web app's own groot
sync and `pnpm check` do not cover it.

## Build, test, sync

Run these from `mobile/`:

```sh
pnpm install
pnpm android:build    # debug APK under android/app/build/outputs/apk/debug/
pnpm check            # repo checks, Android lint and unit tests
pnpm screenshots      # renders screens to android/app/build/outputs/roborazzi/
```

CI is `.github/workflows/mobile.yml`. On a change under `mobile/` it runs the
repo checks, Android lint and unit tests, and uploads the debug APK as the
`tiny-agents-debug-apk` artifact.

`.github/workflows/mobile-release-hub.yml` publishes a signed release APK to a
release hub server whenever `mobile/android/version.properties` changes on
main, and can be rerun from the Actions tab. It is the boilerplate's
Release Hub Publish workflow with its paths pointed at `mobile/`. Setup (the
app on the release hub, its keyless grant, the `RELEASE_HUB_URL` variable, and
`RELEASE_HUB_SLUG` if the app's slug there is not `tiny-agents`) is in
`mobile/docs/guides/release-hub.md`. Bump
`mobile/android/version.properties` before each release.

The live-server tests run the app's data layer against a disposable server
started with `.agents/skills/verify-tiny-agents/scripts/ta-verify.mjs up`;
the app guide has the commands.

Sync with the boilerplate runs inside `mobile/` with `pnpm groot:check` and
`pnpm groot:sync` (see `mobile/docs/guides/sync.md`, "Apps inside a
monorepo"). Its baseline is the git ref `refs/groot/apps/mobile/baseline`,
separate from `refs/groot/baseline`, which the web repo's own groot sync
uses. `.github/workflows/mobile-sync.yml` opens the scheduled sync PR on
the branch `chore/groot-mobile-sync`.

## Limits

- Android only. Push notifications come through Pushover; tapping one opens
  the app (see "Links from notifications").
- The Code page, the Models section of Settings, passkey sign-in, creating
  vault items, importing skills from GitHub and the connection tool
  playground stay in the web app.
- Routine schedules are in IST, like the server.
- Plain-HTTP servers are allowed, with a warning.
- It has not been run on a device or emulator in the build environment; JVM
  tests against a real server and rendered screenshots verify it.
