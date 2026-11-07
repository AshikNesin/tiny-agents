# tiny-agents

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
