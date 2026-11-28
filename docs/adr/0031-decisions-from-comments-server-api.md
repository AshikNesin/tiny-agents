# 0031 — Decisions recorded from code comments: server API

- Status: accepted
- Date: 2026-11-20

## Context

The comment sweep under [ADR 0028](0028-code-carries-no-comments.md) removed
every comment from `apps/web/src/server/api/`. Most said what the code
already says. The decisions below could not be read back from the code, its
tests or an earlier ADR, so they are kept here. Decisions an earlier ADR
already holds (every bot has every toolkit, 0004; the vault's policy digest,
0019; Code projects, GitHub, Auto-fix and steady diffs, 0021 to 0025; the
bundled Connect server, 0027) are not repeated.

## Bot resources are released twice-safe, after a capture

`apps/web/src/server/api/bots/bot-resources.ts`, `BOT_RESOURCES`. Each entry's
`capture` runs before the bot row is deleted, because the cascade erases what
it reads. Its `release` must be safe to run twice: one cut off by a crash or
a sandbox outage runs again at the next boot (`sweepBotReleases`). What a
capture read is stored as JSON and parsed again when the release runs, maybe
by a later build, so a record that no longer parses is dropped rather than
retried forever.

## Every delivery path reconciles the conversation first

`apps/web/src/server/api/bots/bots.conversation.ts`. The `bots` row is the
source of truth for persona, model, tool permissions and links, and a durable
conversation runs with the config of its last configure. Every path that puts
a message in front of a bot (an owner send, a mention, a relayed reply, a bot
message, a routine fire) reconciles first, through this module, or a model
that gained vision, an edited toolkit or a new connection silently strands
the old selection. Callers name the bot and what to deliver, never the
config.

## Unattended work runs in a fresh conversation of its own

`apps/web/src/server/api/bots/bots.delivery.ts` and
`apps/web/src/server/api/routines/routines.jobs.ts`. A bot-to-bot message and
each routine run start a fresh durable conversation of the target bot's own,
unattended and on a routine run's token budget. Answering one never re-sends
the target's whole chat history, a run's cost never grows with the routine's
history, and a routine that messages a bot cannot escape its own budget that
way. An owner's @mention still lands in the target's chat. The fresh
conversation is stored on the ledger or run row before the submit, so a
retried delivery or fire reuses it and the request id dedupes the submit.

A routine occurrence that fires while an earlier run still works is recorded
missed, not queued behind it (`routines.runs.ts`), so runs never pile up and
each one's spend stays its own. A failed submit fails the run once and pauses
the routine instead of retrying in a loop.

## Who owns a conversation is asked in one place

`apps/web/src/server/api/bots/bots.owner.ts`. Tool calls know their
conversation, not their bot, so every lookup from a conversation to its bot
goes through this module. Three kinds of query still name
`bots.conversationId` directly, on purpose: writes that must land only while
the conversation is still the bot's chat (`recordReply` in `bots.list.ts`,
where the column is the guard), `followsConversation` in `people/access.ts`
(the events filter needs it synchronous), and set-based joins over many rows
with their `coalesce` for legacy rows. A turn whose owner cannot be read
counts as unattended, which only ever refuses more.

## Owner-only writes refuse every turn the owner did not start

`memories/memories.store.ts`, `bots/self-improve.store.ts`,
`bots/bot-builder.store.ts`, `bots/chats.service.ts`. Memory writes, prompt
changes and new bots happen only in the owner's own turn in a chat no guest
shares, even when the tool is set to Always allow, because a planted memory
or prompt line reaches every later prompt. "Always allow" switches on the
tool of the call being approved, never the name the request carries, and
never a vault use. A prompt change writes its `prompt_revisions` row before
the bot row, so a crash between the two leaves an extra revision, never a
missing one. A bot saving a skill never overwrites one it was not assigned:
the owner assigns it instead.

## Bot names compare in JavaScript

`apps/web/src/server/api/bots/bots.service.ts`. Names are unique after trim,
case-insensitively, because a mention, `message_bot` and the pickers tell
bots apart by name. The check runs in JavaScript, not SQL: SQLite has no
case-insensitive mode for the comparison and the roster is small. It runs
before the durable conversation is opened, so a refused name leaves nothing
behind. Turning memory back on starts capture from that moment: what was said
while it was off is never remembered.

## Memory capture keeps its window moving and its prompt cheap

