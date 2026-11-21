# tiny-agents

## 1.5.0

### Minor Changes

- [#428](https://github.com/AshikNesin/tiny-agents/pull/428) [`8fb6195`](https://github.com/AshikNesin/tiny-agents/commit/8fb619505ecf2927a276b6a813c73dfcd3fb54f2) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Bring back 1Password for the vault, and run 1Password Connect inside the app. Set `OP_CONNECT_CREDENTIALS` to the Connect server's `1password-credentials.json` and `OP_CONNECT_TOKEN` (and `OP_CONNECT_ADMIN_TOKEN` to create and edit items from the Vault page): the app pulls 1Password's pinned Connect binaries onto the data volume on first start and runs them itself, so there is no second service to deploy. `OP_CONNECT_HOST` still points at a Connect server running elsewhere, and `OP_CONNECT_VAULT_ID` is now optional when the token sees one vault. The Vault page shows a 1Password card only once it is set up.

- [#410](https://github.com/AshikNesin/tiny-agents/pull/410) [`523d07f`](https://github.com/AshikNesin/tiny-agents/commit/523d07f3e610708d918ebabe965179b3a645212a) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Browser: `browser_screenshot` takes `labels: true` to draw each visible control's ref on the image, so a bot can click what it sees without taking a separate snapshot.

- [#354](https://github.com/AshikNesin/tiny-agents/pull/354) [`6e51a6a`](https://github.com/AshikNesin/tiny-agents/commit/6e51a6a39490da0edccb8883f689d387974ed94d) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Browser: clicks, typing, Enter, navigation and going back now return the page after them: a new page's first part, or on the same page only the lines that changed. Bots need far fewer separate snapshots. New `browser_wait_for` waits for text to show or go away. Tool descriptions point plain reading at `web_fetch`.

- [#348](https://github.com/AshikNesin/tiny-agents/pull/348) [`82e296c`](https://github.com/AshikNesin/tiny-agents/commit/82e296c358edbae3385764e9bcc64801c37c7465) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Browser: bots can now read past the top of a long page. Snapshots are compact (about half Playwright's size, every word kept), come in windows with an `offset` to read on, and narrow to a region (`ref`) or to lines with given words (`query`). New `browser_read_text` reads an article as plain text and `browser_back` goes back. Clicks and Enter that open a page wait for it, so the next read is of the new page. Only the newest two long page reads stay in the model's context.

- [#407](https://github.com/AshikNesin/tiny-agents/pull/407) [`f2a05b3`](https://github.com/AshikNesin/tiny-agents/commit/f2a05b3569b0bfd5c82485e34d5d38231016190d) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Browser: a click that opens a new tab now takes the bot into that tab instead of leaving it on the old page. New `browser_tabs` lists the bot's tabs, switches back to one, or closes one.

- [#323](https://github.com/AshikNesin/tiny-agents/pull/323) [`9e53b21`](https://github.com/AshikNesin/tiny-agents/commit/9e53b21fc967039cfefb55a1928b7143176d0abf) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code: a calmer workspace, after Amp and Hoplite. A finished turn folds its thinking, progress notes and tools behind one "Worked for …" row, leaving the answer in view; inline code is neutral gray mono; the thread list stays grouped by repository by default (turned off, one flat list, newest first) with search behind its icon; the composer says "Send a message…" with one "Model · Reasoning" label; an archived thread offers one Unarchive to continue; the header's Changes and PR become one switch that shows the PR's CI state; the PR tab leads with a status line and a Checks / Reviews / Comments row with a checks bar; diffs use a quiet tint and a colored edge.

- [#373](https://github.com/AshikNesin/tiny-agents/pull/373) [`d7ba0d2`](https://github.com/AshikNesin/tiny-agents/commit/d7ba0d283b4c5ef643aaf1290aa022c1238b6ef7) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code: each project picks whether new PRs open as drafts or ready for review (Settings, Pull requests, "Open new PRs as drafts", on by default), and the PR tab's Draft switch flips an open PR either way at any time.

- [#344](https://github.com/AshikNesin/tiny-agents/pull/344) [`3f77aa8`](https://github.com/AshikNesin/tiny-agents/commit/3f77aa8c4c2a6fbc1c20e1bb2bbddfb6e5f7d764) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code: when a turn ends, the empty composer suggests your likely next message, after t3code. Tab fills it in (Use on touch), Esc dismisses it. One small `chat_title` call per finished turn, on the last message and answer only, kept for later asks.

- [#369](https://github.com/AshikNesin/tiny-agents/pull/369) [`5a6b952`](https://github.com/AshikNesin/tiny-agents/commit/5a6b9520fbb9c0816efdaca22d6063c028d11c7c) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code: a thread's Source control now uses the same diffshub layout as PR reviews. Every changed file sits in one scrolling column under a sticky header you can fold (Viewed folds it too), and the files show as a tree with search, a status filter and diff stats: a drawer behind Files in the side panel, beside the diffs on the Review page, where split or unified view and Fold all files sit too.

- [#350](https://github.com/AshikNesin/tiny-agents/pull/350) [`71f1d44`](https://github.com/AshikNesin/tiny-agents/commit/71f1d44db8c1fad3044e658132b5a471b7d06329) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code: comment on a pull request's lines in a review and submit the review on GitHub. **Comment** adds to your review, **Ask assistant** asks about the lines, and **Suggest change** starts a GitHub suggestion. **Submit review** posts every comment with a summary and Comment, Approve or Request changes; on your own PR it offers Comment only, and comments on a PR a Code thread opened can go to that thread instead.

- [#351](https://github.com/AshikNesin/tiny-agents/pull/351) [`0124afe`](https://github.com/AshikNesin/tiny-agents/commit/0124afe394c48ee19ef214284968c76cd706e383) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code: a PR review shows the pull request's conversations from GitHub under their lines, with Reply and Resolve. Resolved ones start folded; ones on a newer commit or on code that changed are listed above the file's diff.

- [#349](https://github.com/AshikNesin/tiny-agents/pull/349) [`d0a2b04`](https://github.com/AshikNesin/tiny-agents/commit/d0a2b0487fbd08089274d41b1cefb1a30ece3ea2) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code: review any pull request, yours or someone else's, in focus mode. **Reviews** in the sidebar opens a PR by its link; the page shows its changes at full height with an AI assistant beside them. The assistant starts on your first question, in a checkout of the PR, with a short card of the PR instead of the diff.

- [#343](https://github.com/AshikNesin/tiny-agents/pull/343) [`028e0b5`](https://github.com/AshikNesin/tiny-agents/commit/028e0b5e591f07e10bf32709d51e66f0b411104a) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code: drag the divider between a thread and its right panel (Source control / Pull request) to resize them. The width is remembered in this browser, a double-click resets it, and the divider works from the keyboard (arrow keys, Shift for bigger steps, Home/End, Enter to reset). Phones are unchanged.

- [#368](https://github.com/AshikNesin/tiny-agents/pull/368) [`45c8523`](https://github.com/AshikNesin/tiny-agents/commit/45c8523a811f640743b620ef437299d2b9fb68a1) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code: a PR review now looks and works like diffshub. The changed files are a tree on the left (Files and Comments tabs, search, a status filter, diff stats) and every diff sits in one scrolling column with sticky headers you can fold, in split or unified view. Marking a file viewed folds it. The assistant is a folded rail on the far left until you open it.

- [#352](https://github.com/AshikNesin/tiny-agents/pull/352) [`0c57dfc`](https://github.com/AshikNesin/tiny-agents/commit/0c57dfcc809925f24ffc1282006bce4a63db3e4e) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code: the Reviews screen shows your review inbox from GitHub across every repository: pull requests that need your review, ones updated since you reviewed, ones waiting on their author, and your own. A project's PR opens its review in one click.

- [#356](https://github.com/AshikNesin/tiny-agents/pull/356) [`d875a6a`](https://github.com/AshikNesin/tiny-agents/commit/d875a6a6cb8920bd139f85cf51b9fe6203ef3bde) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code: a light editor in the Review panel, for coding threads and PR reviews. Edit over a file's diff opens it as plain text for a small fix, and Save writes it to the worktree; in a PR review it shows under Your changes, ready to push or suggest.

- [#353](https://github.com/AshikNesin/tiny-agents/pull/353) [`20fa7b3`](https://github.com/AshikNesin/tiny-agents/commit/20fa7b355df60cd1b72ddac6e404a171be1df777) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code: change a pull request from its review. "Your changes" shows what you or the assistant changed in the review's checkout, with Push to PR (a commit on the PR's branch, after a confirm, never forced), Post as suggestions and Discard; Open in terminal starts a terminal tab in the checkout.

- [#353](https://github.com/AshikNesin/tiny-agents/pull/353) [`0c835ec`](https://github.com/AshikNesin/tiny-agents/commit/0c835ec95b6ba4d55acee12d4f74fc6b79613308) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code: a pull request you reviewed before opens on the changes since your last review, with the whole PR one click away.

- [#367](https://github.com/AshikNesin/tiny-agents/pull/367) [`8a01354`](https://github.com/AshikNesin/tiny-agents/commit/8a01354cdd6ca4218df038eb6257ab4008751bb4) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code Reviews: filter the inbox by how recently a PR was updated, by repository (or projects only), and hide drafts. GitHub's search applies the filters, so they reach past the first 50 PRs, and this browser remembers them. Each row now has its own GitHub link beside it, so a click on the row always opens the review here, and a PR of a repository that is not a project says so.
  
  Open any PR straight into review from a link: `/code/review?pr=<GitHub link or owner/name#123>`, or replace `https://github.com` in a PR's address with the app's `/code/review`.

- [#357](https://github.com/AshikNesin/tiny-agents/pull/357) [`fbf39ab`](https://github.com/AshikNesin/tiny-agents/commit/fbf39ab62cba8e1e26aa5c5ecdd01af28152f7be) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code: conversations started or forked through Shelley are tagged `tiny-agents`, and the Code page lists, archives and searches only those (with their subagents), not every Shelley conversation. Existing conversations the app already tracks are tagged once on connect, so they stay listed.

- [#362](https://github.com/AshikNesin/tiny-agents/pull/362) [`bed88d6`](https://github.com/AshikNesin/tiny-agents/commit/bed88d6cbe23a94dfc3475da5b92e5b6e08330fa) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Bots load the tools few chats use (browser, computer, code, attachments, bot builder, self-improve, vault) only when they need them, as pi does: the groups are named in the prompt and loaded with `tool_search`, which saves about 7k tokens on every request that uses none of them. Tool search now comes with every bot that has something to load, not only bots with a large connection.

- [#395](https://github.com/AshikNesin/tiny-agents/pull/395) [`a27e20e`](https://github.com/AshikNesin/tiny-agents/commit/a27e20ec6b65935e942ee700c1c7588dae8cfcb4) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Live view: the Browser and Computer panels no longer pop open when a bot starts using them; the chat header's live-view button lights up instead. A new picture-in-picture button shrinks the live view to a small floating window over the chat (drag it anywhere, on desktop or phone), and the choice is remembered.

- [#364](https://github.com/AshikNesin/tiny-agents/pull/364) [`5b4877d`](https://github.com/AshikNesin/tiny-agents/commit/5b4877da9561285aeeadf7cd349f182cec23190c) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Traces: a new page lists every LLM call your bots make, grouped by session (chats, Past chats, routine runs, bot-to-bot messages) with model, tokens, cache use, cost and timing per call and per tool. It reads the conversations the app already stores and adds no model calls. Side-calls (memory capture, chat titles, Code naming, auto-review) now keep one metadata row each in `llm_calls`, never the prompt or the answer, pruned after 30 days.

- [#327](https://github.com/AshikNesin/tiny-agents/pull/327) [`43b23c7`](https://github.com/AshikNesin/tiny-agents/commit/43b23c796fd28c56d5fd4543cd362c757d8e8b81) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Notifications go to one place at a time.
  
  - **One choice.** A new `deliverTo` setting (`webpush` for the phone app, `pushover`, `off`, or `auto`) replaces the per-channel `channels` switches. Only the chosen channel sends; `auto`, the default, is the phone app once a phone is registered, else Pushover.
  - **A simpler Settings → Notifications.** One "Phone app / Pushover / Off" picker shows only the chosen channel's details (its phones, or Pushover's status and test), then what to send and the log. `NotificationSettings` takes the app's extra `destinations`.

- [#322](https://github.com/AshikNesin/tiny-agents/pull/322) [`5eab443`](https://github.com/AshikNesin/tiny-agents/commit/5eab443f183191bd98717246038c2712c482faeb) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Phone notifications over Web Push (issue [#306](https://github.com/AshikNesin/tiny-agents/issues/306)), with no setup on the server.
  
  - **A Web Push channel beside Pushover.** The server makes its own VAPID key on first use and sends each registered device an end-to-end encrypted push (RFC 8291, RFC 8292) through Google's FCM on phones with Play services. No Firebase account, relay or env var.
  - **Devices.** `GET /notifications/vapid-key` and `/notifications/devices` (register, list, test, remove; owner only). Endpoints must be https and public. A device the push service forgot is revoked; one that keeps failing shows as failing.
  - **Approve from the notification.** Approval pushes carry the chat card's buttons for the app to show: Approve, Deny and Always allow for a tool, Approve, Deny and For this chat (when grantable) for a vault use.
  - **Taken back when answered.** Answering an approval or question anywhere takes its push off the phone; a reminder replaces the first push instead of stacking.
  - **Settings → Notifications** lists the phones with a test and remove each, and a switch for the whole channel.
  - `@groot/core`: `NotificationHub` fans each notification out to every channel, each with its own pipeline and log row; channels get the tag, event, path and buttons of what they send and an optional `dismiss(tag)`.

- [#337](https://github.com/AshikNesin/tiny-agents/pull/337) [`0be5adf`](https://github.com/AshikNesin/tiny-agents/commit/0be5adf079db95fc0d1f2a5f868e21cf115467be) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Two more cost guards. One reply may now make at most 150 tool calls, through all its tool rounds: past that the Tool gate refuses calls so the model wraps up, and a reply that keeps calling 20 more is stopped (the Claude plan keeps its own `maxTurns`). And a message one bot sends another (`message_bot`) now runs in a fresh conversation of the target's own, unattended and with a routine run's 500k-token budget, instead of in the target's chat with its whole history: answering no longer re-sends that history, and a routine that messages a bot can no longer escape its own budget that way. The reply is still relayed into the sender's chat; the target's chat no longer shows the exchange, and the target answers from the message alone. Owner @mentions still go to the target's chat. `bot_messages.own_conversation` marks these conversations.

- [#397](https://github.com/AshikNesin/tiny-agents/pull/397) [`c69d75a`](https://github.com/AshikNesin/tiny-agents/commit/c69d75a6dca03ec2f8123a75bc217e5d897baa3f) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Quiet bots (issue [#396](https://github.com/AshikNesin/tiny-agents/issues/396)): a new `message_owner` tool is how a bot speaks when you didn't start the turn. A routine run pushes only what it sends with it, so a run with nothing new stays silent. After a Code hand-off's result or another bot's reply lands in a chat, the bot's own words fold away with its thinking and only what it sent shows, with a "Bot messages" push when you're away. Replies to your own messages are unchanged.

- [#371](https://github.com/AshikNesin/tiny-agents/pull/371) [`d68a3d9`](https://github.com/AshikNesin/tiny-agents/commit/d68a3d9b9fc1ce2e4d410f413598ecf8f2b52fa4) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Traces: a session's page now shows the whole interaction, not just which calls ran. Each turn shows the prompt, the model's thoughts and replies, and every tool call, which opens to its input and output, plus where the context was summarized. A sidebar counts prompts, agent responses, thinking, tool calls (per tool) and compactions and filters the transcript to the ones you check; on a phone it folds under Filter. Everything is read from the conversation's stored entries; nothing new is stored.

### Patch Changes

- [#462](https://github.com/AshikNesin/tiny-agents/pull/462) [`816ee8e`](https://github.com/AshikNesin/tiny-agents/commit/816ee8e32843905856da0d181eeeadb1914697f5) Thanks [@AshikNesin](https://github.com/AshikNesin)! - 1Password: the app's own keys (model provider keys, the GitHub App private key and webhook secret) now go to 1Password too, and **Move N local items here** on the Vault page moves the existing ones. The server keeps using the last value it read while Connect is starting or down, and waits a few seconds for a cold Connect, so GitHub webhooks and model calls keep working across a restart. MCP connection secrets stay local.

- [#461](https://github.com/AshikNesin/tiny-agents/pull/461) [`8e32473`](https://github.com/AshikNesin/tiny-agents/commit/8e3247380b33775bf6b61abda223e301f2117335) Thanks [@AshikNesin](https://github.com/AshikNesin)! - 1Password: saving a new item no longer fails with "Item not found in 1Password." while Connect's copy catches up, and a write Connect refuses now says which step failed in Connect's own words. The 1Password card on the Vault page can move the bots' local items into 1Password in one step; the app's own keys and connection secrets stay local.

- [#469](https://github.com/AshikNesin/tiny-agents/pull/469) [`3c1db08`](https://github.com/AshikNesin/tiny-agents/commit/3c1db0887d400997468b07e9b6eaf16680310cb7) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Chat: a message sent just before a bot asks questions now dismisses them, instead of waiting as "Steering" until the questions are answered. A failed tool call says "failed" beside its label. Chat previews keep underscores inside names. On a phone, Chats with no bots yet shows the menu button. Notifications on a fresh server show the phone app, not an unset Pushover.

- [#409](https://github.com/AshikNesin/tiny-agents/pull/409) [`e45ffb6`](https://github.com/AshikNesin/tiny-agents/commit/e45ffb6924bc46ada05a30c1ed97dbc28fa4c47d) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Messages that queue while a bot is replying (your follow-ups, hand-off results, other bots' replies) are now answered together in one run instead of one run each, which saves a model request per extra message (issue [#396](https://github.com/AshikNesin/tiny-agents/issues/396)). Each queued message still gets the shared reply, and a batch you wrote in is never folded away as a quiet turn.

- [#378](https://github.com/AshikNesin/tiny-agents/pull/378) [`86419ef`](https://github.com/AshikNesin/tiny-agents/commit/86419efe66e5fdd468ed49a9d78e8ae1d5c4f14f) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Browser: sites behind a bot check (amazon.in, Cloudflare) open. `browser_navigate` waits through a challenge page that solves itself instead of returning its empty 202, and Chrome tells sites the owner's language and time zone (`BROWSER_LOCALE`, default `en-IN`; `BROWSER_TIMEZONE`, default `Asia/Kolkata`) instead of the VM's en-US and UTC. The local headless browser no longer reports `navigator.webdriver` or a `HeadlessChrome` user agent.

- [#361](https://github.com/AshikNesin/tiny-agents/pull/361) [`e1a8641`](https://github.com/AshikNesin/tiny-agents/commit/e1a864136c997097451f129f278b0e56468d997c) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Bots on the Claude plan read the same tool descriptions and parameter details as other bots, and are no longer offered tools that are not set up. A connection's tool descriptions are cut to 2,048 characters, as Claude Code does, since every request re-sends them.

- [#377](https://github.com/AshikNesin/tiny-agents/pull/377) [`b7c2343`](https://github.com/AshikNesin/tiny-agents/commit/b7c2343bfd605569e140266265b9d9e847147a2b) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code: the new-thread composer starts in Bypass (YOLO, no permission prompts) wherever the harness offers it. Guests, who have no Bypass, still start in Accept edits, and the permission chip still changes the mode per thread.

- [#340](https://github.com/AshikNesin/tiny-agents/pull/340) [`6e07b8e`](https://github.com/AshikNesin/tiny-agents/commit/6e07b8eca1a0b2d13f5791f0dc1eda0d2e746e5b) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code: select a range of diff lines to comment on, like GitHub. Each line number in the Source control diff is now a Comment button: click one, then drag down the numbers (mouse or finger) or shift-click another to take a range, and the composer opens under the range's last line. Widening a range keeps what you typed.

- [#346](https://github.com/AshikNesin/tiny-agents/pull/346) [`bc528ac`](https://github.com/AshikNesin/tiny-agents/commit/bc528ac8a3b8e3cecb8ae2b7a476992aa79e99d7) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code: every diff is drawn with diffs.com (`@pierre/diffs`), with syntax colors and word-level highlights: the Source control and Review panels and the patches in a thread. Line comments work as before: click a line number, then drag or shift-click to take a range. A range that runs from removed lines into added ones is commented on by its added lines.

- [#408](https://github.com/AshikNesin/tiny-agents/pull/408) [`532e2d4`](https://github.com/AshikNesin/tiny-agents/commit/532e2d42af641b4c5de171fe8acf19a8c95aac15) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code: a Shelley thread shows a commit by its branch instead of the worktree's full path; the thread header shows a PR's number as soon as it opens; and Merge stays shut, saying why, while a check fails or the branch conflicts.

- [#359](https://github.com/AshikNesin/tiny-agents/pull/359) [`c131fe5`](https://github.com/AshikNesin/tiny-agents/commit/c131fe5229c54f3306e8dd0772ecdfeba148fbc0) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code: smoother reviewing. Clicking a diff line number puts the cursor straight in the comment box. A PR review's header names its branches (one row less above the diff), and on phones its terminal, Update and Open on GitHub fold into one menu so the title stays readable. The Reviews screen shows each PR once and lines its rows up. The Threads and Reviews screens get a back arrow and a roomier search on phones, and a lone Source control tab reads as a title.

- [#393](https://github.com/AshikNesin/tiny-agents/pull/393) [`0fa78c7`](https://github.com/AshikNesin/tiny-agents/commit/0fa78c7afa82f329c8efc9f2e69e162e5e420f61) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code: a coding hand-off's result now goes back to the conversation that asked for it. A routine run's hand-off reports into that run's conversation (on its budget) instead of waking the bot's chat with its whole history, and a hand-off a bot started while answering another bot is answered there, with the answer relayed back to the bot that asked. A follow-up's result goes to the conversation that sent it. Hand-off threads also get a short title, like threads you start.

- [#390](https://github.com/AshikNesin/tiny-agents/pull/390) [`d5a3638`](https://github.com/AshikNesin/tiny-agents/commit/d5a36389065db5186d10a2a47dd558231dd57d59) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code: a PR on the Reviews screen from a repository that is not a project offers Add project instead of a greyed "Not a project". It opens Code settings → Projects with the repository filled in ([#386](https://github.com/AshikNesin/tiny-agents/issues/386)).

- [#370](https://github.com/AshikNesin/tiny-agents/pull/370) [`1ae5a81`](https://github.com/AshikNesin/tiny-agents/commit/1ae5a8168dfc26a678f6817ee43f4170e71b84e9) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code: the light editor (Edit on a file's diff) now keeps the code's syntax colors, line numbers and bracket matching while you type, using diffs.com's editor. Save is still ⌘S.

- [#388](https://github.com/AshikNesin/tiny-agents/pull/388) [`c6c94a0`](https://github.com/AshikNesin/tiny-agents/commit/c6c94a0691c0ed35ddf9021ff38d8ac6e7fce2c5) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code: merging from the Pull request tab no longer leaves the thread broken. Once the merge archives it, the tab stays and leads with the merged PR, the breadcrumb keeps the project, Source control says the worktree went with the archive instead of "invalid cwd", and the composer offers Unarchive ([#383](https://github.com/AshikNesin/tiny-agents/issues/383)).

- [#416](https://github.com/AshikNesin/tiny-agents/pull/416) [`2abce37`](https://github.com/AshikNesin/tiny-agents/commit/2abce370cd651f9401474aae2658a065e6b731dd) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code: the new-thread composer remembers a picked model and reasoning level as soon as you pick it, so leaving the Code page and coming back keeps your choice, in a project too ([#319](https://github.com/AshikNesin/tiny-agents/issues/319)). Vault: when a bot's sign-in field sits in another site's frame (The Hindu's sign-in lives in an id.tinypass.com frame), the credential card now says so and names that site, instead of claiming the page moved ([#302](https://github.com/AshikNesin/tiny-agents/issues/302)). Nothing is filled there, as before.

- [#331](https://github.com/AshikNesin/tiny-agents/pull/331) [`f4e501c`](https://github.com/AshikNesin/tiny-agents/commit/f4e501ce10c165f019ac62c9255c027ebfcd2aa9) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code: one small model call names a new thread with a short title and its branch (`ta/<what-it-does>`, named for the outcome), and a pull request gets a crisp title from its commits. The PR tab shows each check once: its latest run, instead of every re-run of a workflow on the same commit.

- [#387](https://github.com/AshikNesin/tiny-agents/pull/387) [`aed1b36`](https://github.com/AshikNesin/tiny-agents/commit/aed1b36fa8b2a9188cf6e1c73b8eac6235b9c17c) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code: thread titles, branch names and PR titles are a short summary again when the default model is a Claude plan model. Titles and memory capture now fall back to a model a side call can run (the bot's, the default, or the first API model), instead of a Claude plan model that made the call skip and left the task's first words ([#382](https://github.com/AshikNesin/tiny-agents/issues/382)).

- [#321](https://github.com/AshikNesin/tiny-agents/pull/321) [`9f9fe11`](https://github.com/AshikNesin/tiny-agents/commit/9f9fe114e906608d1219a6d4fb0770680055c453) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code: the PR tab shows the pull request's description as markdown (headings, lists, code, links; a template's `<!-- -->` hints hidden, as on GitHub), and **Edit** changes it on GitHub while the PR is open (⌘↵ saves). The GitHub client gains `updatePull` for a PR's title or description.

- [#375](https://github.com/AshikNesin/tiny-agents/pull/375) [`b266c64`](https://github.com/AshikNesin/tiny-agents/commit/b266c649b0b4aa2beda65de72c57db9dc8134099) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code: a thread with an open pull request has a GitHub link beside the PR chip in its header, so the PR opens on GitHub in one click; the chip still opens the Review panel. A thread's list row now carries its PR's `url`.

- [#389](https://github.com/AshikNesin/tiny-agents/pull/389) [`f23e109`](https://github.com/AshikNesin/tiny-agents/commit/f23e1097c05dfc9f517954f96c535489737f4296) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code: teammates' comments on your PR no longer each carry an "Ignored" badge. While Auto-fix is on, the ones it will not act on say "Auto-fix skips", with why on hover; with Auto-fix off there is no mark ([#385](https://github.com/AshikNesin/tiny-agents/issues/385)).

- [#389](https://github.com/AshikNesin/tiny-agents/pull/389) [`f23e109`](https://github.com/AshikNesin/tiny-agents/commit/f23e1097c05dfc9f517954f96c535489737f4296) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code: the Pull request tab shows only what can act. Fix appears with an open review comment or a conflict, the Auto-fix status and the spend limit while Auto-fix is on, Comments once there are some, and before a PR exists the branch line leads without a header repeating the tab's name ([#384](https://github.com/AshikNesin/tiny-agents/issues/384)).

- [#338](https://github.com/AshikNesin/tiny-agents/pull/338) [`7dedacc`](https://github.com/AshikNesin/tiny-agents/commit/7dedacc2f911fc9594d59c10a5df2157871a4a5a) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code: under the GitHub App, a comment is never trusted just because it comes from the login the client acts as, on the pull request tab and on "Fix CI" as well as in Auto-fix's own looks. The tab's "Ignored" label now follows the same rules as Auto-fix, so a resolved comment or an approval is no longer labelled Ignored.

- [#366](https://github.com/AshikNesin/tiny-agents/pull/366) [`29a6c9d`](https://github.com/AshikNesin/tiny-agents/commit/29a6c9de040e057d8cb48cfad494a389fb0bb405) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code: a review's file list, left of the diff, can be resized like the assistant on the right: drag its divider or use the arrow keys, and the width is remembered. Double-click or Enter goes back to the default.

- [#320](https://github.com/AshikNesin/tiny-agents/pull/320) [`1bd5b8e`](https://github.com/AshikNesin/tiny-agents/commit/1bd5b8e5f5e580ef9e3aec80e80c16d3133494b5) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code: comment on a diff line in the thread, like a review.
  
  - **Inline comments.** In Changes (and a project's Review), hover a line and press its **+**: a composer opens right under the line (shift-click to widen the range, ⌘↵ to save). The comment stays under its line and waits above the thread's composer.
  - **Sent with your next message.** Waiting comments go to the agent in the same turn as your next message, each with its file, lines and quoted lines; **Send now** sends them alone. The thread shows them as comment cards. This works for every harness, not only project threads.
  - **Calmer diffs.** Unchanged runs fold into **Show N more lines**, one gutter numbers the lines, and long lines wrap instead of scrolling sideways.
  - **Review page.** **Open as a page** on the Changes or PR pane opens the thread's Review page: Changes and, for a project thread, the pull request, each a full-width tab, with comments and the tray, and Back to the thread.
  - **Review panel.** A file bar over the diff (previous, next, `n of N`, **Viewed**), and **Hide file list** gives the diff the full width.
  - **Sidebar.** **Hide sidebar** or ⌘B folds the thread list away on wide screens; **Show sidebar** brings it back. Remembered in this browser.
  - **Threads.** Each row shows its pull request (`[#12](https://github.com/AshikNesin/tiny-agents/issues/12)`, toned when it needs you, is fixing, passes or merged); the header reads `folder / title`.

- [#336](https://github.com/AshikNesin/tiny-agents/pull/336) [`6ba74a2`](https://github.com/AshikNesin/tiny-agents/commit/6ba74a22175aa8d6d4aec5bee1ef5c79e0c5cfd3) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code: fixes from an end-to-end run against a real GitHub pull request. A draft PR offers **Ready for review**, so it can be merged without a trip to GitHub. When the branch has nothing to publish because the agent's changes aren't committed, the PR tab says so, with **Ask to commit**. A folded turn says when a command in it failed. A project thread's first message shows its branch instead of the agent's instructions, and an Auto-fix request reads as one short card naming what it fixes. A check with no run time no longer shows `0ms`.

- [#358](https://github.com/AshikNesin/tiny-agents/pull/358) [`306e366`](https://github.com/AshikNesin/tiny-agents/commit/306e3664f483fffc91243ec422f342dc1afc4511) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code: a PR review's assistant has a model picker beside its first question, starting on the project's default model.

- [#372](https://github.com/AshikNesin/tiny-agents/pull/372) [`1a4285a`](https://github.com/AshikNesin/tiny-agents/commit/1a4285a40e2562a51e43bc44d5f45617c48969cd) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code: reviewing a PR that a Code thread opened now shows that thread's worktree when it is at the PR's head, instead of checking the PR out again. Push and Discard stay with the thread there, and closing the review keeps the thread's worktree.

- [#341](https://github.com/AshikNesin/tiny-agents/pull/341) [`cfa13db`](https://github.com/AshikNesin/tiny-agents/commit/cfa13dbe6481655c3f146c15b8bec0e6e3f9c5c1) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code: a running check no longer says "GitHub did not send the log. It may have expired." GitHub serves a job's log only once the job finishes, so the pull request tab now shows the job's steps as they run and swaps in the log excerpt when it ends.

- [#317](https://github.com/AshikNesin/tiny-agents/pull/317) [`371f074`](https://github.com/AshikNesin/tiny-agents/commit/371f074ef88bdc69d67e8ba9de5472643b6583ac) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code's Changes and Review panels are steady while an agent works, for every harness, on the local sandbox container or over SSH. The git reading lives in a new dependency-free `@tiny-agents/git` package shared by the app and the Claude worker.
  
  - **Right files, right counts.** A new file the agent has not committed shows up, a renamed file counts its lines on both sides, and a path with spaces or non-ASCII characters no longer breaks the whole Review panel.
  - **No lock fights.** Reading changes never rewrites the git index, so an agent's commit no longer fails with `index.lock` while a panel is open.
  - **Honest diffs.** A binary or oversized file (over 2 MB), from any harness, says so instead of showing garbage or a whole-file deletion; a very long diff draws its first 4,000 lines, and one too costly to work out says so instead of freezing the tab.
  - **No blinking.** A re-read keeps the file list, what you folded and your scroll on screen; the open Review diff follows the file when the agent changes it again.
  - **Live refresh.** While Changes is open, the server watches the directory's change stamp (one cheap git call every 1.5 s, slower once quiet) and the panel re-reads only when the files moved, on a steady beat even while the agent never pauses. A harness without a stamp (Shelley) is watched through its own uncommitted file list, so every harness that serves diffs is live.
  - **Edit diffs survive a reload.** Claude Code threads redraw each Edit with its real hunks and line numbers after a reload or reconnect, read back from Claude Code's own session file.

- [#355](https://github.com/AshikNesin/tiny-agents/pull/355) [`936b857`](https://github.com/AshikNesin/tiny-agents/commit/936b857631431e876011eb95bd5db82d7d0ff7a8) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code: in Source control, a file's header now sticks flush under the toolbar while you scroll, with no strip of diff showing above it.

- [#342](https://github.com/AshikNesin/tiny-agents/pull/342) [`f236b8f`](https://github.com/AshikNesin/tiny-agents/commit/f236b8f81abfba7a536808a6169bd504cf4a6433) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code: a subagent row opens to show what the subagent reported back and its full prompt, so a Claude Code Task/Agent subagent's work can be read in the thread. A failed subagent shows a red mark instead of a check.

- [#381](https://github.com/AshikNesin/tiny-agents/pull/381) [`d489aee`](https://github.com/AshikNesin/tiny-agents/commit/d489aeee8766bb415697ddb38307ba23e90fe8a8) Thanks [@AshikNesin](https://github.com/AshikNesin)! - A bot's sign-in request is filled right in its chat: the card holds the form (fields, Securely save to vault, Continue, Cancel) instead of opening a separate page. The request's link now opens the chat on that card.

- [#380](https://github.com/AshikNesin/tiny-agents/pull/380) [`b2d64a4`](https://github.com/AshikNesin/tiny-agents/commit/b2d64a4187574447e3df50ab5f7d994d9d675b9e) Thanks [@AshikNesin](https://github.com/AshikNesin)! - The secure sign-in card drops its "Live browser" button (it only opened the bot's chat). Fill errors no longer point to it.

- [#315](https://github.com/AshikNesin/tiny-agents/pull/315) [`db00ff3`](https://github.com/AshikNesin/tiny-agents/commit/db00ff3423d5d4e3ded1897ca4617d32d45aea4a) Thanks [@AshikNesin](https://github.com/AshikNesin)! - The FeedbackBee feedback widget now loads from `feedbackbee.nesin.io` (was `feedbackbee.nesin.workers.dev`) in headless mode: no floating button in the bottom-right corner on any page. "Send feedback" in the sidebar's account menu opens it as the embed's own centered modal, replacing the app's CSS that hid the launcher and restyled the panel. Hotkeys no longer treat an inert `aria-modal` element (a closed modal kept in the page, like the headless panel) as an open dialog, so ⌘K and other shortcuts keep working after the feedback panel closes.

- [#411](https://github.com/AshikNesin/tiny-agents/pull/411) [`b71a5ea`](https://github.com/AshikNesin/tiny-agents/commit/b71a5eac4028b7a80b5237b64823c87a78db9bc4) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Claude models on a Cloudflare AI Gateway account keep the prompt cache when a bot loads deferred tools, as they do on an Anthropic account, and a model's own compatibility flags no longer drop the ones pi-ai knows.

- [#338](https://github.com/AshikNesin/tiny-agents/pull/338) [`11ab8e5`](https://github.com/AshikNesin/tiny-agents/commit/11ab8e58997305fc134c4c070ff00637d5f27242) Thanks [@AshikNesin](https://github.com/AshikNesin)! - A bot-to-bot message or @mention whose reply a server restart cut off is no longer left waiting forever. On the next boot it is closed, and the bot that asked is told "(couldn't answer: interrupted by a server restart)", the same way it hears about a failed reply. Messages sent more than a day ago close quietly, so old stuck ones do not wake every bot at once. Deliveries and routine runs now share one module for answering and boot recovery (`bots.awaited.ts`).

- [#328](https://github.com/AshikNesin/tiny-agents/pull/328) [`1ee7dc6`](https://github.com/AshikNesin/tiny-agents/commit/1ee7dc6c5eb2bafb0a0ad331f7009c41729616fa) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Bots send less to the model on every request. A long chat is now summarized once its context passes about 150k tokens on every model, instead of only near the model's full window, so on a 1M-token model a single request no longer grows toward a million tokens (`CONTEXT_CEILING_TOKENS`, applied through pi-durable's per-model compaction overrides). A browser or computer session's old screenshots are no longer re-sent with each later step: only the newest three go out, and older ones drop ten at a time so the provider's prompt cache keeps working between drops (the chat still shows every screenshot, and images the owner attached are never dropped). The bots roster in the prompt no longer says which bots are "working right now", which re-sent the whole roster into the transcript every time any bot started or stopped a reply; `message_bot` still says when a message is queued. Side-calls (chat titles, memory capture) pass their prompt through the secret redactor, like tool results and logs do.

- [#411](https://github.com/AshikNesin/tiny-agents/pull/411) [`b71a5ea`](https://github.com/AshikNesin/tiny-agents/commit/b71a5eac4028b7a80b5237b64823c87a78db9bc4) Thanks [@AshikNesin](https://github.com/AshikNesin)! - A connection's tools are deferred behind tool search by size (names, descriptions and schemas over 8,000 characters) rather than by count, and the prompt lists a deferred connection's tool names so the bot knows what it can load.

- [#418](https://github.com/AshikNesin/tiny-agents/pull/418) [`67a2fad`](https://github.com/AshikNesin/tiny-agents/commit/67a2fad2fd63235b69e65812b2a9051fd79c967a) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Memory: a bot keeps at most 60 active memories (was 100), so memories of typical length all fit the prompt instead of the oldest quarter being silently left out. Older ones archive as before and can be restored from the Memory page.

- [#335](https://github.com/AshikNesin/tiny-agents/pull/335) [`1356b41`](https://github.com/AshikNesin/tiny-agents/commit/1356b41e299fa1966ea36231134c380d58b53dbd) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Memory costs fewer tokens and dedupes better. A memory a chat learns itself (its background capture, or "remember" in that chat) no longer re-sends the whole "What you remember" block into that chat, which already holds the fact; a memory from anywhere else, or any removal, still refreshes it on the next message, and a new chat starts from the full set. The capture prompt names current memories by short refs (m1, m2) instead of 36-character ids, and clips the bot's replies to 500 characters of context instead of 1,500. "The owner prefers pnpm." and "the owner prefers pnpm" are now the same memory.

- [#420](https://github.com/AshikNesin/tiny-agents/pull/420) [`460bcf2`](https://github.com/AshikNesin/tiny-agents/commit/460bcf2fc9662606472a60411264e5be53f057b2) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Memory: capture no longer asks the model for a confidence score on each memory, since nothing used it. The memories API drops the always-unused `confidence` field.

- [#338](https://github.com/AshikNesin/tiny-agents/pull/338) [`be57734`](https://github.com/AshikNesin/tiny-agents/commit/be57734bf78e7ac4734fe385e06594df91c22a8b) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Editing a memory on the Memory page so its text matches another memory of the same bot no longer leaves two active copies. The edit lands on the existing memory, and the one you edited is marked as replaced by it.

- [#419](https://github.com/AshikNesin/tiny-agents/pull/419) [`60637e1`](https://github.com/AshikNesin/tiny-agents/commit/60637e11faec3c4cd825b5a0c93ab71cfd7e5549) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Taking control of a bot's browser or computer and then leaving it now hands it back to the bot after two minutes without a key press or pointer move, so a forgotten takeover no longer stalls the bot.

- [#324](https://github.com/AshikNesin/tiny-agents/pull/324) [`8d04d53`](https://github.com/AshikNesin/tiny-agents/commit/8d04d532d4813ae936a0880b26e68776d6bb06f4) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Routines: each run starts a fresh conversation instead of re-sending every earlier run's history with each request, which made frequent routines cost far more than their own work. A run's prompt quotes the routine's three latest results instead, a fire while the previous run is still working is skipped, and a run has a 500k-token budget: past it the Tool gate refuses tool calls so the model wraps up, at 1.5x the run is stopped, and the run is recorded blocked. Each run's token spend is stored and shown on the Routines page. The agent runtime gains `CapabilitySelection.budgetTokens` and `usedTokens(ref)`.

- [#338](https://github.com/AshikNesin/tiny-agents/pull/338) [`524e964`](https://github.com/AshikNesin/tiny-agents/commit/524e96409f3d9b49b3ca105ff62cdee31919e978) Thanks [@AshikNesin](https://github.com/AshikNesin)! - A reply that hit a run limit now says so. A tool call the gate refused for the token budget or the 150-call cap is marked on its row (`limit`), and the turn's Finished reply carries `stoppedBy`. A routine run stopped by the tool-call cap is recorded as blocked with the reason, instead of succeeding on partial output, and a bot-to-bot message that hit a limit before saying anything tells the asking bot which limit, instead of "(no reply)".

- [#411](https://github.com/AshikNesin/tiny-agents/pull/411) [`b71a5ea`](https://github.com/AshikNesin/tiny-agents/commit/b71a5eac4028b7a80b5237b64823c87a78db9bc4) Thanks [@AshikNesin](https://github.com/AshikNesin)! - The largest tool descriptions (asking you questions, creating and updating routines, running a command, asking you to sign in, creating a bot) are shorter, so every request re-sends less.

- [#411](https://github.com/AshikNesin/tiny-agents/pull/411) [`b71a5ea`](https://github.com/AshikNesin/tiny-agents/commit/b71a5eac4028b7a80b5237b64823c87a78db9bc4) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Routine runs and bot-to-bot conversations are no longer offered tools they could never use there (asking you questions, saving a skill, creating a bot, changing instructions), so each of their requests is smaller.

- [#417](https://github.com/AshikNesin/tiny-agents/pull/417) [`f5d8535`](https://github.com/AshikNesin/tiny-agents/commit/f5d8535bb5a48c4e4a4f08ff37bb1439c7512bc2) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Vault: a bot can ask you to sign in where the sign-in box sits in another site's frame, as The Hindu's does (an id.tinypass.com frame). The card names that frame ("Only filled on www.thehindu.com, in its sign-in frame from id.tinypass.com"), the values fill only into it while the page is still on the asked site, and a login saved from it fills there next time too. Fields in frames from two different sites are refused ([#302](https://github.com/AshikNesin/tiny-agents/issues/302)).

- [`805b887`](https://github.com/AshikNesin/tiny-agents/commit/805b887596f51298f962913646218e9bdd2345f1) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Credential fills now recognise mobile-number sign-in fields: a `tel` input whose label or placeholder names a mobile number is filled for `autocomplete="tel"` and as a sign-in's username, so owner-typed numbers reach phone-first portals instead of failing with "No matching fields were found".

- [#392](https://github.com/AshikNesin/tiny-agents/pull/392) [`50372f3`](https://github.com/AshikNesin/tiny-agents/commit/50372f3fbcc92c30dec8446ca4d0e71c8c4c5ea8) Thanks [@AshikNesin](https://github.com/AshikNesin)! - A sign-in request with no password (a mobile number and a one-time code, say) offers "Securely save to vault" again: the username, email or mobile number is saved as a login. One-time codes and security codes are still never saved.

- [#379](https://github.com/AshikNesin/tiny-agents/pull/379) [`337c334`](https://github.com/AshikNesin/tiny-agents/commit/337c33496f23872efd19cf088bb8b20638207828) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Credential requests now fill sign-ins split over pages, like amazon.in's: the email is filled and submitted, then the password is filled on the next page. Amazon's email field (`autocomplete="webauthn"`) is now recognised, and a bot is told which fields the page never showed.

## 1.4.1

### Patch Changes

- [#313](https://github.com/AshikNesin/tiny-agents/pull/313) [`c84f9ca`](https://github.com/AshikNesin/tiny-agents/commit/c84f9caba1f548c8d3d818a3af9e2e4a7691ab03) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Internal cleanup with no visible change: the vault's sink helpers no longer carry hook-style `use…` names, the chat transcript reads its page source without writing a ref during render, and the multiple-choice selection's merge and split timers now live in an effect that clears them.

## 1.4.0

### Minor Changes

- [#292](https://github.com/AshikNesin/tiny-agents/pull/292) [`4727c90`](https://github.com/AshikNesin/tiny-agents/commit/4727c908d92162b9cf0808b431e28ab55334d361) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Push notification links can open the Android app: set `ANDROID_APP_CERT_SHA256` to the app's signing certificate SHA-256 and the server serves `/.well-known/assetlinks.json`, so Android lets the app open this server's links (a notification's approval or question opens the app on that card instead of the browser). See the mobile app guide, "Links from notifications".

- [#307](https://github.com/AshikNesin/tiny-agents/pull/307) [`d23c0ad`](https://github.com/AshikNesin/tiny-agents/commit/d23c0ad49c0f031d697a2737aa2246d46191e94c) Thanks [@AshikNesin](https://github.com/AshikNesin)! - The Android app has Code: the coding agents' threads, live. Watch a turn stream, steer it or queue a message, stop it, allow or deny approvals and answer questions, change the model, reasoning and permissions, and start new threads in a directory or a project. Changes shows the diffs (and a project branch's review with line comments), and the pull request screen publishes, runs Auto-fix and merges. Code pushes and a bot's hand-off card open the thread in the app.

- [#301](https://github.com/AshikNesin/tiny-agents/pull/301) [`558bef3`](https://github.com/AshikNesin/tiny-agents/commit/558bef333fa2665d415ae766813bc27ba833d82c) Thanks [@AshikNesin](https://github.com/AshikNesin)! - The Android app is a share target: share files, photos, links or text from any app, pick the bot, add a note and send. The top bots also show by face in Android's share sheet as Direct Share targets. See the mobile app guide, "Sharing from other apps".

- [#311](https://github.com/AshikNesin/tiny-agents/pull/311) [`92709fc`](https://github.com/AshikNesin/tiny-agents/commit/92709fcf5bebbaf6debb0608367c278a8da6bfb1) Thanks [@AshikNesin](https://github.com/AshikNesin)! - A Code project thread's branch is now named for what the task does, and short: `ta/fix-google-callback` instead of the prompt's opening words plus random hex (`ta/can-you-please-fix-the-login-flow-when-the-a1b2c3`). The `chat_title` model role names it from the task; with no model it is the task's first words without the filler. A name already taken gets `-2`, `-3`.

- [#310](https://github.com/AshikNesin/tiny-agents/pull/310) [`a232cc2`](https://github.com/AshikNesin/tiny-agents/commit/a232cc262d93358e9b8d24d8404335b510b0e29f) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code has a quieter, t3code-inspired layout. The sidebar groups threads by project (then by repository or folder), each group folding away and offering its own New thread and, for a project, its settings; the top bar, the Active/Archived toggle and the harness and repository filters are gone, with Archived and Settings at the foot of the sidebar. The thread header is one line: the title (its menu now holds Archive and the cost), the project, PR and Changes. Projects are no longer one dialog: Code → Settings has a Projects page, a page per project with every rule (name, base branch, default agent and model, the setup, check and archive scripts, each Auto-fix trigger, protected paths and limits), and a GitHub page. The PR panel puts its actions in one row and shows the spend limit only where the harness reports cost. While the PR tab is on screen it re-checks GitHub every 15 seconds, so projects without the GitHub App's webhooks show a finished check within seconds instead of minutes.

- [#300](https://github.com/AshikNesin/tiny-agents/pull/300) [`e9305bd`](https://github.com/AshikNesin/tiny-agents/commit/e9305bdd0659e90d1989dcef282b2b63f6b242ee) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code projects go further. Every commit a project thread makes carries a `Thread-Id` trailer that leads back to the conversation. Each turn is checkpointed, so Changes can show what any one turn changed, and Revert to here puts the files back without touching the branch's history. In the PR tab, Auto-merge turns on GitHub's own auto-merge once no fix is running, a spend limit pauses Auto-fix when a thread has cost enough, each pass shows what it cost, and queued PRs say so. Projects can also run a final check when checks go green, and fix a PR the merge queue removed. Optionally, create a GitHub App in one click (Projects → GitHub → Create GitHub App, then Install on repositories): its projects use short-lived tokens, and signed webhooks bring each check within seconds instead of polling.

- [#300](https://github.com/AshikNesin/tiny-agents/pull/300) [`e9305bd`](https://github.com/AshikNesin/tiny-agents/commit/e9305bdd0659e90d1989dcef282b2b63f6b242ee) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code now takes a task from prompt to merged pull request. Add a GitHub repository as a project (Projects in the Code header), with a token kept in the vault or `gh` signed in on the sandbox. A thread started in a project gets its own worktree and branch. Changes compares with the base branch, with Viewed marks and line comments sent to the agent together. The new PR tab publishes a draft pull request and shows its checks, reviews and open comments, with Fix CI and Merge. Auto-fix keeps the pull request green while you are away: it fixes failing checks, trusted review comments and merge conflicts, pushes (never forced, never to CI workflow files), answers the reviewers, and stops at clear limits.

- [#296](https://github.com/AshikNesin/tiny-agents/pull/296) [`7207380`](https://github.com/AshikNesin/tiny-agents/commit/72073804070aecd384ad38fbdc885d90e3f9fd1f) Thanks [@AshikNesin](https://github.com/AshikNesin)! - The Browser and Computer live views are simpler. The chat panel's header is one row: the Browser / Computer tabs (with icons), one status chip ("Chief is driving", or a pulsing "You're driving") and the tools as icons. The Browser and Computer pages get the same bar over the view, so their tools stay on screen in full screen. Click the stream to take control (hover shows "Click to take control"); a green frame marks it while you drive, and "Hand back" returns it. The header no longer repeats the address bar the streamed Chrome already shows, or the desktop's size.

### Patch Changes

- [#309](https://github.com/AshikNesin/tiny-agents/pull/309) [`5da3642`](https://github.com/AshikNesin/tiny-agents/commit/5da3642968c2d03ebc81c83208a70b78f35ab1e6) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code: adding a project through the GitHub App (Code → Settings → Projects) picks the repository from a searchable list (the same SearchSelect as the composer's model picker) instead of a plain select, so the repo you want is one query away; with nothing installed it says to install the App on a repository first.

- [`30de796`](https://github.com/AshikNesin/tiny-agents/commit/30de7962c067032efaefdeed667d292acb16918e) Thanks [@claude](https://github.com/claude)! - A connection that needs a sign-in shows only **Sign in**. Its Reconnect button did nothing visible: reconnecting without a usable sign-in fails the same way, so the page stayed as it was.

- [#298](https://github.com/AshikNesin/tiny-agents/pull/298) [`b5decd7`](https://github.com/AshikNesin/tiny-agents/commit/b5decd7fe0c2b1d0878f22979b23d870e27b0a2b) Thanks [@AshikNesin](https://github.com/AshikNesin)! - The green frame around a Browser or Computer view you drive now follows the view's rounded corners instead of being cut off at the bottom corners.

- [#304](https://github.com/AshikNesin/tiny-agents/pull/304) [`206dcbf`](https://github.com/AshikNesin/tiny-agents/commit/206dcbfb17501cd86efed66e8a021a904107488b) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Fixes from an end-to-end pass on a live install.
  
  - **Connections signed in before the new secret format work again.** An OAuth connection whose saved sign-in was stored in the old `v1` format (or under another `SECRETS_KEY`) showed "The stored secret is in an unknown format." with only Reconnect, which failed the same way, and signing in failed on it too. It now asks you to sign in again, and signing in replaces the old value.
  - **Routines show a run's result without a reload.** After Run now, Recent runs said "awaiting" until the page was reloaded; it now checks back while a run is in flight.
  - **Tasks say where quick-add put a task.** A task typed on Today with another day ("tomorrow 5pm") used to vanish from view; a toast now says it went to Upcoming, with Show.
  - **The Vault names the model provider that used a key** ("used … by Cloudflare AI Gateway") instead of its id.
  - **Settings → Models** says when an account was last checked as a relative time, and on a phone puts the account's actions under its summary instead of squeezing the summary into a narrow column.

- [#312](https://github.com/AshikNesin/tiny-agents/pull/312) [`9b9184a`](https://github.com/AshikNesin/tiny-agents/commit/9b9184acb2aee8edaa39ff6b7bb1dc4cd882db1a) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Requests no longer hang when the app is open in several tabs. Each tab's live updates held one of the 6 connections a browser allows per site over plain `http://localhost`, so with two Code tabs (or Code and a couple of chats) open, new requests such as a thread's PR tab or Changes waited forever. A tab in the background now gives its live connections back and reconnects, with fresh data, as soon as it is shown.

- [#299](https://github.com/AshikNesin/tiny-agents/pull/299) [`c20fb91`](https://github.com/AshikNesin/tiny-agents/commit/c20fb91037271f9f8713ead4efa8f34428e07f7a) Thanks [@AshikNesin](https://github.com/AshikNesin)! - A UI pass across the app. On a phone, a page's description now uses the full width instead of wrapping into a narrow column beside its buttons, and a detail page (a skill, a connection) puts its actions on their own row so its name is not cut short. Settings no longer shows a menu button that opened nothing. Terminal no longer offers New tab when no sandbox is set up. Storage hides the folder trail at the top folder. On Security, the passkey name field gets the full width on a phone.

## 1.3.0

### Minor Changes

- [#239](https://github.com/AshikNesin/tiny-agents/pull/239) [`3642389`](https://github.com/AshikNesin/tiny-agents/commit/3642389479a078802e8ba5ad398b3f1a7fc52d79) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Bots: a **YOLO mode by default** switch in a bot's settings (Tools tab). Every new chat with that bot starts with YOLO mode on; you can still turn it off per chat. Vault use, turns you did not start and routines still ask.

- [`4919164`](https://github.com/AshikNesin/tiny-agents/commit/4919164bb2f3061d45b0635eabba20b5e380e28d) Thanks [@claude](https://github.com/claude)! - The computer's Chrome and the Browser feature now use the same Chrome profile.
  
  - **One profile, two views:** Chrome opened on a desktop (the menu, the Web Browser launcher, `computer_open_app`) opens the browser profile of the same key (`shared`, or a bot's own). A site you sign into in either one is signed in in the other, along with history, bookmarks and extensions.
  - **Handoff:** Chrome lets only one running browser use a profile. Opening Chrome on the desktop closes the bot's browser on that profile, and the bot's next browser call closes the desktop's Chrome and reopens it in the Browser panel. Cookies are saved on each handoff.
  - **Reset:** resetting a browser profile also closes the desktop's Chrome on it.

- [#237](https://github.com/AshikNesin/tiny-agents/pull/237) [`419331c`](https://github.com/AshikNesin/tiny-agents/commit/419331ce4878b8c372f9307c6fb964b179fd6151) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Run locally and update from the app: `pnpm local`.
  
  - **`pnpm local`** runs the production server from a built release and checks git for new commits. It follows `origin/main` by default, or the newest release with `--track release`.
  - **Settings → Updates** shows the running version, the new commits, and an **Update & restart** button. The new version builds while the old one keeps serving, then the server restarts and the page reloads.
  - **Safe swaps:** a failed build leaves the running version alone, a version that does not start is rolled back, and a crashed server is restarted. `--auto` updates without the click.

- [#286](https://github.com/AshikNesin/tiny-agents/pull/286) [`afa0941`](https://github.com/AshikNesin/tiny-agents/commit/afa09416dc85eb759180d86dffcc503dea4b3cd0) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Vault values now live in their own `vault_values` table instead of the key-value store, and an MCP connection's header secret is a vault item. The first start after the update moves every existing value and connection secret over and checks each one before removing the old copy; an entry it can't read stays where it was and is named in the log. The Vault list no longer goes empty when one item can't be read: that item shows as unreadable and the rest list. Every read of an item checks it against its current policy, listing included, and concurrent OAuth sign-in steps no longer overwrite each other.

- [#246](https://github.com/AshikNesin/tiny-agents/pull/246) [`378198e`](https://github.com/AshikNesin/tiny-agents/commit/378198ea0a216e8845147cc66c5a14d0152c6362) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Remove the 1Password Connect vault backend. Vault items live in the local backend (sealed with `SECRETS_KEY`), and the `OP_CONNECT_HOST`, `OP_CONNECT_VAULT_ID`, `OP_CONNECT_TOKEN` and `OP_CONNECT_ADMIN_TOKEN` settings are gone.

### Patch Changes

- [#245](https://github.com/AshikNesin/tiny-agents/pull/245) [`c37311f`](https://github.com/AshikNesin/tiny-agents/commit/c37311f435bd8b6c8cd7c87f84107c9a1e8f57b2) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Tidier chat header: the bot's name opens a menu with Bot settings, Chat history and the YOLO switch, Browser and Computer share one live view button (tabs in the panel switch between them), and the model and description no longer repeat in the header. On phones the bot's name now has room instead of being cut off.

- [#265](https://github.com/AshikNesin/tiny-agents/pull/265) [`393dd71`](https://github.com/AshikNesin/tiny-agents/commit/393dd71934f643d83303f57467f54e90318a9b76) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Claude plan: the transcript lives in the agent store, and sends behave as they do on pi (ADR 0018).
  
  - **Durable transcript:** each message and reply is an entry of the bot's own conversation in `agent.db`, not a JSON file beside it. On the first start after the upgrade, `<agent.db>.claude.json` is imported once and renamed `.claude.json.imported`; a file that cannot be read is left as it is and logged.
  - **Sends:** a send returns as soon as it is stored instead of when the reply ends, a retried send is not added twice, and a message sent while Claude replies waits above the composer (withdraw it there) and is answered next.
  - **Stop and pauses:** a stopped reply stays stopped, Stop also ends the Claude Code process on the sandbox, a usage pause keeps your message and frees the worker for the next turn, and a reply with nothing in it still counts as finished.
  - **Restarts:** after an app restart a Claude plan chat shows its own transcript right away.
  - **Long waits:** a tool call waiting for your approval, answer or sign-in no longer times out after two minutes on the worker.

- [#236](https://github.com/AshikNesin/tiny-agents/pull/236) [`b5dcf5d`](https://github.com/AshikNesin/tiny-agents/commit/b5dcf5df004bd1294a853ee120c5e0032dc55f78) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Claude plan: raise the per-reply turn limit and make it a setting.
  
  - **Default:** Claude Code's `maxTurns` goes from 30 to 100, so browser tasks no longer stop with "Reached maximum number of turns (30)".
  - **Settings → Models → Claude plan → Max turns:** set 1 to 1,000, or tick **No limit** (opt-in) to run Claude Code without `maxTurns`. It applies from the next message, with no release: the worker restarts an idle Claude process with the new limit and resumes the conversation.
  - **Error:** running out of turns now says where to raise the limit.

- [#277](https://github.com/AshikNesin/tiny-agents/pull/277) [`3342118`](https://github.com/AshikNesin/tiny-agents/commit/3342118da1af6ce513455ff5adafc858367a49da) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code hand-offs: a bot hears every finish, once, and a start makes one thread (register row C7).
  
  - **Finishes:** when a handed-off turn ends, its "Reply from …" is recorded as owed before it is sent. One cut off by a restart or a failed send is sent again at boot, on reconnect and every 30 seconds until it lands, and the bot's chat never shows it twice.
  - **Starts:** a `code_start` that pi-durable runs again (after a restart, or while the first run is still starting) makes no second thread. A start interrupted after the harness may have made its thread is not repeated; the bot is told to check with you.
  - **Follow-ups:** `code_send` arms the hand-off before the harness hears the message, so a turn that ends at once still reports back, and a thread's sends go one at a time.
  - **Migration:** `0013_code_handoff_finishes` adds the `code_handoff_finishes` table and lets `code_handoffs.thread_id` be empty while a start is claimed; existing rows are copied as they are.

- [`879de1d`](https://github.com/AshikNesin/tiny-agents/commit/879de1db33c332dfbf9ab98bb83fca2f53ed108a) Thanks [@claude](https://github.com/claude)! - Fixes from an end-to-end pass (friction issues [#240](https://github.com/AshikNesin/tiny-agents/issues/240)–[#244](https://github.com/AshikNesin/tiny-agents/issues/244)).
  
  - **Test servers can sign in for every test ([#240](https://github.com/AshikNesin/tiny-agents/issues/240)):** `AUTH_RATE_LIMIT_MAX` overrides the 20 sign-ins per 15 minutes. `pnpm test:e2e` and `ta-verify up` set it to 1000, and both login helpers now say when a login was rate-limited instead of failing as "still on /login".
  - **Old settings links work ([#241](https://github.com/AshikNesin/tiny-agents/issues/241)):** `/settings?tab=<id>` opens `/settings/<id>` (`general` → Account, `claude` → Models). The verify journeys follow the full-page Settings, and a client test fails when a journey or recipe names a page that no longer exists.
  - **No dead end on /code ([#242](https://github.com/AshikNesin/tiny-agents/issues/242)):** with no coding agent, the page keeps its "Back to tiny-agents" bar and links Settings → Models.
  - **E2E in containers ([#243](https://github.com/AshikNesin/tiny-agents/issues/243)):** `pnpm test:e2e` launches `PLAYWRIGHT_CHROMIUM_PATH`, or a Chromium pre-installed at `/opt/pw-browsers/chromium` when Playwright's own build is missing.
  - **Quieter logs ([#244](https://github.com/AshikNesin/tiny-agents/issues/244)):** 4xx errors are logged without a stack trace, and the session guard's 401 (every signed-out page load) at debug. `@groot/core/session` exports `isSessionInvalid()`.

- [#234](https://github.com/AshikNesin/tiny-agents/pull/234) [`4a6e906`](https://github.com/AshikNesin/tiny-agents/commit/4a6e9064f4e32e12711b4a2b25869b49328d9430) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Mobile sidebar matches desktop: Routines, Skills, Memory, Connections and Vault live only in the account menu instead of also being listed in the drawer all the time, so the bot list stays in view.

- [#277](https://github.com/AshikNesin/tiny-agents/pull/277) [`3342118`](https://github.com/AshikNesin/tiny-agents/commit/3342118da1af6ce513455ff5adafc858367a49da) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Settings → Models: deleting a model or account in use moves its users only where they could have been set (register row C12).
  
  - **Classifier role:** it moves only to another classifier model, never onto a chat model. An account whose classifier and chat models are both in use asks you to move the classifier role first.
  - **Claude plan fallback:** it moves only to a chat model that runs on pi, never to a Claude plan model, the same rule as picking the fallback on the Claude plan's card.
  - A refused move answers 400 with the reason and changes nothing.

- [#245](https://github.com/AshikNesin/tiny-agents/pull/245) [`c37311f`](https://github.com/AshikNesin/tiny-agents/commit/c37311f435bd8b6c8cd7c87f84107c9a1e8f57b2) Thanks [@AshikNesin](https://github.com/AshikNesin)! - UI copy no longer uses em dashes: messages read with a period, colon or comma, and empty values show "-". Lint rule R10 keeps them out of the app's screens.

- [#259](https://github.com/AshikNesin/tiny-agents/pull/259) [`a31a0f8`](https://github.com/AshikNesin/tiny-agents/commit/a31a0f8f19aa609c185601068b9d041a6c2c5825) Thanks [@AshikNesin](https://github.com/AshikNesin)! - A bot in a chat shared with guests can no longer change its own instructions: `update_instructions` is refused there, as `create_bot` already was, so a guest can't rewrite a shared bot's system prompt by approving the card.

- [#259](https://github.com/AshikNesin/tiny-agents/pull/259) [`a31a0f8`](https://github.com/AshikNesin/tiny-agents/commit/a31a0f8f19aa609c185601068b9d041a6c2c5825) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Guests can only watch a shared bot's browser and computer: taking control, starting, resizing and resetting are the owner's, and the VNC bridge drops a guest viewer's keys, clicks and clipboard. A guest with the chat open no longer holds back the owner's Pushover pushes.

- [#259](https://github.com/AshikNesin/tiny-agents/pull/259) [`a31a0f8`](https://github.com/AshikNesin/tiny-agents/commit/a31a0f8f19aa609c185601068b9d041a6c2c5825) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Guests on the Code page keep threads but not the harness host: no directory browsing or choosing, file finding, uploads, worktrees, moving a thread, file assets or bypass permission mode. The page hides those controls for a guest and the routes refuse them.

- [#259](https://github.com/AshikNesin/tiny-agents/pull/259) [`a31a0f8`](https://github.com/AshikNesin/tiny-agents/commit/a31a0f8f19aa609c185601068b9d041a6c2c5825) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Adding, deleting or re-pointing an MCP connection (URL, header, secret) now asks you to confirm it's you, as model accounts already did. Moving a connection to another host drops its stored header secret unless you enter a new one, and an app credential can't be used as a connection's header secret.

- [#259](https://github.com/AshikNesin/tiny-agents/pull/259) [`a31a0f8`](https://github.com/AshikNesin/tiny-agents/commit/a31a0f8f19aa609c185601068b9d041a6c2c5825) Thanks [@AshikNesin](https://github.com/AshikNesin)! - "Always allow" on an approval card now switches on only the tool of the call being approved: a request naming another tool is refused (400 `ALWAYS_ALLOW_MISMATCH`), a vault use can't be always allowed, and nothing changes when no such call is waiting.

- [#278](https://github.com/AshikNesin/tiny-agents/pull/278) [`2677cc6`](https://github.com/AshikNesin/tiny-agents/commit/2677cc6fddbc652e02bc17cd89ac64c9df690a78) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Auto-review no longer counts a guest's messages as the owner's (security fix, S6). In a shared bot's chat a turn a guest started always shows its approval card, and the classifier reads only the owner's own messages, the same rule YOLO mode applies (`fromOwner` in `policy.ts`). `ToolGate` and `AgentRuntime.open` take an `ownerUserId` option for this; without one, no message with an author counts as the owner's. `ownerMessages()` now takes the owner's user id as its second argument.

- [#278](https://github.com/AshikNesin/tiny-agents/pull/278) [`2677cc6`](https://github.com/AshikNesin/tiny-agents/commit/2677cc6fddbc652e02bc17cd89ac64c9df690a78) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Adding a guest now creates their account and marks it a guest in one database transaction (security fix, S8). Before, a failure between the two left an account with no guest mark, which the app treats as an owner. A taken email still answers 409.

## 1.2.1

### Patch Changes

- [#231](https://github.com/AshikNesin/tiny-agents/pull/231) [`42a17f2`](https://github.com/AshikNesin/tiny-agents/commit/42a17f2a58bb901bb30d43998a922fe9ae64ccd4) Thanks [@AshikNesin](https://github.com/AshikNesin)! - The Claude plan lists its models from Claude Code instead of a hardcoded list.
  
  - **Worker:** a new `models` request asks the signed-in Claude Code for its model list (the Agent SDK's `initializationResult().models`) without sending a prompt.
  - **Discovery:** each model is saved under the id its alias resolves to (`claude-opus-5-5`) and named from pi-ai's catalog. A new account starts on the `opus`, `sonnet` and `haiku` aliases until Claude Code is signed in.
  - **Settings:** the Claude plan card can check again and add the models Claude Code lists.

- [#232](https://github.com/AshikNesin/tiny-agents/pull/232) [`1ac44ab`](https://github.com/AshikNesin/tiny-agents/commit/1ac44ab686f414d20cc268d80fc58652a25fb87e) Thanks [@AshikNesin](https://github.com/AshikNesin)! - No hardcoded Claude models: the Claude plan and the Code page use only what Claude Code lists for your subscription.
  
  - **Settings:** a new Claude plan account connects with no models until Claude Code is signed in. "Check again" adds each model Claude Code lists, so a new model appears without adding it by hand. The `opus` / `sonnet` / `haiku` fallback is gone.
  - **Code page:** the Claude Code picker offers the Claude plan account's models (full ids, versioned names) instead of a fixed Opus / Sonnet / Haiku list. With none saved, it shows what Claude Code's sessions report.

- [#228](https://github.com/AshikNesin/tiny-agents/pull/228) [`7a9eb42`](https://github.com/AshikNesin/tiny-agents/commit/7a9eb4278171f554f79f1e9c5cf2ceef84214201) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Synced groot `0a924aa`: tighter state machines in auth, passkeys and jobs.
  
  - **Auth:** a failed sign-in no longer signs out a signed-in user, and a stale `checkAuth()` answer that arrives after a sign-in or sign-out is dropped. The store exposes `selectAuthStatus()`.
  - **Passkeys and jobs:** passkey ceremonies and job transitions reject invalid state changes.
  - **Checks:** the changeset gate in a child covers only its own paths, doc-reference checks skip docs synced from groot, and typecheck coverage counts a child's `typecheck:app` projects.

## 1.2.0

### Minor Changes

- [#223](https://github.com/AshikNesin/tiny-agents/pull/223) [`d8d299e`](https://github.com/AshikNesin/tiny-agents/commit/d8d299e6093f68f7759d2a91e84846699f4f4831) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Synced groot 3.2.0 (`e77d641`), which brings back the kit fixes tiny-agents sent upstream plus groot's follow-up work.
  
  - **Scheduled jobs:** croner 11, so a job schedule with `?` in the day-of-month or day-of-week field (`0 0 ? * MON`) runs on the days it names instead of every day.
  - **Server:** `@hono/node-server` 2. Static files are served for GET and HEAD only, and paths with a raw backslash or a `%` left after decoding are refused.
  - **Dependencies:** TypeScript 7 (the native compiler; the AST check scripts use `@typescript/typescript6`), `@hookform/resolvers` 7, Vite+ 1.5 with Vitest 5.1, jsdom 31, hono 4.13 and `@types/better-sqlite3` 9.
  - **Checks:** a `pnpm check:pnpm-policy` gate keeps the supply-chain settings in `pnpm-workspace.yaml`, the migrations check ignores the generated drizzle index, and CI's gitleaks download fallback has a token.
  - **Kept local:** tiny-agents' R6/R6b lint rules, its env and driver exemptions, its test setup and aliases, and its Node-only deletions. groot's `verify-groot` skill is excluded from sync (it drives groot's demo app).

- [#225](https://github.com/AshikNesin/tiny-agents/pull/225) [`9ccb86e`](https://github.com/AshikNesin/tiny-agents/commit/9ccb86e7d958a4afe07666bfd835858717eef2f4) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Synced groot 3.2.1 (`98f12af`), groot's deep-module pass over the kit.
  
  - **Sessions:** one session module, `@groot/core/session` (`startSession`, `endSession`, `requireSession`). The protected API now uses `requireSession`; the old JWT and cookie helpers still work but are deprecated.
  - **Rate limits:** limits count in a `RateLimitStore` the entry supplies, and the entry says who the client is. The Node entry passes `memoryRateLimitStore()` and `peerClientAddress` (the socket peer, or the hop a `TRUSTED_PROXIES` proxy vouches for, as before). Each app gets counters of its own.
  - **Passkeys:** a challenge is consumed with one `DELETE … RETURNING` (`kv.take`), so two concurrent verifications of one challenge can no longer both pass. Housekeeping claims its slot with `kv.claim`.
  - **Signed-in data:** the React Query cache resets on every sign-in, sign-out and expired session (`ShellQueryProvider`), so one account never sees another's cached data. tiny-agents keeps its one mutation retry.
  - **Jobs:** one transitions module and one runner (`jobRunner`); the jobs list filter lives in `useJobsFilter()` and search runs on the server.
  - **Shell and UI:** one hotkeys module (`@groot/ui/hotkeys`, nav shortcuts stand down behind dialogs), one mutation-feedback module (`useAction`), one storage browser (`useStorageBrowser`), ⌘K tabs list their own group, and adding an existing app setting no longer overwrites it. `@groot/ui/command` is deprecated.
  - **Bodies:** a route can own its body limit with `routeBodyLimit()`; `uploadPaths` still works but is deprecated.

### Patch Changes

- [#226](https://github.com/AshikNesin/tiny-agents/pull/226) [`e607021`](https://github.com/AshikNesin/tiny-agents/commit/e6070210708557c3e09fa101060a76ed555c9115) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Synced groot `2a63753` (AshikNesin/groot#167): `routeBodyLimit()` can word its own 413. The upload and Code upload routes now own their body limits with it, keeping their "25 MB" messages, and tiny-agents no longer uses the deprecated `uploadPaths` option.

## 1.1.0

### Minor Changes

- [`2c554d5`](https://github.com/AshikNesin/tiny-agents/commit/2c554d5f324cf88673130ff882cc6d619cc47625) Thanks [@AshikNesin](https://github.com/AshikNesin)! - The Code workspace owns the full page, like Settings.
  
  - The generic app sidebar (Tasks, Terminal, Bots) is hidden on `/code` and
    below: the workspace's own thread list takes the column, Cursor-style.
  - A slim top bar with **Back to tiny-agents** and the ⌘K trigger replaces the
    mobile hamburger that opened the (now absent) sidebar.

## 1.0.0

### Major Changes

- [#213](https://github.com/AshikNesin/tiny-agents/pull/213) [`8d784a2`](https://github.com/AshikNesin/tiny-agents/commit/8d784a23e3e508fdaab434ea631d2adeda2acab3) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Models are owner data (issue [#179](https://github.com/AshikNesin/tiny-agents/issues/179), ADR 0016).
  
  - **Provider accounts and models are database rows.** Each account has a kind (Anthropic, OpenAI Chat, OpenAI Responses, Gemini, Cloudflare AI Gateway, Claude plan) and a key kept as an `app` vault item. Changes apply without a restart.
  - **Bots point at a model row**, not a string. The `custom:` and `claude-code/` id forms and the "primary provider" are gone. A bot without a model runs on the default model.
  - **Model roles** (`bot_default`, `memory_capture`, `chat_title`, `vision`, `classifier`) replace `DEFAULT_MODEL`, `MEMORY_CAPTURE_MODEL`, `CHAT_TITLE_MODEL`, `VISION_*` and `CLASSIFIER_MODEL`, and the hardcoded title, vision and classifier defaults.
  - **The Claude plan is a provider account.** It replaces `CLAUDE_CODE_ENGINE_ENABLED` and `CLAUDE_CODE_ENGINE_FALLBACK`; its fallback is a model.
  - **`@tiny-agents/agent`.** `AgentRuntime.open` takes `modelConfig` and `credentials` instead of `env` and `provider`; `applyModelConfig` replaces them while running. `ModelInfo` is `CatalogModel`; `createClassifier` and `createTranscriber` read roles from the runtime's catalog.
  - **Breaking.** `AI_PROVIDERS`, provider `*_API_KEY`s, `CLOUDFLARE_*`, `GATEWAY_*` and the variables above are no longer read. Set models up again; existing bots run on the default model until you pick one.

### Minor Changes

- [`3ca0b6b`](https://github.com/AshikNesin/tiny-agents/commit/3ca0b6b20b0bc18e034b00e3a25b6a2d7631f168) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Synced groot's settings revamp and Amp-style account menu (groot `4fda966`, after `b1661dd`).
  
  - **Full-page settings.** Settings is now a screen of its own (upstream `56dfce8`): a slim "Back to app" bar, a left sidebar with a searchable, grouped section list (`/` to focus; arrows move, Enter opens, Esc clears) and one sub-route per section — `/settings/account`, `appearance`, `security`, `models`, `notifications`, `people`, `configuration`. The app sidebar is hidden there. `mod+,` opens Settings from anywhere; the old `?tab=` links now go to their section path (`/settings/models`).
  - **Amp-style account menu.** The sidebar's account menu follows upstream `4fda966`: Log out on top, then a Command palette row (⌘K), then the destinations with Settings last, next to the trigger. Send feedback stays at the bottom.
  - **Adopted upstream kit versions.** `@groot/core` 2.1.0, `@groot/shell` 2.1.0, `@groot/ui` 1.1.0, `@groot/jobs` 2.0.1 with their changelogs, so future version-bump syncs merge cleanly.

- [#213](https://github.com/AshikNesin/tiny-agents/pull/213) [`8d784a2`](https://github.com/AshikNesin/tiny-agents/commit/8d784a23e3e508fdaab434ea631d2adeda2acab3) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Stored secrets use a new at-rest format (issue [#179](https://github.com/AshikNesin/tiny-agents/issues/179), slice 1).
  
  - **Per-purpose keys.** Local vault items and MCP connection secrets are sealed with AES-256-GCM under keys derived from `SECRETS_KEY` with HKDF, one per purpose.
  - **Bound to their record.** The purpose, record and field are the AAD, so a value copied to another item, row or column doesn't decrypt.
  - **Rotation.** `SECRETS_KEY_PREVIOUS` opens values written under the old key, and `pnpm secrets:rotate` re-seals them under the new one.
  - **Breaking.** Values stored in the old `v1` format are not read: re-enter local vault items and connection header secrets, and sign connections in to OAuth again.

- [#213](https://github.com/AshikNesin/tiny-agents/pull/213) [`8d784a2`](https://github.com/AshikNesin/tiny-agents/commit/8d784a23e3e508fdaab434ea631d2adeda2acab3) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Settings → Models (issue [#179](https://github.com/AshikNesin/tiny-agents/issues/179), slice 4).
  
  - **Add models.** Connect a provider from a template or by kind, check which models its endpoint lists and keep the ones you want; or add a single model by id, test it, and add it. Keys go straight into the vault.
  - **Accounts and models.** Status, key hint, enable and disable, check again, edit the endpoint or key, delete (confirming first, then moving the bots that use it), per-model Test, and the Claude plan's fallback model.
  - **Default models.** Pick the model for new bots, memory capture, chat titles, image transcription and auto-review.
  - **Safe by default.** Creating, editing and deleting an account need step-up; discovery refuses private addresses unless the account allows them, follows no redirects and caps size and time; no route returns a key.
  - **`@tiny-agents/agent`.** `discoverModels`, `resolveCapabilities`, `PROVIDER_TEMPLATES` and `testModelCall` for the app's routes.

- [#213](https://github.com/AshikNesin/tiny-agents/pull/213) [`8d784a2`](https://github.com/AshikNesin/tiny-agents/commit/8d784a23e3e508fdaab434ea631d2adeda2acab3) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Vault items have an audience (issue [#179](https://github.com/AshikNesin/tiny-agents/issues/179), slice 2; ADR 0015).
  
  - **`app` items.** A secret the server uses itself, such as a model provider's key. Bots never list or use it; only the new `provider` sink resolves it, for a host the item lists. Successful uses aren't audited, and the value is cached in memory for up to five minutes.
  - **Policy binding.** A local item is bound to a digest of its policy (audience, origins, hosts, injection). Edits through the Vault UI re-seal it; widening an item's hosts in the database directly leaves its value unreadable.
  - **Vault page.** App items appear under "Used by the app" and can't be edited or deleted there.
  - **Breaking.** Local vault items stored before this change don't open: re-enter them.

### Patch Changes

- [#221](https://github.com/AshikNesin/tiny-agents/pull/221) [`dce2d98`](https://github.com/AshikNesin/tiny-agents/commit/dce2d98e3732dcb5b839fd5c37e839d56bb40070) Thanks [@AshikNesin](https://github.com/AshikNesin)! - **Add a model** on an account's card in Settings → Models now suggests models as you type: everything the account's endpoint lists that the account doesn't have yet, the same list the Add models dialog offers (a Cloudflare AI Gateway's catalog, its BYOK providers and its custom providers). Any other model can still be added by typing its id.

- [#218](https://github.com/AshikNesin/tiny-agents/pull/218) [`56ada98`](https://github.com/AshikNesin/tiny-agents/commit/56ada985d0014bbaeea7c04ff1dd09e9a78d8d2f) Thanks [@AshikNesin](https://github.com/AshikNesin)! - **Test** on a classifier model (Jev, Clef) in Settings → Models now makes one real classify call. It used to try a chat completion and always failed with "The model can't run (missing)", even though auto-review on the same model worked.

- [#218](https://github.com/AshikNesin/tiny-agents/pull/218) [`56ada98`](https://github.com/AshikNesin/tiny-agents/commit/56ada985d0014bbaeea7c04ff1dd09e9a78d8d2f) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Settings has no separate **Claude plan** tab any more. The Claude plan's engine status and **Sign in to Claude** now sit inside the Claude plan account's card in Settings → Models, beside its models and fallback. Old `?tab=claude` links open the Models tab.

- [#220](https://github.com/AshikNesin/tiny-agents/pull/220) [`9f7db2a`](https://github.com/AshikNesin/tiny-agents/commit/9f7db2a01b2008d521aa9bfa2e77ab4270cea9a7) Thanks [@AshikNesin](https://github.com/AshikNesin)! - A gateway custom provider's model added by id (e.g. `custom-zai-coding-plan/glm-5.3`) no longer fails with an upstream's raw 404 page:
  
  - It goes to the custom provider's own gateway URL even before the provider is set up.
  - Its row in Settings → Models says when the provider isn't set up or has no base path.
  - **Custom providers** opens with the slug filled in.
  - Test explains an upstream 404 as a missing or wrong base path.

- [#217](https://github.com/AshikNesin/tiny-agents/pull/217) [`e7ef2e4`](https://github.com/AshikNesin/tiny-agents/commit/e7ef2e4abfd913cc54e6cdf312113c8e58b5611e) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Models fixes from real use against Cloudflare AI Gateway (issues [#215](https://github.com/AshikNesin/tiny-agents/issues/215), [#216](https://github.com/AshikNesin/tiny-agents/issues/216)).
  
  - **Custom providers on the gateway ([#216](https://github.com/AshikNesin/tiny-agents/issues/216)).** A gateway account lists the custom providers configured in the gateway (slug and base path, e.g. `custom-zai-coding-plan`, `api/coding/paas/v4`). Their models appear beside Claude and the TypeSafe classifier in the same account, discovered through the gateway, and run on its token. Add them when connecting or from the card's **Custom providers**.
  - **Claude Sonnet 5.5 and Opus 5.5 work.** Calls without a thinking level (Test, chat titles, memory capture) no longer send `thinking: disabled`, which these models refuse.
  - **Clearer gateway models.** Workers AI catalog models are named `… (Workers AI)`; Test explains a missing BYOK key or Unified Billing credits (402) and a Workers Paid-only model (403).
  - **Settings → Models ([#215](https://github.com/AshikNesin/tiny-agents/issues/215)).** Reset stays inside the Default models card, and every model picker (default models, the Claude plan fallback, moving bots, the bot's model) is searchable.

## 0.1.2

### Patch Changes

- [#212](https://github.com/AshikNesin/tiny-agents/pull/212) [`dfca2ee`](https://github.com/AshikNesin/tiny-agents/commit/dfca2ee485c4928fa911174e2a9ee613a2c4ca3f) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Synced groot 3.1 (b1661dd).
  
  - **Command palette.** The ⌘K palette is now groot's Fluid command menu (`@groot/ui/command-menu`), with tabs per group and keyboard shortcuts. tiny-agents still passes `commandBuiltIns={false}`, so its own Navigation, Theme and Account groups appear once.
  - **Session guard and client address.** The fixes upstreamed from tiny-agents now come back from groot, so the next sync has nothing to merge in these files. The shell declares the `SESSION_INVALID` literal itself instead of importing a type from core. On Workers, `clientIp()` falls back to `cf-connecting-ip`.
  - **Kept local.** tiny-agents' versions and changelogs, its CI gates, its first-run setup page (`min-dvh`), its login page and its client docs stay as they were.

## 0.1.1

### Patch Changes

- [#204](https://github.com/AshikNesin/tiny-agents/pull/204) [`f2710a1`](https://github.com/AshikNesin/tiny-agents/commit/f2710a19457c4e154783bcda8fd954d6fee02d32) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Deleting a bot now ends every live connection to it. Before, a guest's or
  another tab's open chat stream of the deleted bot, its open desktop viewers
  and its unredeemed viewer tickets kept working until the client
  disconnected or the sandbox closed the desktop.
  
  `revokeLiveAccess` (`api/people/live-access.ts`) now takes the person, the
  bot, or both, and the bot's `liveAccess` entry in `BOT_RESOURCES` revokes
  by bot after the row is deleted. It replaces the `chatStreams` entry, which
  kept those streams open on purpose.

- [#209](https://github.com/AshikNesin/tiny-agents/pull/209) [`991ff10`](https://github.com/AshikNesin/tiny-agents/commit/991ff109cc01a2308b28324672e4502fc8f91397) Thanks [@AshikNesin](https://github.com/AshikNesin)! - A deleted bot's resources are released even when the release is cut off.
  Before, a crash or restart during the release, or a sandbox outage that
  failed the browser or desktop wipe, left the resource behind for good: the
  failure was logged and never retried.
  
  The transaction that deletes the bot row now records each release the bot
  owes in the new `bot_releases` table (migration `0008`), with what the
  release needs. A release that succeeds removes its row. At boot,
  `sweepBotReleases` (`api/bots/bot-resources.ts`) runs every release still
  recorded, so a deleted bot's chat that resumed after a crash is stopped and
  its own browser profile and desktop are wiped once the sandbox answers.
  A release in `BOT_RESOURCES` now gets the bot id and what its `capture`
  read in place of the bot row. Each capture names a zod shape, and every
  read parses the stored JSON with it. A record that no longer parses is
  logged and dropped. The desktop stays owed while `SANDBOX_HOST` is set but
  the desktop config is wrong.

- [#201](https://github.com/AshikNesin/tiny-agents/pull/201) [`ddfc020`](https://github.com/AshikNesin/tiny-agents/commit/ddfc0206856e745e4663101928f5663e7e297d0b) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Removing a guest, or unsharing a bot from them, now ends what they already
  hold open. Before, a removed guest's open chat stream, `/events` feed, Code
  streams and desktop live view kept running until the browser disconnected,
  and a live-view ticket minted in the last minute still opened a viewer.
  Unsharing a bot left that bot's chat stream and live view open the same way.
  
  Every SSE stream, open desktop viewer and unredeemed viewer ticket is now
  held in one registry of live access (`api/people/live-access.ts`) under its
  person and, when it shows one bot, that bot. `removeGuest` closes everything
  the guest holds; `setBotGuests` closes what each dropped guest holds on that
  bot. Registering re-checks the account and the share synchronously, so a
  stream or ticket opened by a request that passed its access check before a
  revocation landed is closed at once. Viewers close with WebSocket code 1008,
  stop forwarding input while closing, and are cut a second later. A viewer
  that closes while its desktop stream is still opening now closes that
  stream and frees its viewer slot; before, four such viewers left the bot
  answering 429 to every new viewer.

- [#191](https://github.com/AshikNesin/tiny-agents/pull/191) [`ae0099b`](https://github.com/AshikNesin/tiny-agents/commit/ae0099bfe7b438b19fd865ea839c73948afa41f9) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Delete dead code, and fail CI on new dead code. `pnpm check:dead` runs knip
  and fails on any unused file, export or unresolved import. Its message says
  to add a file loaded by path to `entry` in `knip.json`, and otherwise to run
  `scripts/codemods/remove-dead-code.ts`, which deletes unused files only with
  `--remove-files`. Oxlint's `no-unused-vars` is now an error.
  
  - `@tiny-agents/agent`, `@tiny-agents/code`, `@tiny-agents/claude-worker`:
    unused exports inside the packages lose `export` or are deleted, including
    the deprecated `createGatewayModels` alias and `ClaudeEngineError`. No
    export reachable from a package's `exports` map changes.
  - `tiny-agents`: `pnpm db:generate` runs `drizzle-kit generate` alone.
    `apps/web/drizzle/index.ts`, which only the deleted Workers entry read, and
    `scripts/db-generate.ts`, which wrote it, are gone. The script is listed in
    `additional_exclusions`, so `pnpm groot:sync` never restores it.

- [#190](https://github.com/AshikNesin/tiny-agents/pull/190) [`74eddfe`](https://github.com/AshikNesin/tiny-agents/commit/74eddfec119010ff3d63e04ede952e058101587b) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Comments in `@groot/core` (env, bootstrap, storage adapter), the `@groot/jobs` "no job handlers registered" log line and the setup script's deploy hint no longer describe the deleted Workers target, `@groot/ai` or a `startWebApp()` that does not exist.

- [#195](https://github.com/AshikNesin/tiny-agents/pull/195) [`80eb795`](https://github.com/AshikNesin/tiny-agents/commit/80eb79545ca683eb3db84ce44f0b01716cfea5c5) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Parse durable memo and document JSON once, at the toolkit boundary. Every
  read of a task memo or task document field that holds a structured value
  (`gate:plan`, `gate:review`, `vault:use`, the questions document's questions
  and answers, the credential request) now parses it with a zod schema in
  `packages/agent/src/durable-json.ts`, and a value of the wrong shape fails at
  once with an error naming its key. Writes copy the value to JSON with
  `toJson`, which drops undefined fields.
  
  - `@tiny-agents/agent`: no public export changes. `zod` is a new dependency.
    A pending vault card in a call's details shows only when it fits the
    `ChatVaultUse` shape, fields outside that shape are dropped, and a card
    that does not fit logs a warning naming `vault`.
  - `tiny-agents`: lint rule R6 (`repo/no-double-cast`) fails any `as unknown as`
    or `as any as` in `packages/agent/src` outside test helpers, with a message
    naming `durable-json.ts`. Rule R6b (`repo/no-never-cast`) fails `as never`
    there too; the gate now carries its hooks as `GateHooks<unknown>`.

- [#194](https://github.com/AshikNesin/tiny-agents/pull/194) [`0c1f5c5`](https://github.com/AshikNesin/tiny-agents/commit/0c1f5c597aaa2b9c3e0bff2e98e37d76adee3f8e) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Keep guest access and vault kind defaults in one shared table each, so
  adding a guest page or changing a kind's default tools is one edit.
  
  - `apps/web/src/shared/guest-access.ts` lists each guest-visible feature
    with its page and its API routes. The guest guard, the sidebar and the
    router all read it. Every signed-in page sits under one guest gate in
    `App.tsx` that sends a guest to their chats from any page the table does
    not list. A guest sees and reaches the same pages as before.
  - `apps/web/src/shared/vault-kinds.ts` holds the default tools per vault
    kind. The server and the New item page import it. The defaults are
    unchanged.
  - Tests fail, naming the table, when a signed-in route sits outside the
    gate, a table page has no route, the guard admits a route the table does
    not list, or a table rule matches no mounted route.

- [#200](https://github.com/AshikNesin/tiny-agents/pull/200) [`09c9d2c`](https://github.com/AshikNesin/tiny-agents/commit/09c9d2c2440892591dd10b0b5252ca2ccac84737) Thanks [@AshikNesin](https://github.com/AshikNesin)! - A guest now sees only what the owner shared with them.
  
  - Uploads: a guest reads an upload they uploaded, or one sent in the chat of
    a bot shared with them, and deletes only their own. Any other upload id
    answers 404, as an unknown one does. A guest cannot send an upload they
    cannot read. Uploads record who uploaded them and the bot whose chat they
    were first sent in (migration `0007`). An upload sent before this change
    has neither, so only the owner reads it.
  - `GUEST_ACCESS` gains an `upload` rule kind (matched after `/uploads/<id>`,
    with the uploads it reaches), so the guest guard checks the upload the way
    it checks a shared bot. The drift test refuses a plain `path` rule that
    matches an upload's routes.
  - `/events` sends a guest the activity (replying, approvals, questions) of
    the bots shared with them only, and no connection state. The owner's feed
    is unchanged.

- [#203](https://github.com/AshikNesin/tiny-agents/pull/203) [`2987d1a`](https://github.com/AshikNesin/tiny-agents/commit/2987d1ab228b638bf08f7f792b9fa6d5f8eae667) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Rate limits and request logs key on the client's real address. A client could
  send a new `X-Forwarded-For` value on each sign-in attempt to get a fresh
  rate-limit bucket and guess passwords without limit.
  
  - `clientIp()` returns the socket peer. It reads `X-Forwarded-For` only when
    the peer is a trusted proxy, and then takes the rightmost hop that is not
    one. It no longer reads `CF-Connecting-IP` or `X-Real-IP`.
  - `TRUSTED_PROXIES` (env) and `config.trustedProxies` list the trusted
    proxies: IPv4 addresses or ranges and IPv6 addresses. Unset trusts
    loopback and the private networks (`127.0.0.0/8`, `10.0.0.0/8`,
    `172.16.0.0/12`, `192.168.0.0/16`, `::1`). A list replaces that default,
    and `none` trusts no proxy.

- [#193](https://github.com/AshikNesin/tiny-agents/pull/193) [`4bd27ac`](https://github.com/AshikNesin/tiny-agents/commit/4bd27ac3c83f67f4b4ad8d757f08248ea3333160) Thanks [@AshikNesin](https://github.com/AshikNesin)! - The session guard (`jwtAuthMiddleware`) now looks up the token's account and
  answers 401 `SESSION_INVALID` when it no longer exists, so the client signs
  out. It sets `c.get("user")` from that account. Before, a signed token was
  enough, so a guest the owner removed kept a working session until the token
  expired, and tiny-agents treated that account (no `guests` row) as the owner.

## Unreleased

- Experimental Claude Pro/Max inference. A `claude-code/<model>` bot talks
  to a loopback Claude Code worker over Tailscale. tiny-agents does not
  read or store the Claude login, and it does not proxy Anthropic.
  `CLAUDE_CODE_ENGINE_ENABLED` turns it off without redeploying the worker.
  See `docs/claude-subscription.md`. Boot now refuses an `sk-ant-oat` token
  in model-provider config.
