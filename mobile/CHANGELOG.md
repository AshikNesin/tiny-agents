# Changelog

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