`memories/memories.runner.ts`, `memories/memories.ledger.ts`, `memories/memories.store.ts`,
`memories/memories.schema.ts`. A window with too little owner text still advances
the watermark, so chatter never piles into a later window it no longer
relates to; a capture capped to its newest characters still ends at the
window's end, so an oversized history is never retried forever. The capture
prompt names memories by short refs (`m1`, `m2`) mapped back to rows, not by
row ids, which cost tokens on every line and invite a misspelled supersede.
The injected block orders memories by fixed category, then creation time, so
it is byte-stable for the provider's prompt cache. Query flags parse with
`stringbool`, not `coerce.boolean()`, which reads the string "false" as true.

## Side-calls and their traces carry no content

`bots/side-call.ts`, `traces/traces.calls.ts`. A one-shot model call outside a
conversation sends its prompt through the secret redactor first, so a vault
value that reached a transcript never travels to a side model. Its deadline
returns to the caller even when the provider ignores the abort. Each call
leaves one `llm_calls` row of metadata (model, tokens, cost, duration,
outcome), never the prompt or the answer; writing a row prunes old ones, and
a failed write is dropped so tracing never fails the call.

## The browser tells sites the owner's language and time zone

`apps/web/src/server/api/bots/browser.sessions.ts`. Bot checks such as
Amazon's compare the browser's language and clock with where the IP is: a
UTC clock and en-US from a home IP in India reads as automation. The browser
takes the owner's defaults, and a value Chrome would not accept falls back.

## Live desktops and terminals are relayed, never read

`live/desktop.vnc.ts`, `live/rfb-view-only.ts`, `terminal/terminal.ws.ts`,
`ws/upgrade.ts`. VNC and pty bytes are relayed untouched and never logged:
they hold everything the owner types during a takeover. A guest's viewer runs
behind a filter that forwards only the RFB messages that ask for pictures and
fails closed on any message it cannot frame. Upgrade tickets are opaque random
strings, never JWTs, because the session secret would also verify a JWT as a
login token. A refused ticket mint answers 429, never 409, because the
clients read 409 as "target gone, stop forever".

The terminal's close codes are a contract with the client's reconnect logic:
1000 stops for good (a detach, a dead or missing session), 4000 is the idle
close the client reconnects from when the user returns, 1011 a failed attach
it retries with backoff. The ticket route makes no `has-session` check first:
it cost a full SSH round trip before the socket could open, and attaching to
a missing tab already ends with tmux's reason and a 1000 close.

## Sandbox settings fail soft

`apps/web/src/server/api/sandbox/sandbox-host.ts`. A `SANDBOX_SSH_KEY_FILE` that
cannot be read is logged once, not thrown: a bad path must not take the whole
runtime down, and the sandbox tools then fail their SSH auth until it is
fixed. Production keeps the verified MagicDNS name as the default host, so an
empty value there still reaches the VM; elsewhere empty means no sandbox.

## The Claude worker's dev bundler stays out of production

`apps/web/src/server/api/sandbox/claude-worker.ts`. The dev path imports esbuild
through a variable specifier so the production bundle, which never takes that
path, does not pull in a dev dependency. Do not turn it into a literal
import.

## Code hand-offs and suggestions

`code/code.bots.ts`, `code/code.next-prompt.ts`. A hand-off's row is claimed
for its idempotency key before the harness makes the thread, and a claim left
`starting` by a run that died is never repeated: the harness may have made
the thread already. The next-prompt suggestion has a hard token budget: at
most one small `chat_title` call per finished turn, only when a browser asks,
with only that turn as context, and the answer is kept by thread and newest
row, in flight too, so a second tab never calls again.

## Public OAuth routes are authorized by what the flow carries

`connections/connections.routes.ts`, `code/code.github.ts`. The OAuth
redirect and the GitHub App setup callbacks are public: the session cookie is
SameSite=Strict in production, so a cross-site navigation does not carry it.
A connection's callback is authorized by its `state`, which matches only a
pending sign-in the owner started. The App manifest flow is bound twice, by a
`state` GitHub echoes and by a random binding in an httpOnly cookie of the
browser that started it, both stored hashed, taken once and expired in ten
minutes.

## Where a secret goes needs a fresh step-up

