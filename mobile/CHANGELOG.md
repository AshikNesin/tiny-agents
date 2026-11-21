# Changelog

## 0.8.1

### Patch Changes

- The sign-in token is never written to disk unsealed. On a phone whose Keystore can't seal it, the app keeps you
  signed in until it closes, and asks you to sign in again next time.

## 0.8.0

### Minor Changes

- Picture in picture for a bot's Browser and Computer: the new button in the live view shrinks it to a small
  window over the chat that you drag to any corner. It only watches (the remote window keeps its size), a tap
  expands it, and the app remembers the choice and the corner, so Watch opens it the same way next time.

## 0.7.1

### Patch Changes

- Removed code comments; no behaviour change (ADR 0028).

## 0.7.0

### Minor Changes

- Quiet bots: after a Code hand-off's result or another bot's reply lands in a chat, you see only what the bot
  chose to send you. Its own words fold away with its thinking, the same as on the web.

## 0.6.2

### Patch Changes

- Notifications now always come through Google Play services, so they work without setting anything up. The app
  no longer registers through a UnifiedPush app such as ntfy; a phone registered through one moves to Google the
  next time the app opens. A phone without Play services says so in Settings, Notifications.

## 0.6.1

### Patch Changes

- Notifications: when your server is too old to send phone notifications, Settings now says to update it, instead
  of hiding the Notifications section without a word. The app registers again each time you come back to it, so
  updating the server or allowing notifications in Android settings turns them on without a restart, and Settings
  has "Try again" and "Allow notifications" for the states that need them.

## 0.6.0

### Minor Changes

- Notifications on your phone. After you sign in, the app asks to show notifications and registers with your
  server, through a UnifiedPush app such as ntfy when you have one, else through Google Play services; neither
  needs a Firebase project, so it works for any server. An approval comes with the chat card's buttons (Deny,
  Approve, and Always allow or For this chat), which work once the phone is unlocked, and it goes away when you
  answer it anywhere. Settings shows whether notifications are on and sends a test.

## 0.5.1

### Patch Changes

- Code: a binary file, or one over 2 MB, in a thread's changes now says so ("Binary file. Its contents are not
  shown." or "This file is too large to show here") instead of an empty diff, and a binary file's row is marked
  binary before you open it. The server already holds every harness's diffs to these rules.

## 0.5.0

### Minor Changes

- Code: your coding agents' threads, live. Watch a turn stream, steer it or queue a message for when it ends, stop
  it, allow or deny tool calls and answer questions, and change the model, reasoning and permissions. Start a thread
  in a directory or a project, review its changes (and comment on a project branch's lines), and run its pull
  request: publish, Auto-fix, auto-merge and merge. Code pushes and a bot's hand-off card open the thread in the app.

## 0.4.0

### Minor Changes

- Share to a bot from any app. Tiny Agents shows in Android's share sheet for files, photos, links and text, and
  opens a sheet over the app you shared from: search and pick the bot, see what goes, add a note, attach more and
  send. Your top four bots also show by face in the share sheet as Direct Share targets, and on a long press of the
  app icon, where they open that bot's chat.

## 0.3.1

### Patch Changes

- Republish 0.3.0, whose release build never started: the release now builds on the `instabox-medium` runner. The app is
  unchanged from 0.3.0 (push notification links open the app on the waiting card).

## 0.3.0

### Minor Changes

- Tapping a push notification opens the app instead of the browser: the app claims the server's links
  (`/chats/<bot>?focus=approval:<task>`, sign-in requests, Vault, Routines, Tasks), opens that bot's chat and scrolls
  to the waiting card. Android opens them without asking once the server serves `/.well-known/assetlinks.json`
  (`ANDROID_APP_CERT_SHA256`).

## 0.2.0

### Minor Changes

- 72226c0: Show each bot's avatar, the same DiceBear face the web app draws, in the drawer, the Home top bar, the bot menu,
  an empty chat, messages from other bots and the bot editor (where it previews as you type the name). Tidy the
  navigation: the Home top bar keeps only the menu, the bot and New chat (the duplicate menu button is gone, and the
  model name moved into the bot menu), the drawer's nine workspace places become a compact grid of tiles, and the
  bot menu opens with the bot's face and its places as tiles.

### Patch Changes

- 5755f4b: Clear the app's lint warnings: drop the boilerplate demo strings and icons this app never uses, add
  backup and data-extraction rules that exclude everything (the sealed auth token is useless off this
  device), and silence the obsolete AndroidX lifecycle lint check in `:vnc` and `:terminal`. The sync
  scripts pick up the boilerplate's React Doctor fixes.
- 6d3d4d3: Fixes found testing against a real server. A message sent with a file no longer shows the server's notes for the
  model (`[file attached: …]`, the fenced file text and the tool hint) in its bubble, as the web app already hid
  them. Switching bots no longer leaves the previous bot's face in the top bar. Home refreshes the bot list when the
  app comes back to the foreground, so bots created or pinned in the web app show up.
- b3fdbe7: Fold a chat's routine runs into one quiet line, as the web app does: back-to-back runs on the same day read
  "Process emails from key senders · ran 24× · last 16:20", with failures and runs that need attention called out on
  a second line, instead of one "Routine … ran" line per run. Tapping it lists the latest runs, and every run that
  had a problem, with their output and errors.
