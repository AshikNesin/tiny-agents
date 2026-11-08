# tiny-agents

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
