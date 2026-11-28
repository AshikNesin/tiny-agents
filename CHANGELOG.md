# tiny-agents

## 1.9.0

### Minor Changes

- [#635](https://github.com/AshikNesin/tiny-agents/pull/635) [`58dc879`](https://github.com/AshikNesin/tiny-agents/commit/58dc879ce89908e77cb4914155a436ebfff1332e) Thanks [@AshikNesin](https://github.com/AshikNesin)! - The sandbox can now run on an AWS Lambda MicroVM. Set `SANDBOX_PROVIDER=microvm` with an image from `pnpm sandbox:microvm:image` and an IAM role, and bots get the same shell, browser, desktop and terminal there. You don't store any AWS keys or SSH keys: the app signs in to AWS with its own OIDC tokens (published at `/.well-known/openid-configuration`) and gives each VM a fresh SSH key when it starts it. A VM lasts at most 8 hours, after which new work moves to a fresh one; files, browser logins and terminal tabs don't carry over. Setup and local testing are in `docs/guides/microvm-sandbox.md`.

## 1.8.0

### Minor Changes

- [#631](https://github.com/AshikNesin/tiny-agents/pull/631) [`b2e4c4a`](https://github.com/AshikNesin/tiny-agents/commit/b2e4c4a07b4ac1ecf5161b752bf0fb85f3ce4aae) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Bots can now write artifacts: a document, code file, diagram, SVG or single HTML page that opens in a panel next to the chat instead of filling the reply. Each change the bot makes is kept as a version, so you can look back at any of them, copy or download it, and restore an old one. HTML and SVG run in a locked-down frame that can't reach your session or the network. Guests of a shared bot can read its artifacts.

- [#617](https://github.com/AshikNesin/tiny-agents/pull/617) [`2df6eaa`](https://github.com/AshikNesin/tiny-agents/commit/2df6eaa84c2831d44d73846994a72825b05964d6) Thanks [@AshikNesin](https://github.com/AshikNesin)! - The vault asks you to confirm it's you only when a value could leave it: revealing, copying, deleting, linking an existing 1Password item, or changing an item's URLs or policy. Adding an item, changing its title or values, saving a sign-in a bot asked for, and moving local items to 1Password no longer ask. The Android app can confirm with a passkey (fingerprint or face): with `ANDROID_APP_CERT_SHA256` set, the server's `/.well-known/assetlinks.json` now also lets the app use the server's passkeys, and the server accepts passkey answers signed for the app.

### Patch Changes

- [#627](https://github.com/AshikNesin/tiny-agents/pull/627) [`4bf8b31`](https://github.com/AshikNesin/tiny-agents/commit/4bf8b31fe56772d5a3d6bfdd839aa4554652e6eb) Thanks [@AshikNesin](https://github.com/AshikNesin)! - The Android app confirms vault reveals with your fingerprint: it keeps your password behind the phone's fingerprint lock and sends it for you. The server no longer accepts passkeys signed for the Android app, and `/.well-known/assetlinks.json` is back to app links only.

- [#621](https://github.com/AshikNesin/tiny-agents/pull/621) [`a9cc44d`](https://github.com/AshikNesin/tiny-agents/commit/a9cc44dfbd7560957e40a173d88a584831cab812) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Smoother everyday use. A Settings link opened straight from the address bar, a bookmark or a reload now stays on its section instead of falling back to Appearance. Phone pages show one menu button instead of two. Adding a project in Code makes its chat right away, so it shows up in Chat's sidebar without opening it from Code first.
  
  New chat (the header button, its shortcut and the palette) starts a fresh chat straight away instead of asking first, the same as typing `/new`. The chat you leave stays in Chat history, where you can read or continue it.

- [#628](https://github.com/AshikNesin/tiny-agents/pull/628) [`522fc04`](https://github.com/AshikNesin/tiny-agents/commit/522fc04822bafe146b9d02d601457368f6479e42) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code threads now get every connection and skill you can use in a bot chat. Before, a Code thread only had the connections and skills switched on for every bot, so one turned on for just some bots, and any skill a bot saved for itself, never showed up in Code. A connection or skill that no bot has is still left out, and Settings > Tools still decides allow, ask or off.

- [#625](https://github.com/AshikNesin/tiny-agents/pull/625) [`d0b1f2c`](https://github.com/AshikNesin/tiny-agents/commit/d0b1f2c90367fe62c2a99a5154473787bfd499e6) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Fewer "Confirm it's you" prompts. Replacing a model account's key or a connection's header value, discovering or testing a model endpoint, saving a GitHub token and starting GitHub App setup no longer ask for your password. Adding an account or connection, pointing one somewhere new, and deleting one still do. Saving a GitHub token in Settings works again; it failed every time before.
  
  Bots save memories you ask for without an approval card. Forgetting a memory still asks, and you can set saving back to Ask under Settings > Tools.
  
  A draft pull request now says "Turn Draft off to merge" beside its disabled Merge button, so the reason shows on a phone too.

- [#614](https://github.com/AshikNesin/tiny-agents/pull/614) [`744f27f`](https://github.com/AshikNesin/tiny-agents/commit/744f27fe5df0720485fd82b429ff00216cc8aa7f) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Fix every DELETE request failing with a 500 ("Cannot read properties of undefined (reading 'window')") on the Node server after the 1Password fix. The server again lets its HTTP adapter replace the global `Request`, which the body limit needs, and only puts the built-in `Response` back for 1Password's SDK.

- [#615](https://github.com/AshikNesin/tiny-agents/pull/615) [`5957ff8`](https://github.com/AshikNesin/tiny-agents/commit/5957ff8a289e0e80ddd62427e41d2c7f4a15c193) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Project chat now looks like any bot chat. Code's Project chat link opens it in Chat, with the Chat sidebar, and the Threads panel starts closed; its button shows a dot when a thread needs you.

- [#626](https://github.com/AshikNesin/tiny-agents/pull/626) [`e779535`](https://github.com/AshikNesin/tiny-agents/commit/e77953572aca2c42a2c926a3ddce12359be41c36) Thanks [@AshikNesin](https://github.com/AshikNesin)! - The chat sidebar lists Projects, then Bots, then Threads at the bottom, each showing its first few rows with a **More** row for the rest.

- [#628](https://github.com/AshikNesin/tiny-agents/pull/628) [`522fc04`](https://github.com/AshikNesin/tiny-agents/commit/522fc04822bafe146b9d02d601457368f6479e42) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Typing `/` in a bot chat or a Code thread now lists your tools as well as commands and skills. Each connection shows up (for example `/github` for every GitHub tool), and as you type you can pick a single tool. A picked tool sits as a chip above the composer, and the message asks the agent to load and use it. The chat menu also offers `/new`, and it opens even for a bot with no skills.

- [#630](https://github.com/AshikNesin/tiny-agents/pull/630) [`3d5b044`](https://github.com/AshikNesin/tiny-agents/commit/3d5b04442d27ae96146fc10f6968def874d87a99) Thanks [@AshikNesin](https://github.com/AshikNesin)! - A Code thread id with no instance in front (`cA` rather than `shelley:cA`) is no longer read as a Shelley conversation. Such ids were last written before Code had more than one coding agent. A migration gives any hand-off, pull request, checkpoint, viewed mark or review comment still saved under one its Shelley thread, so those keep working. A thread opened by an id the app does not know now answers "not found" instead of asking Shelley for a conversation of that name.
  
  `@tiny-agents/code` removes `LEGACY_INSTANCE_ID` and the second argument of `parseThreadId`.

- [#616](https://github.com/AshikNesin/tiny-agents/pull/616) [`5cb7857`](https://github.com/AshikNesin/tiny-agents/commit/5cb78578c0a97494504aa7b9e7f7b006518fc621) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Settings → Models names where an account's key is kept as "1Password" or "Local", not the internal `onepassword`/`local`, and linking an item from an unconfigured vault says "1Password is not configured".

- [#612](https://github.com/AshikNesin/tiny-agents/pull/612) [`b7fec7a`](https://github.com/AshikNesin/tiny-agents/commit/b7fec7aad03f670021aa28e0d7535dc89249ccef) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Fix the 1Password vault on deployed servers: every request failed and the Vault card said 1Password "refused the service account token" with a "reqwest library: error sending request" message. The Node server replaced the global `Response` class, and 1Password's SDK rejects any fetch answer that isn't the built-in `Response`. The server now leaves the globals alone, so no setting changes are needed; redeploy. When the SDK really can't send a request, the card now says 1Password is unreachable from the server instead of blaming the token.

- [#624](https://github.com/AshikNesin/tiny-agents/pull/624) [`aedd94c`](https://github.com/AshikNesin/tiny-agents/commit/aedd94c1bf57def38fba34dee53c2b63b4a285b4) Thanks [@AshikNesin](https://github.com/AshikNesin)! - A credential request filled twice while the first fill is still running now gets the first fill's answer instead of "This request is being filled already.", and the web form's button reads **Filling…** while it runs. Saving a new item to 1Password takes one request fewer: the item's details come from 1Password's create answer instead of a second read.

## 1.7.0

### Minor Changes

- [#560](https://github.com/AshikNesin/tiny-agents/pull/560) [`a64a13c`](https://github.com/AshikNesin/tiny-agents/commit/a64a13cd4b4fdc8027b9b51dfbe1bf75cacb5541) Thanks [@AshikNesin](https://github.com/AshikNesin)! - New connections and skills now reach every bot, including bots you make later, so you no longer switch them on bot by bot. A bot can still turn one off, and a connection's or skill's page has an **Every bot** switch to narrow it to the bots you tick. Bots shared with guests get them too, and project chats get them only when ticked. Connections every bot shares always load on demand, so each adds one short line to a request. Existing setups keep exactly what each bot had: a connection or skill every bot already used becomes shared.

- [#565](https://github.com/AshikNesin/tiny-agents/pull/565) [`566e80d`](https://github.com/AshikNesin/tiny-agents/commit/566e80df2f2d2ba9ad59d812d5f56170aafd6347) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Claude Code threads can now use your connections too. Every connection shared with every bot is offered to Claude Code, loaded on demand, and the calls run in the app, so connection sign-ins never reach the sandbox. Settings > Tools decides which tools run, ask or stay off, and a tool that asks shows the usual approval card.

- [#517](https://github.com/AshikNesin/tiny-agents/pull/517) [`73004b3`](https://github.com/AshikNesin/tiny-agents/commit/73004b35c767ffc337841cb59559989f6a2eaaa7) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code: after a turn the composer suggests your likely next message in grey, and completes the line while you type; `Tab` takes it. It uses the cheap title model with a small, cached prompt.

- [#515](https://github.com/AshikNesin/tiny-agents/pull/515) [`c0a661e`](https://github.com/AshikNesin/tiny-agents/commit/c0a661e1f6164c66d4789532e94228d2501036dc) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code: the Files tab shows the worktree as a folder tree with the agent's changes marked, and opens a file beside it. `z` widens the work pane over the thread and back. The Pull request tab gains **YOLO Merge**: it resolves the open review threads, waits for the checks and for GitHub to allow the merge, then merges by itself.

- [#512](https://github.com/AshikNesin/tiny-agents/pull/512) [`6a3820f`](https://github.com/AshikNesin/tiny-agents/commit/6a3820fab0a3c093a589861561eff6ddfa72fede) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code: open a thread's worktree in Cursor or Zed over SSH from the thread header (or `o`). The dialog remembers the editor and SSH host, and for the local Docker sandbox it shows the `~/.ssh/config` entry to add.

- [#531](https://github.com/AshikNesin/tiny-agents/pull/531) [`39114a8`](https://github.com/AshikNesin/tiny-agents/commit/39114a8d8166c44d42fdc8230242e6ec3981fe65) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code: threads the project chat started now report back to it. It hears when a thread waits for you and when its PR opens, goes green, fails checks or merges, as one short line each, batched into one turn. Long thread results are cut to their first 1,500 characters, with the rest in the thread.

- [#530](https://github.com/AshikNesin/tiny-agents/pull/530) [`878697e`](https://github.com/AshikNesin/tiny-agents/commit/878697e3c7362b0aa50c6eb82648dbb11fbfd709) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code: every project gets a Project chat. It is a bot tied to that one project that answers quick questions itself and hands coding work to threads, one thread per workstream, and hears back when they finish. It has no shell, browser or vault, so all changes happen in threads. A new Instructions box in the project's settings reaches the chat and the first message of every new thread of the project.

- [#521](https://github.com/AshikNesin/tiny-agents/pull/521) [`503956c`](https://github.com/AshikNesin/tiny-agents/commit/503956c8d8faa193b9d8e2c4fa9bb3269b53ada9) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code: Settings › Reviews chooses what the sidebar's Reviews list shows. By default it leaves out requests sent to a team you are on, drafts and bot PRs, and shows 10 with the rest one click away. You can also keep it to project repositories, and hide PRs by title words or `@author`.

- [#564](https://github.com/AshikNesin/tiny-agents/pull/564) [`cc913e7`](https://github.com/AshikNesin/tiny-agents/commit/cc913e773273b39fb3cf1560165cd73d814a32de) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Native Code threads can now use your connections. Every connection shared with every bot is offered in a Native thread, loaded on demand, with Settings > Tools deciding which tools run, ask or stay off.

- [#566](https://github.com/AshikNesin/tiny-agents/pull/566) [`dadbaf1`](https://github.com/AshikNesin/tiny-agents/commit/dadbaf1810244339d908e356695882f03b0497f8) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code threads can now use your skills. Every skill shared with every bot is offered in Native and Claude Code threads. Only each skill's name and description go into the prompt, and its instructions load when a thread uses it.

- [#516](https://github.com/AshikNesin/tiny-agents/pull/516) [`c3afd03`](https://github.com/AshikNesin/tiny-agents/commit/c3afd039df5b4e15d61d6291086a6ffde1ed665f) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code: right-click a thread in the list for Open PR, Archive and Delete. `@groot/ui/context-menu` is new.

- [#509](https://github.com/AshikNesin/tiny-agents/pull/509) [`7c34436`](https://github.com/AshikNesin/tiny-agents/commit/7c3443651e369eb579b5aa32c30ff7d90a7e4b45) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code is rebuilt as one keyboard-first workspace. Threads are listed by status (Needs you, Working, In review, Done) beside the open thread and a work pane, every action has a key, and `?` lists them. A thread now belongs to a project, keeps an id of its own, and records each turn as a run. Code is for the owner only, the next-message suggestion, bulk archive, the usage report and threads outside a project are gone, and thread links moved to `/code/t/<id>` (old links redirect).

- [`09afcbd`](https://github.com/AshikNesin/tiny-agents/commit/09afcbda2badb2d6a37765b16330e5e929e39259) - Legacy Code thread links (`/code/<id>`) no longer redirect to `/code/t/<id>` on web and no longer open a thread in the Android app. All current links use `/code/t/<id>`.

- [#533](https://github.com/AshikNesin/tiny-agents/pull/533) [`cfb9820`](https://github.com/AshikNesin/tiny-agents/commit/cfb982001b452c30a62418f3de07ccd2f7808a2a) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Syncs the groot boilerplate from 3.2.1 to 3.4.0 (upstream commit a649c6d4). Brings in session logout by token version (sessions issued before a password change are refused), an `isAdmin` flag that gates the jobs API and jobs tooling, configurable PBKDF2 password iterations, jobs singleton rework (unique index per `name`+`singletonKey` with rerun support), the content-type-aware storage schema helpers, request-id logging, jose security fixes, and an updated lockfile. Local behavior is kept where it diverges: 600,000 password iterations, no R2 storage adapter, comment-free code, and file views that navigate to the download endpoint instead of a same-origin blob URL.

- [#507](https://github.com/AshikNesin/tiny-agents/pull/507) [`d2db3ec`](https://github.com/AshikNesin/tiny-agents/commit/d2db3ec6d5857b5373c50366c51059e99fa71d89) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Bots tidy their memory once a week. One small model call per bot (only when its memories changed) merges duplicate memories and expires ones that a newer memory contradicts or whose time has passed. Changes show on the Memory page as superseded or expired and can be restored, and a plan that would touch more than half the memories is ignored.

- [#587](https://github.com/AshikNesin/tiny-agents/pull/587) [`37c82f8`](https://github.com/AshikNesin/tiny-agents/commit/37c82f81143fccf022b32ad7deb43a945824f59b) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Mermaid code blocks now render as diagrams wherever chat markdown shows: bot chats, Code threads, PR descriptions and comments, LLM traces and skill previews. Each diagram has a Show source toggle and a copy button, and a block that doesn't parse stays a code block with the reason underneath. Diagrams are drawn by pele, loaded only when a page has one.

- [#509](https://github.com/AshikNesin/tiny-agents/pull/509) [`7c34436`](https://github.com/AshikNesin/tiny-agents/commit/7c3443651e369eb579b5aa32c30ff7d90a7e4b45) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code has a third agent, Native, built on the same runtime the chat bots use. It needs a sandbox and a model that runs on pi, and no other setup. A Native thread reads, writes and edits files and runs commands in its working directory on the sandbox, asks before it changes anything unless its permission mode says otherwise, takes a steer or a queued message while it works, and can be stopped, forked, compacted and continued after an error. Settings → Models has a new default, New Code threads, for the model a Native thread starts on.
  
  For developers: `AgentRuntime` gains `cwd` on a conversation's config, `fork`, `compact` and `continueReply`; `@tiny-agents/agent` exports `createCodingToolkit` and `codingSelection`; `@tiny-agents/code/server` exports `createPiHarness` and its `PiPort`; the model catalog has a `code_default` role; and a sandbox `exec` takes an abort `signal`.

- [#508](https://github.com/AshikNesin/tiny-agents/pull/508) [`8738309`](https://github.com/AshikNesin/tiny-agents/commit/87383096607cd8412c4f94fcb0d974b56eec9e06) Thanks [@AshikNesin](https://github.com/AshikNesin)! - The Routines page says how often each routine messaged you, as "Messaged you in 3 of the last 10 runs". A routine that messages you on every run gets a hint to tell it to stay quiet when nothing is new.

- [#506](https://github.com/AshikNesin/tiny-agents/pull/506) [`72db2ac`](https://github.com/AshikNesin/tiny-agents/commit/72db2acf9cfe277781bffe02cabfb057e6da5e8a) Thanks [@AshikNesin](https://github.com/AshikNesin)! - A routine can keep a progress note for its next run. A run saves it with the new `save_routine_progress` tool (offered only in routine runs), and the next run reads it in place of the three quoted results. The owner sees, edits or clears it as Progress note in the routine's editor.

- [#504](https://github.com/AshikNesin/tiny-agents/pull/504) [`339d427`](https://github.com/AshikNesin/tiny-agents/commit/339d427693e7502b3754d5f0a00b0003d5199fa1) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Routines can run on a webhook. Pick the Webhook schedule, then use Webhook URL on the routine to get a secret URL; a POST to it runs the routine with the request body as data. Deliveries are acknowledged at once, a repeated delivery id runs once, deliveries that arrive during a run go into the next run together, and an hourly cap keeps a noisy sender from running up the bill.

- [#586](https://github.com/AshikNesin/tiny-agents/pull/586) [`fbd8ec0`](https://github.com/AshikNesin/tiny-agents/commit/fbd8ec069d5a25b65b3b306cebcb77f9aba60d8d) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Typing `/` at the start of a message lists your skills: in a bot chat (the bot's skills) and in a Code thread whose agent takes skills (Native and Shelley). In a chat the pick is written as `/skill-name ...`, and the bot is told that such a message asks for that skill. In a Code thread the pick joins the message's skills like the **+** menu. Native threads now list skills too, the shared ones plus the repo's `.agents/skills` and `.claude/skills`, and a Native agent reads a repo skill's `SKILL.md` when asked for it by name.

- [#588](https://github.com/AshikNesin/tiny-agents/pull/588) [`68b39cf`](https://github.com/AshikNesin/tiny-agents/commit/68b39cf9df593249e131ecc014090bd8b40e55df) Thanks [@AshikNesin](https://github.com/AshikNesin)! - The sidebar has a softer look: a light gradient behind it, Search and Tasks as rows at the top, project chats in their own Projects section above Threads and Bots, Threads and Bots sections that fold from their heading (and stay folded), one-line rows with the time on the right, and a quiet icon row at the foot for the account menu, Terminal, Computer, Browser and Settings. The Code sidebar shares the same gradient.

- [#532](https://github.com/AshikNesin/tiny-agents/pull/532) [`6b0cde8`](https://github.com/AshikNesin/tiny-agents/commit/6b0cde84e4f977a631da960de99f5ab19d304618) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Threads are easier to find: the chat sidebar and the Android drawer list the Code threads that need you or are still working, each with the bot or project chat that started it, and **All threads** opens Code. In Code, a plain finished thread no longer says "finished" beside its title, and on a phone the project chat's menu button goes back to the thread list.

- [#562](https://github.com/AshikNesin/tiny-agents/pull/562) [`b5fade6`](https://github.com/AshikNesin/tiny-agents/commit/b5fade620f0ca389f6a712952f97f846d247235c) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Tool permissions can now be set once for every bot in **Settings > Tools**, and a bot's own choice still wins for that bot. An approval card has a new **Allow for every bot** button next to **Always allow**.

- [#518](https://github.com/AshikNesin/tiny-agents/pull/518) [`30aad6b`](https://github.com/AshikNesin/tiny-agents/commit/30aad6bbef8959068b3ebf65d777491ca8d9254a) Thanks [@AshikNesin](https://github.com/AshikNesin)! - The 1Password vault backend now talks to 1Password through service accounts, with 1Password's JavaScript SDK, instead of 1Password Connect. The bundled Connect server is gone, and so are the `OP_CONNECT_*` variables and the Vault card's **Starting** state. To keep using 1Password, create two service accounts limited to one dedicated vault, one read-only and one read and write, set `OP_SERVICE_ACCOUNT_TOKEN` and `OP_SERVICE_ACCOUNT_ADMIN_TOKEN` (and `OP_VAULT_ID` if you pinned one), remove the old `OP_CONNECT_*` variables and redeploy. Items already linked to 1Password keep working: migration 0039 renames their backend from `onepassword-connect` to `onepassword`. There is no local copy of the vault any more, so vault uses fail closed while 1Password is unreachable. See ADR 0045.

### Patch Changes

- [`aa491b1`](https://github.com/AshikNesin/tiny-agents/commit/aa491b10e52ac4c00abafe8a55b5f83548ff606a) Thanks [@ampagent](https://github.com/ampagent)! - Submitting a bot's credential request with **Save to the vault** on now needs the vault step-up token, because the save path can overwrite the login that is already stored for that site (the same re-confirmation every other vault write asks for). Filling the page without saving is unchanged, and both web and Android clients ask for the password confirmation in the dialog before the request goes out.
  
  The Claude Code engine now enforces the same 150-tool-calls-per-reply cap as the pi engine, so a looping session is refused and stopped instead of running host-side tools forever.
  
  The loopback CDP forwarder that exposes the sandbox browser's DevTools port requires a per-session token header (`x-cdp-token`) generated with Web Crypto at forwarder start: a client without the token gets `403` and its socket closed, so another local process can no longer take over the browser session. The token is known only to the transport that started the forwarder and is passed to its own Playwright connection.

- [`e511da5`](https://github.com/AshikNesin/tiny-agents/commit/e511da53df9f14db7849c0cdf861c34e2689baac) Thanks [@ampagent](https://github.com/ampagent)! - Tightened five check-then-act races and added input caps on the job admin API. Two concurrent creates of the same task idempotency key or skill name now return the existing row or a clean 409 instead of a raw SqliteError 500; a passkey rename that loses a race with its delete says 404 instead of crashing; registering the same credential twice concurrently says 409; and a kv entry refreshed while a stale read was expiring it survives. Singleton jobs are now enforced by a partial unique index on (name, singleton_key) for created and active states, so two concurrent enqueues of one singleton key create one job. Job options are capped (100 bulk-rerun ids, retryLimit ≤ 100, priority and delays bounded) and job log responses are limited to 500 rows.

- [`54143fb`](https://github.com/AshikNesin/tiny-agents/commit/54143fbd55708fab2684c0f8041189b3e29307df) Thanks [@ampagent](https://github.com/ampagent)! - Four audit fixes in the self-update channel, the legacy database migration, Shelley transcripts and the Claude turn queue.
  
  The self-update channel now notices when the `pnpm local` supervisor goes away: the supervisor status is cleared, and check/apply answer the same 409 as an unsupervised server instead of a silent no-op 202 while the owner's update button appears to work.
  
  The one-time Prisma-to-Drizzle migration is crash-safe. A crash between the renames used to leave no `app.db` at all, so the next boot silently created an empty database. The new database is now flushed to disk before the swap, and the next boot detects a half-done swap and either completes it or restores the pre-migration database before anything opens it.
  
  A Shelley screenshot URL with a malformed percent escape (a file named `shot%zz.png`) no longer fails the whole transcript build for that conversation; the image degrades to its raw path. Image asset refs whose ids grow past four digits keep loading, matching what the producer mints in long conversations.
  
  A turn whose Claude process failed to start is failed with that error instead of staying in the session's queue and being replayed to the next process, which could re-run the turn's actions a second time.

- [#581](https://github.com/AshikNesin/tiny-agents/pull/581) [`e874110`](https://github.com/AshikNesin/tiny-agents/commit/e8741106e6aebff234095f90e704adf4cf3314a9) Thanks [@AshikNesin](https://github.com/AshikNesin)! - `@groot/ui` is built on Base UI instead of Radix. Components that took `asChild` now take `render` (an element or a function); run `scripts/codemods/as-child-to-render.ts` to rewrite call sites. Menus, dialogs, select, tabs, tooltips and checkboxes style off Base UI's `data-open`, `data-checked` and `data-active` attributes. New exports: `collapsible`, `item`, `search-select`, `switch`, `toggle-group`, `fluid/ask-user-questions` and `fluid/thinking-indicator`.

- [`b6fec6c`](https://github.com/AshikNesin/tiny-agents/commit/b6fec6cc131be4c3ce36ed47969c38012f6a321f) - Chat messages rendered inline Markdown links as raw text on Android when the target was a relative path such as `/code/t/<id>`. The renderer now links any `[text](target)`, and tapping a same-server path opens the matching screen in the app (web navigates client-side too) instead of a full page load.

- [#590](https://github.com/AshikNesin/tiny-agents/pull/590) [`e72f7be`](https://github.com/AshikNesin/tiny-agents/commit/e72f7be13b31971f1756088c432a9e86888b1b57) Thanks [@AshikNesin](https://github.com/AshikNesin)! - The sandbox browser no longer offers Chrome's "Save password?" prompt. A Chrome policy (`PasswordManagerEnabled: false`) is installed on VMs and in the local sandbox image, so sign-ins stay in the vault. Existing VMs pick it up on the next browser start, which reruns the browser stack install.

- [#568](https://github.com/AshikNesin/tiny-agents/pull/568) [`ed2fd2f`](https://github.com/AshikNesin/tiny-agents/commit/ed2fd2f9cd15523e5cfd53023b791f2ab4c47de7) Thanks [@AshikNesin](https://github.com/AshikNesin)! - A Code thread whose pull request is closed without merging is now archived and its worktree removed, like a merged one, when the project's archive setting is on. A worktree with uncommitted changes is kept. Unarchive brings the worktree back from the branch.

- [#593](https://github.com/AshikNesin/tiny-agents/pull/593) [`02963dd`](https://github.com/AshikNesin/tiny-agents/commit/02963ddbc260c1b1549ecf37f8c8d3534c330310) Thanks [@AshikNesin](https://github.com/AshikNesin)! - A Code thread archived because its pull request merged or closed is now marked archived, so it leaves the threads list like one archived by hand. Archiving from the thread menu, the project chat, a closed pull request and a finished review all run the same steps.

- [#523](https://github.com/AshikNesin/tiny-agents/pull/523) [`625fc6a`](https://github.com/AshikNesin/tiny-agents/commit/625fc6a35e2ea9ddf9825408ae1e533c513ffc02) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code: the Files tab has an Open in editor button at its top, and the Code sidebar's foot shows only Settings (the `?` and `:` keys still work).

- [#572](https://github.com/AshikNesin/tiny-agents/pull/572) [`2c8ee53`](https://github.com/AshikNesin/tiny-agents/commit/2c8ee5332dec38bd6bf728bc67415e3bf7af5e6b) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Starting a Code thread works like starting a chat: with no thread open, the page is the new thread box, with the project, agent, model and permission as chips under it. The New thread dialog is gone, and `n` focuses the box.

- [#520](https://github.com/AshikNesin/tiny-agents/pull/520) [`d6ce90a`](https://github.com/AshikNesin/tiny-agents/commit/d6ce90ad582b467a3fd720b72b6e0d717569b7e3) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code: Open in editor reaches the local Docker sandbox again. The `~/.ssh/config` entry it suggests now uses `127.0.0.1` instead of `localhost`, which macOS resolves to `::1` first, where the sandbox's port isn't published. Hosts for a sandbox VM or a remote Shelley now carry the `exedev` user, so the editor no longer signs in as your own Mac user.

- [#529](https://github.com/AshikNesin/tiny-agents/pull/529) [`f60de39`](https://github.com/AshikNesin/tiny-agents/commit/f60de39ebcf568edacfa9466cdd70cb218721495) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code on phones: touch devices no longer show keyboard hints, the work pane's tabs fit on one line beside the close button, and a long branch name above a thread's first message ends in an ellipsis instead of running off the left edge.

- [#561](https://github.com/AshikNesin/tiny-agents/pull/561) [`8ba8f9c`](https://github.com/AshikNesin/tiny-agents/commit/8ba8f9cc017cf567af056984f00c0109d2113e13) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code: a push GitHub refuses now says why. A missing `workflow` scope names the scope and the `gh auth refresh -h github.com -s workflow` fix, and any other server-side refusal (a protected branch, a hook) shows GitHub's own reason, instead of always claiming the branch moved on GitHub. A new thread's branch name now also skips names already on GitHub that the checkout has not fetched yet.

- [#571](https://github.com/AshikNesin/tiny-agents/pull/571) [`e96203e`](https://github.com/AshikNesin/tiny-agents/commit/e96203e9d721a8704b17224b744747150592701b) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code's settings (Projects, GitHub and Reviews) are now sections of the app's one Settings page, instead of a separate Code settings page with its own tabs. Old Code settings links open the same section.

- [`493c8d9`](https://github.com/AshikNesin/tiny-agents/commit/493c8d9ea684c2f46bc1ab18ee28be7d7648fad3) Thanks [@ampagent](https://github.com/ampagent)! - Guests stay inside the bots they are shared with when a message names other bots. An @mention from a guest now reaches only the bots that guest can open; the others are dropped without an error, and the mentioned bot reads who actually wrote it (`[From Priya, in Host's chat]`) instead of being told the words are the owner's. A bot whose chat is shared with guests can no longer message, through `message_bot`, a bot those guests cannot see: the send is refused with the reason `shared`, and the roster it is offered lists only the bots every guest of that chat can open. The owner's own chats are unchanged.

- [`493c8d9`](https://github.com/AshikNesin/tiny-agents/commit/493c8d9ea684c2f46bc1ab18ee28be7d7648fad3) Thanks [@ampagent](https://github.com/ampagent)! - MCP connections ask before every tool by default. A server's own `readOnlyHint` and `idempotentHint` annotations no longer let a tool run without the owner's approval or mark it safe to replay; the hints still show on a connection's tool pages, and an owner who wants a tool to run unattended allows it by name as before. Two tools whose names differ only in characters the tool name can't carry, or beyond its 64 characters, no longer share one permission. A server whose tool list never ends is read for at most 50 pages and 500 tools. A conversation whose permissions record is missing asks for every tool instead of running them.

- [`e511da5`](https://github.com/AshikNesin/tiny-agents/commit/e511da53df9f14db7849c0cdf861c34e2689baac) Thanks [@ampagent](https://github.com/ampagent)! - Memory capture no longer loses the oldest owner turns when a conversation backlog exceeds the 24,000-character window: the window now starts at the watermark and the watermark only advances past what was actually captured, so skipped messages are picked up by the next run.
  
  The weekly memory tidy aborts without changing anything if a memory was edited during its model call, instead of overwriting the owner's edit with text derived from the stale snapshot.
  
  Two concurrent `update_instructions` calls can no longer lose an append: the prompt revision and the new prompt are written in one transaction guarded by a conditional update, retried when another writer got there first.
  
  A resumed `update_instructions` call now reports it was interrupted instead of appending the same lines a second time (its replay policy is `unsafe`, like other side-effecting tools).
  
  `list_tasks` now returns only open tasks (`todo` and `in_progress`) when no status filter is passed, matching its description; pass `status: "done"` to see completed tasks.
  
  A detached `run_command` under the egress allowlist keeps running past the call: it is started as its own transient systemd unit (egress-restricted, no runtime cap) instead of being killed with the wrapper the moment the call returns. Detached commands never accept secrets, as before.
  
  tmux session geometry is validated as integers within the documented ranges before it is interpolated into the shell command, so no caller can smuggle a payload through cols or rows.
  
  `search_attachment` with `regex: true` refuses patterns whose alternation under a quantifier is ambiguous (for example `(a|a)*`, `(a|aa)+$`, `((a|a)*)*b`), the classic catastrophic-backtracking shapes the nested-quantifier check missed. Benign alternations like `^(a|b)c$` still work.

- [#609](https://github.com/AshikNesin/tiny-agents/pull/609) [`2d7881f`](https://github.com/AshikNesin/tiny-agents/commit/2d7881f590788f28bd6b3b68aea389e716ae98e4) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Memories name you instead of saying "the owner": capture and the weekly tidy use your account name, and existing "the owner" memories are rewritten on the next capture.

- [`e88ecdd`](https://github.com/AshikNesin/tiny-agents/commit/e88ecdd64efc79d8f82b504332b61c3cffd29aa6) Thanks [@ampagent](https://github.com/ampagent)! - Model endpoint probes need step-up, and the private-network ban now holds on the model-call transport. `POST /models/discover` and `POST /models/test` take the same connection payload as the routes that save it, so a stolen session could probe internal hosts with a caller-chosen `allowPrivateNetwork`; both now require the vault's step-up like their siblings, and the settings dialogs prompt for it. A model call no longer trusts the one-shot DNS check made before it: the transport follows redirects itself, resolving each hop against the private-address ban, so an endpoint that redirects to `169.254.169.254` (or a DNS-rebinding host) is refused unless the account allows a private endpoint.
  
  MCP OAuth callbacks are single-use, short-lived and bound to the owner who started them. The `state` parameter now carries the issuing user and a timestamp inside the sealed blob, is cleared after any completion attempt (success or failure), expires after ten minutes, and the public callback is rate-limited; a callback carrying a session that isn't the one that started the sign-in is refused.

- [#570](https://github.com/AshikNesin/tiny-agents/pull/570) [`8c21955`](https://github.com/AshikNesin/tiny-agents/commit/8c2195539e3048118fb781caa4c785aed67f7ab4) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code's `:` key now opens the same command palette as ⌘K, instead of a separate Code-only menu. One menu runs every command and jumps to threads, bots and pages.

- [`e511da5`](https://github.com/AshikNesin/tiny-agents/commit/e511da53df9f14db7849c0cdf861c34e2689baac) Thanks [@ampagent](https://github.com/ampagent)! - Passwords hash with PBKDF2 at 600,000 iterations (OWASP's current floor) instead of 100,000. Existing hashes stay valid, and the next successful password login re-hashes the account at the new count, the same path bcrypt hashes already took.
  
  An admin-key check that fails now counts against a per-IP limit (10 failed keys per 15 minutes by default, `config.rateLimits.adminKey`), so the header can't be brute-forced online; correct keys are never counted.
  
  SECRETS_KEY must hold at least 32 bytes of key material (counted after base64 or hex decoding) before it seals anything; a weaker key gets a clear error naming the variable instead of silently encrypting with low entropy. Reading is unchanged: values sealed before the floor still open, so an operator can tighten the key with `pnpm secrets:rotate` without losing data.

- [#607](https://github.com/AshikNesin/tiny-agents/pull/607) [`2b7c762`](https://github.com/AshikNesin/tiny-agents/commit/2b7c762ea034d84f80828877cdf661f83ca94278) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Projects in the chat sidebar show their bot's avatar, the same one the project chat shows, instead of an initials badge.

- [#606](https://github.com/AshikNesin/tiny-agents/pull/606) [`53bb7a1`](https://github.com/AshikNesin/tiny-agents/commit/53bb7a1f156a83567d9a1174f12be90e8d0cbf4f) Thanks [@AshikNesin](https://github.com/AshikNesin)! - A project in the sidebar's Projects section now opens its chat inside Chat, with the threads and context panel beside it, instead of jumping to Code.

- [#569](https://github.com/AshikNesin/tiny-agents/pull/569) [`ad81ace`](https://github.com/AshikNesin/tiny-agents/commit/ad81acedc355566dff1cd1743580eac35eaff681) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Project chats no longer show up in the Chat sidebar as extra bots named after a repository. They live in Code, and an old chat link to one opens it there.

- [#601](https://github.com/AshikNesin/tiny-agents/pull/601) [`43225b2`](https://github.com/AshikNesin/tiny-agents/commit/43225b29260beaef529cd2384ccf40cea8000223) Thanks [@AshikNesin](https://github.com/AshikNesin)! - A project's default model now goes only to the project's own agent. Starting a thread, a bot hand-off or a review assistant on another agent uses that agent's default model instead of an id it does not know.

- [#574](https://github.com/AshikNesin/tiny-agents/pull/574) [`ad9f62c`](https://github.com/AshikNesin/tiny-agents/commit/ad9f62c25da7081aa818e94fd1c2a15258711bb4) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Fixes for the chat and Code simplifications: a project chat's past chats open again, a guest the owner shared a project chat with still finds it in Chat, `:` finds every Code thread rather than the newest 30, a Code settings link no longer jumps to Account before Code has loaded, and an unsent new-thread task survives a look at another thread.

- [`e511da5`](https://github.com/AshikNesin/tiny-agents/commit/e511da53df9f14db7849c0cdf861c34e2689baac) Thanks [@ampagent](https://github.com/ampagent)! - Vault credentials stay off plaintext http. `http_request` with a vault handle refuses an `http://` URL up front, and a redirect from `https` to `http` on the same host fails before the credential is sent, instead of leaking it to anyone listening on the wire. Plain `http_request` calls without a vault item are unchanged.
  
  A vault approval card now shows the whole command `run_command` can run (up to 20,000 characters, matching the tool's limit) instead of a 2,000-character prefix, so the owner approves what actually runs.
  
  A guest who answers a bot's `ask_owner` questions is named in the answer the model reads ("Priya (guest) answered your questions"), instead of being presented as the owner's own decision.
  
  A vault value filled into a page is no longer handed to frames whose origin the item does not allow: the fill used to serialize the secret into every frame before checking the allowlist, so a cross-origin iframe could read it. It now reaches only the page's own origin and the origins the item names.

- [#592](https://github.com/AshikNesin/tiny-agents/pull/592) [`6b32905`](https://github.com/AshikNesin/tiny-agents/commit/6b329054a3a1722d50996a270dd5cce7937d9b76) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Which connections and skills a bot or Code thread reaches is decided in one place. A shared skill whose stored files cannot be read no longer stops Claude Code threads from starting.

- [#556](https://github.com/AshikNesin/tiny-agents/pull/556) [`4dfafbd`](https://github.com/AshikNesin/tiny-agents/commit/4dfafbd86ea9324f982aa522e233716630281675) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Server-sent event streams now cap the bytes buffered for a client that stopped reading. When a stream consumer stalls — a suspended tab, a dead proxy, a network drop — writes used to keep enqueueing frames into the response body with no bound, so one stalled client could grow server memory without limit. Each stream now drops the stalled consumer after 2 MB of backlog instead; the web client's existing reconnect logic re-establishes the stream, and healthy fast-reading clients are unaffected.

- [#573](https://github.com/AshikNesin/tiny-agents/pull/573) [`4dedc4d`](https://github.com/AshikNesin/tiny-agents/commit/4dedc4dd7c379588b615675443344bdff51d2091) Thanks [@AshikNesin](https://github.com/AshikNesin)! - YOLO is now a chip beside the model in the chat composer, instead of a row in the bot menu plus a banner. Code's permission chip uses the same word for its never-ask mode (it was called Bypass), so both composers say YOLO for "don't ask".

## 1.6.0

### Minor Changes

- [#491](https://github.com/AshikNesin/tiny-agents/pull/491) [`2cfe9ce`](https://github.com/AshikNesin/tiny-agents/commit/2cfe9cea9d1ec59222b9213a50fcf3f386934444) Thanks [@AshikNesin](https://github.com/AshikNesin)! - A Chat / Code switch sits at the top of the sidebar, and each side returns to the page it was last on. Search is now a row in the chat sidebar. The Code sidebar shares the app sidebar's look and top row: New thread, Search, Threads and Reviews, the threads under a Projects heading with its options menu, and Settings at the foot. A new thread opens with a larger heading and its project and folder pickers under the composer.

- [#484](https://github.com/AshikNesin/tiny-agents/pull/484) [`3d1ef2a`](https://github.com/AshikNesin/tiny-agents/commit/3d1ef2ab9328b48c7b60ac2c5019a53c586fda64) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Type /new in a bot chat's composer and send it to start a new chat, the same as the New chat button. Anything more than /new on its own is sent as a normal message.

### Patch Changes

- [#489](https://github.com/AshikNesin/tiny-agents/pull/489) [`c341801`](https://github.com/AshikNesin/tiny-agents/commit/c341801dc6a04579e30cec364f8b608e6552c507) Thanks [@AshikNesin](https://github.com/AshikNesin)! - The sandbox browser sends all of its traffic through a proxy that resolves each name once, refuses private and local answers, and connects to the address it checked, so DNS rebinding can't reach a private host. It runs in the server for the local browser and next to Chrome on the sandbox VM, and covers a page's own requests too. In the live view, a private or tailnet address now opens only when it is in `BROWSER_ALLOWED_PRIVATE_HOSTS`.

- [#478](https://github.com/AshikNesin/tiny-agents/pull/478) [`2870261`](https://github.com/AshikNesin/tiny-agents/commit/2870261fd61ba1910258bc72144a0aa24f8155c1) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Drops leftovers of finished migrations: the `shelley_seen` and `shelley_handoffs` tables and their copy at boot (copied into the Code tables on every boot since ADR 0011), the unused `memories.confidence` column, the old `tiny-agents:shelley-*` composer settings, and the text-and-clock match that let a chat message without a request id confirm a just-sent message.

- [#480](https://github.com/AshikNesin/tiny-agents/pull/480) [`feab2c2`](https://github.com/AshikNesin/tiny-agents/commit/feab2c2102bcc0022e5ff24cbcb6bd09f43bc6c7) Thanks [@AshikNesin](https://github.com/AshikNesin)! - The local browser's navigation guard refuses a name whose DNS lookup fails or times out, instead of leaving it to the browser, so a name that can't be checked can't reach a private address. An exempt name still goes through.

- [#480](https://github.com/AshikNesin/tiny-agents/pull/480) [`feab2c2`](https://github.com/AshikNesin/tiny-agents/commit/feab2c2102bcc0022e5ff24cbcb6bd09f43bc6c7) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Notification settings no longer keep a stale copy when they are reloaded while an older read is still in flight.

- [#488](https://github.com/AshikNesin/tiny-agents/pull/488) [`e041808`](https://github.com/AshikNesin/tiny-agents/commit/e041808c22c965d9fd8c0a0a12ff56079168a1c3) Thanks [@AshikNesin](https://github.com/AshikNesin)! - A tool call waiting on you (an approval card, questions, a sign-in or code sheet) now parks instead of holding a process wait: your answer wakes it through a durable signal, and an expiring card wakes at its deadline. After a restart the waiting counts, badges and pushes are right at once, without re-running the waiting calls.

- [#483](https://github.com/AshikNesin/tiny-agents/pull/483) [`20f32d8`](https://github.com/AshikNesin/tiny-agents/commit/20f32d8bc1f3b1c3f4cf6fd4899ce6f9092b2cc8) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Runs on pi-durable, pi-ai and chord 1.6.0. Chat streams render from the conversation view instead of the removed event stream, and a reply that a crash or the restart limit cut off says so in words.

- [#492](https://github.com/AshikNesin/tiny-agents/pull/492) [`266441a`](https://github.com/AshikNesin/tiny-agents/commit/266441a896f9356a558917db3454209c8f38f615) Thanks [@AshikNesin](https://github.com/AshikNesin)! - The sidebar's collapse button moves out of the top row to the foot of the sidebar, beside your account (or Settings in Code), and shows only while the pointer is over the sidebar. ⌘B now folds the chat sidebar to its rail too, as it already did in Code.

- [#478](https://github.com/AshikNesin/tiny-agents/pull/478) [`2870261`](https://github.com/AshikNesin/tiny-agents/commit/2870261fd61ba1910258bc72144a0aa24f8155c1) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Client and server now share one copy of the rules they used to mirror: the question answer limit and the skip-reply marker (`@tiny-agents/agent/wire`), the routine schedule math (`apps/web/src/shared/routines-schedule.ts`) and the login and setup form schemas. Storage folders report `lastModified: null` instead of a 1970 date. `Layout` takes `chrome={false}` to drop its sidebar and mobile bar, and `Form` and `FormField` type their resolver and bound input without casts.

- [#493](https://github.com/AshikNesin/tiny-agents/pull/493) [`cc8583a`](https://github.com/AshikNesin/tiny-agents/commit/cc8583acb071d87dd556ddc882810894d5324795) Thanks [@AshikNesin](https://github.com/AshikNesin)! - The sidebar has no collapse, expand, hide or show buttons any more. Fold it with ⌘B or **Toggle sidebar** in the command palette, in chat and in Code. The sidebar Search row no longer shows the ⌘K hint.

- [#478](https://github.com/AshikNesin/tiny-agents/pull/478) [`2870261`](https://github.com/AshikNesin/tiny-agents/commit/2870261fd61ba1910258bc72144a0aa24f8155c1) Thanks [@AshikNesin](https://github.com/AshikNesin)! - The live browser and computer routes look the target up before reading the body, so a request bad on both counts is always 404. Upload extraction no longer reads `VITEST`: the runner is a port (`setExtractRunner`) the server test setup sets to in-process. `scripts/` is under the server typecheck and the typecheck coverage guard. The test SSH server types its SFTP stream with ssh2's `SFTPWrapper`, and now sends real SFTP attributes and REALPATH names. The agent's browser-safe `wire` subpath has a path alias like `peer-envelope`'s.

- [#487](https://github.com/AshikNesin/tiny-agents/pull/487) [`2fda929`](https://github.com/AshikNesin/tiny-agents/commit/2fda929cd453e451ceed0acbc3eab6d2461207f9) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Updating a vault item's policy with only some fields (such as just `disabled`) keeps the rest of its policy instead of resetting its sites, hosts, tools, bots and approval to defaults.

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
