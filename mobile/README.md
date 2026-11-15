# Tiny Agents for Android

The native Android client for tiny-agents, a messenger where every contact is an AI bot. It signs in to a
tiny-agents server you run and talks to the same API as the web app. Kotlin and Jetpack Compose, built from the
groot-mobile-app boilerplate.

## What you can do

- **Chat with bots.** Replies stream in. Attach photos and files, steer a running reply or queue a message for
  after it, take back a queued message, stop a reply, start a new chat and scroll back through older messages.
- **Share to a bot.** Share files, photos, links or text from any app: pick the bot (your top bots show in
  Android's share sheet), add a note and send.
- **Answer bots.** Approve or deny a tool call, answer a bot's questions, fill a credential request, and turn on
  YOLO mode for a chat.
- **Manage bots.** Create, edit, pin and delete bots: model, behaviour, tools, skills, connections and the guests
  a bot is shared with. Read, continue or delete past chats.
- **Watch and drive.** The live Browser and Computer views stream a bot's Chrome or desktop. Take control, hand it
  back, reset it, or open an app on the desktop.
- **Terminal.** Tabs on the sandbox VM, with a full xterm screen.
- **The rest of the workspace.** Tasks, Routines, Skills, Memory, Connections (MCP servers), Vault and People.
- **Guests.** A guest account sees only the bots shared with it, without the management screens.

## Build and install

You need JDK 21, the Android SDK with `ANDROID_HOME` set, Node 22 and pnpm 10 (details in
[`docs/quick-start.md`](docs/quick-start.md)).

```bash
cd mobile
pnpm install
pnpm android:build    # debug APK at android/app/build/outputs/apk/debug/app-debug.apk
adb install android/app/build/outputs/apk/debug/app-debug.apk
```

Or download the `tiny-agents-debug-apk` artifact from the repo's Mobile workflow run on GitHub Actions and
install that APK.

## First run

1. Enter your server's address, for example `agents.example.com`. The app adds `https://`, or `http://` for
   `localhost`, a bare IP or a `.local` name. A plain-HTTP server works, with a warning.
2. Sign in with your tiny-agents email and password. If the server has no account yet, the app creates the
   first one.

Settings shows the account and server, the theme, and Sign out.

## Test

```bash
pnpm check            # repo checks, Android lint and unit tests
pnpm android:test     # unit tests only
pnpm screenshots      # renders screens to android/app/build/outputs/roborazzi/
```

Tests against a real server are in [`docs/app/README.md`](docs/app/README.md#testing).

## Sync

This folder is a child of groot-mobile-app. `pnpm groot:check` shows what would sync from the boilerplate and
`pnpm groot:sync` applies it; see [`docs/guides/sync.md`](docs/guides/sync.md), "Apps inside a monorepo".

## More

- App guide (architecture, screens, protocols, security, limits): [`docs/app/README.md`](docs/app/README.md)
- Rules for agents and humans: [`AGENTS.md`](AGENTS.md)