`connections/connections.routes.ts`, `connections/connections.service.ts`,
`models/models.routes.ts`, `vault/vault.stepup.ts`. Adding a
connection or a model account, deleting one, and changing where it points
need a fresh step-up token: a stolen session that could re-point a stored
secret at its own host would receive it, or every prompt. Replacing a key
or header value on the same host, probing an unsaved endpoint (discover,
test) and setting a GitHub token send no stored value anywhere new, so they
do not (owner's call, issue 623). Enabling models and assigning roles choose
among accounts that already passed step-up, so they do not either.
The step-up token travels in a custom header, which a cross-site form cannot
set, so it is also the routes' CSRF guard. A connection moved to a new host
loses the old host's header value, its own item deleted and a reference
dropped, unless the same change supplies one for the new host; an app
credential never goes to an MCP server. The password check accepts the
bcrypt hashes of accounts made before groot 3.0 as well as PBKDF2.

## Connection lifecycle races

`connections/connections.manager.ts`, `connections/connections.service.ts`,
`connections/oauth.ts`. A connection with no OAuth tokens yet connects
without the auth provider, so a 401 surfaces as `needs_auth` instead of
racing the sign-in's state and verifier. A delete removes the row and its bot
links before telling the manager, so a racing connect finds nothing and the
reconcile sees the links gone. Every change to the stored OAuth state is one
synchronous read-change-write transaction, so a token refresh and a new
sign-in never drop each other's write. A state that can no longer be opened
counts as none, so signing in again replaces it.

## Outbound requests are checked after DNS

`models/models.fetch.ts`, `notifications/push.store.ts`. A provider account's
discovery and Test, and a push endpoint, take https only (http only for an
account that opted in to a private endpoint), no credentials in the URL, and
no redirects. The address is checked when the socket connects, after DNS, so
a public name that resolves to a private address is refused.

## Push keys and notification text

`notifications/push.vapid.ts`, `notifications/notifications.events.ts`. A
VAPID key that can no longer be opened (`SECRETS_KEY` changed) is replaced
and every device revoked, because their endpoints were bound to the old key;
the app registers again when it sees a new one. Notification templates are
the only place a notification's text is built: names come from the app,
model or error text goes through `scrubText`, and tool arguments and outputs
never appear. The Code event's preference key predates the harness layer and
keeps its old name so saved preferences still apply.

## Guests: one write makes a guest, shares are read live

`people/people.service.ts`, `people/access.ts`, `people/live-access.ts`. An
account without a `guests` row is the owner, so a guest's account and row are
written in one transaction. Shares are read at each check, never copied into
the request's viewer, because an events stream outlives the request that
opened it. A live connection re-checks its grant synchronously when it
registers, so a revocation that lands between the guard and the registration
is still seen.

## Routines run on one clock

`apps/web/src/server/api/routines/routines.schedule.ts`. Schedules compute and
render in IST only: one owner, one time zone, no daylight saving. A schedule
edit carries the routine's `enabled` with it, so it never silently re-enables
a paused routine (`routines.service.ts`).

## Uploads are read, never run

`apps/web/src/server/api/uploads/`. Archives are listed, never extracted;
office files inflate only their text parts, formulas keep cached values and
macros are ignored; the XML tokenizer never resolves a DTD or external
entity. Content is served inline only for bytes sniffed as an image, always
with `nosniff`, so a stored HTML file never renders in the app. The stored
image variant's type comes from its bytes, because local storage types an
object by its key's extension and the variant's key has none.

Three runtime constraints shape the extraction worker. Image bytes go to a
worker as a fresh `Uint8Array`, because a pooled Node `Buffer` can fail the
structured clone. pdf.js gets a copy of its input, because it may detach the
buffer. In dev the worker registers tsx itself, because loader hooks do not
carry into threads, and `uploads.text.ts` stays apart from `uploads.sniff.ts`
so the worker's bundle never pulls in image preparation. The XML walker makes
a fresh regex per walk, because readers nest walks and a shared one would
share its position.

## Vault use rules beyond the policy digest

`vault/vault.service.ts`, `vault/vault.admin.service.ts`,
`vault/vault.broker.ts`. A command or a desktop window always asks the owner
for a vault use: the command is code the model wrote holding the secret, and
the window is one the model named. An app credential's successful uses are
not audited and its value is cached a few minutes, because one row per model
call would bury the log; refusals and failures are still audited. An item
whose last bot is removed keeps an empty bot list, never null, which would
mean every bot. The broker passes a target's host, never its URL, which can
carry query secrets. A backend error code goes in the envelope's `code`,
never `details`, because the client shows the first string in `details` as
the message.
