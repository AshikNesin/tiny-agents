# tiny-agents

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
