# 0034 — Decisions recorded from code comments: packages

- Status: accepted
- Date: 2026-11-20

## Context

The comment sweep under [ADR 0028](0028-code-carries-no-comments.md) removed
the comments from `packages/core`, `packages/jobs`, `packages/shell`,
`packages/ui`, `packages/sandbox`, `packages/code`, `packages/github` and
`packages/git`. Most repeated the code. The ones below recorded a choice a
reader could not get back from the code, its tests or an existing ADR, so
they move here. Decisions already written elsewhere stay there: the sandbox
connection pool and the tailscaled rule ([ADR 0013](0013-one-sandbox-connection.md)),
the git read flags ([ADR 0025](0025-steady-code-diffs.md)), the Shelley
request header ([ADR 0009](0009-shelley-is-the-coding-agent.md)), and the
live-session and VM-stack drift tables (`docs/rewrite/README.md` §4.2).

## Concurrency without transactions (core and jobs)

Core runs on D1, which has no transactions, so every write that must not race
is one statement. `packages/core/src/kv/index.ts` implements `add`, `take`
and `claim` as single compare-and-set statements: of concurrent callers on
one key exactly one wins. Passkey challenges are consumed with `take`, and a
passkey delete removes the row only while another passkey of the same user
still exists, so two concurrent deletes never remove the last
(`packages/core/src/passkey/passkey.service.ts`). First-run setup
(`setupFirstUser` in `packages/core/src/auth/auth.service.ts`) cannot lock,
so two racing requests may both insert; whichever row is not the lowest id
deletes itself and is refused.

Job writes follow the same rule (`packages/jobs/src/server/transitions.ts`):
each event is one `UPDATE … RETURNING` guarded on the states it is allowed
from, so a racing writer is never overwritten. The failure path writes the
error log line before it changes the state, so a dashboard that sees the new
state also sees why, and only the writer that won the update reports the
error. SQLite's `RETURNING` does not keep a subquery's `ORDER BY`, so claimed
jobs are sorted by priority after the update. Due schedules are enqueued
with a compare-and-set on `lastRunAt`, and the housekeeping slot is a kv
`claim` rather than an in-memory timer, because a fresh Workers isolate
starts with empty module state and would otherwise sweep again
(`packages/jobs/src/server/tick.ts`). D1 binds at most 100 parameters per
statement, so job-log deletes run in chunks of 90
(`packages/jobs/src/server/logger.ts`). Core timestamps are integer
milliseconds so one schema runs on better-sqlite3, D1 and Durable Object
SQLite.

`scheduleJob` keeps `lastRunAt` when it replaces a schedule, so editing a
schedule does not fire a run it already made.

## kv prefix matching

`clear(prefix)` and `list(prefix)` compare the key's leading characters, not
`LIKE`, because SQLite's `LIKE` ignores ASCII case and `clear("user:")` would
also delete `User:1`.

## Credentials and timing (core)

Login against an unknown email still verifies against a well-formed dummy
hash, so response time does not reveal which emails have accounts. The admin
key check hashes both sides before comparing so the comparison is constant
time whatever the lengths (`admin-auth.middleware.ts`). Passwords use PBKDF2
at 600,000 iterations; the Workers CPU cap that kept it at 100,000 does not
apply (tiny-agents runs on Node only). Accounts created before the move
to groot 3.0 still hold bcrypt hashes: `verifyPassword` accepts them and
login re-hashes them to PBKDF2 the first time the password is used. Hashes at
an older iteration count stay valid the same way, and the next login
re-hashes them at the current count.

`parseEnv` treats an empty variable as unset, because hosting platforms set
unused variables to `""`.

## Request logging and client addresses (core)

The session guard's 401 (`SESSION_INVALID`) is logged at debug: every
signed-out page load asks `/auth/me`, so it is the normal state, not a
warning. A 4xx is logged without its stack.

`packages/core/src/utils/client-address.ts` takes the client from
`X-Forwarded-For` as the rightmost hop that is not a trusted proxy, since
every hop left of it is text the client wrote. Rate limits key an IPv6
client by its /64, because a host usually holds the whole /64 and can pick
any address in it. A trusted-proxy range with host bits set is refused, which
catches `::ffff:10.0.0.0/8` (really `::/8`) and any entry that would trust
more than it names. On Workers the client is `cf-connecting-ip`, which
Cloudflare's edge overwrites. The Cloudflare rate-limit store enforces the
limits set in the Workers deployment's wrangler config, not the rule's `windowMs` and `max`, and
answers only yes or no, so its responses carry no `RateLimit-*` headers.

## Serving stored files (core and shell)

Uploaded HTML, SVG, XML and JavaScript are never served inline, since they
would run script on the app's origin. Text without a declared charset is
served and viewed as UTF-8: browsers decode it as windows-1252 otherwise,
and a blob keeps only the MIME essence, so the client re-types text blobs
too (`packages/core/src/storage/storage.routes.ts`,
`packages/shell/src/pages/storage/hooks/useStorage.ts`). `viewFile` opens
the new tab before its first `await` so the browser ties it to the click's
user activation (a later `window.open` is popup-blocked), and revokes the
blob URL two seconds after the tab loads it.

Text ids keep the cuid shape Prisma generated for tiny-agents' existing rows
(`packages/core/src/utils/id.utils.ts`).

## Notifications (core)

Delivery is in-process: a restart drops queued sends. Needs-input
notifications are re-derived on boot, and the dedupe check also reads the
notification log, so those replays do not send twice. Only one channel
delivers at a time (`NotificationHub`); "auto" means the phone app once a
device is registered, else Pushover.

Pushover's monthly quota resets on the first of the month at 00:00 US
Central, and its answers map as its API guide asks: 429 is the quota (no
retry until it resets), other 4xx or `status != 1` is bad input or bad
credentials (never retried), and 5xx, network errors and timeouts are
transient. Web Push maps 404 and 410 to a revoked subscription, 429, 5xx
and network failures to a retried failure, and anything else to a rejected
message. A push carries a `Topic` derived from its tag so the push service
replaces an undelivered show with the dismiss that cancels it. WebCrypto
signs ECDSA as raw `r‖s`, which is what JWS ES256 wants, so no DER
conversion is needed.

Free text in a notification is dropped when the scrubber rewrote more than
20% of it, and dropped as well when a redactor throws, so a failure never
leaks the text (`packages/core/src/notification/scrub.ts`).

## Client session and data (shell and jobs)

React Query keys say nothing about the user, so the cache is reset on every
sign-in, sign-out and session-invalid 401 (`bindQueryClientToSession`).
Mutations never retry, because a repeated POST can create a duplicate. A
failed sign-in changes nothing locally, since the server kept whatever
session it had, and a `checkAuth` answer is dropped when a sign-in or
sign-out happened while it ran (`packages/shell/src/store/auth.ts`).

Client code imports server wire types only from the zod-only schema modules
(`storage.schema`, `app-settings.schema`, `passkey.schema`), type-only: the
service modules and barrels reach server middlewares and `node:async_hooks`,
which the client tsconfig has no types for.

The storage browser's selection only ever holds files of the folder on
screen, so a bulk delete can never reach a file the person cannot see. The
job detail page fetches logs after the job, so a job seen as finished has
flushed all its logs. The jobs list stores a date preset by name, never as
dates, so a shared `?datePreset=today` link means today when opened.

`packages/shell/src/index.css` points Tailwind's `source()` at the repo root,
because `@tailwindcss/vite` otherwise scans only Vite's root (`apps/web`)
and misses classes used in `packages/*`; the chat surface tokens are mapped
there too, because Tailwind generates utilities only from that stylesheet.

## UI kit (ui)

`packages/ui/src/index.ts` is the kit shipped to child projects: a primitive
with no importer in this repo is not dead code, and removing one weighs
child-project demand (`docs/guides/sync.md`). `@groot/ui` imports neither
`@groot/jobs` nor `@groot/shell`, so `StatusVariant` spells out the job
states and the toaster reads the `dark` class on `<html>` itself.
`StatusBadge`'s destructive text mixes in the foreground because plain
`--destructive` measured 4.0:1 (light) and 4.2:1 (dark) at 12px, under the
4.5:1 minimum. `Select` opens as a popper below its trigger by default;
Radix's item-aligned mode covers the trigger and the fields around it.
`useModalPresence` force-unmounts after a timer as well as on
`onExitComplete`, because animation frames stall in throttled background
tabs and would leave an invisible overlay and its scroll lock behind.

Hotkeys (`packages/ui/src/hotkeys.ts`) match the physical key when the typed
key is not a Latin letter or digit (Cyrillic, Greek) or when ⌥ is held, and
take a Latin letter at face value otherwise, so on Dvorak or AZERTY the key
that types "t" is never read as the physical K. One press runs at most one
binding: an open dialog's own hotkey first, nothing else while any dialog is
open, then the newest dialog-scoped binding, then the newest global one.
Handlers are read through a ref so a re-render never rebinds and reorders
them.

## Browser automation (sandbox)

Sites' bot checks turn away a browser that says it is automated, so the
browser looks like a person's Chrome: no `--enable-automation`, a user agent
without `HeadlessChrome` (major version only, per user-agent reduction), and
the owner's locale and time zone rather than a UTC clock and en-US
(`packages/sandbox/src/browser-chromium.ts`,
`packages/sandbox/src/browser-vm-setup.ts`). A self-solving bot check (AWS
WAF, Cloudflare, announced in a response header) is waited out for up to
15 s while it reloads into the real page; a CAPTCHA is returned as it is.

Playwright waits forever by default, so every snapshot, click and fill is
bounded at 15 s. A navigation waits up to 5 s past `domcontentloaded` for
`load`, because script-built pages have nothing to read earlier; a click
waits 500 ms for a navigation to start, because a link's navigation begins a
moment after the click resolves.

On the VM's headful Chrome, CDP text insertion lands on whichever surface
has browser focus (often the address bar), so text fields are clicked before
they are filled; date, color and range inputs are set with `fill` and
selects with `selectOption`, never clicked, since a click opens the native
picker. A value is filled in one call, because a key per character is a
round trip each on the VM link. The mouse is parked in the page before a
wheel scroll. Screenshots use CSS scale so a 2x desktop does not double the
pixels the model pays for. The snapshot is compacted
(`packages/sandbox/src/browser-snapshot.ts`) because Playwright's raw `ai`
snapshot runs 5 to 12 times the page's text; `[active]` is dropped because
focus moves on every action and would show in every diff.

## Remote browser transport (sandbox)

`createForwardingServer` in `packages/sandbox/src/browser-remote-cdp.ts` is a
raw TCP server: `node:http` cuts any connection without a full request
header within 60 s, which killed Playwright's idle CDP websocket. It buffers
a socket's first bytes until the SSH channel opens, since CDP clients write
immediately. Window resizes run one at a time and keep their DevTools
session, so two never land swapped and a resize is one round trip.
`connectOverCDP` uses `webSocketDebuggerUrl` verbatim and that names the
VM-side port, so it is fetched through the tunnel and rewritten. Chrome
resolves names on the VM, so the navigation guard there checks literals and
local names only (`resolveHost: null`); the VM-side proxy of ADR 0038 checks
what names resolve to. Closing a CDP-attached browser does
not end it, so the recorded pids are killed.

## Browser and computer sessions (sandbox)

Chrome locks a profile directory, so there is one Chrome per profile; agents
on a shared profile each get a tab of their own and share its logins. The
first tab cannot close without closing the browser, so a released first tab
is blanked and left unassigned. While the owner drives, browser reads are
allowed but computer reads are refused, so nothing the owner types on the
desktop reaches the model; a takeover request that times out leaves the
owner driving. On a hand-back the agent continues from whichever tab the
owner left in front.

A vault value is filled by one in-page function that asserts the frame's
origin before writing and reports only whether a field was filled; a field
in another site's frame is never filled (`packages/sandbox/src/browser-fill.ts`).
On the desktop, typed text, clipboard text and vault values travel on the
exec's stdin, never its command line, because `ps` on the VM shows argv; a
secret is typed in the same exec that checks the active window, so nothing
can come to the front in between (`packages/sandbox/src/computer-x11.ts`).
Exit codes such as `DESKTOP_GONE_EXIT` are frozen: the app and the VM
scripts agree on them.

The desktop's Chrome opens the browser toolkit's profile so the two share
logins. Chrome allows one instance per profile, so launching either stops
the other's Chrome first with SIGTERM, which flushes cookies, and both use
the same `--password-store` or neither could read the other's cookies. A
fresh desktop profile is seeded with an XFCE panel config, because without
one XFCE opens a first-run dialog over the bot's first screenshot. Unlike the
browser, a desktop survives an app restart and the next launch reattaches to
it (`packages/sandbox/src/computer-vm-setup.ts`).

## SSH dial (sandbox)

`packages/sandbox/src/ssh/connection.ts` connects with no credentials over
the tailnet, because Tailscale SSH terminates at the node and the tailnet's
ACLs are the identity check; a private key is only for hosts that cannot join
the tailnet. Host keys are pinned on first use when a store is given, as
defense in depth over WireGuard. The client keeps its `error` listener for
its whole life, because ssh2 emits a second, fatal error after a handshake
timeout and an unhandled one would take the server down. `onOpen` runs
synchronously with the open channel, because ssh2 can emit a fast command's
exit in the same tick.

The test server (`packages/sandbox/src/testing-ssh-server.ts`) uses an EC
P-256 host key because ssh2 1.17 cannot parse ed25519 PKCS#8, and imports
ssh2's default export because a plain-node child cannot resolve its named
exports through cjs-module-lexer.

## Terminal tabs (sandbox)

Every tmux call is prefixed `LC_ALL=C.UTF-8`, `new-session` included so the
tmux server itself starts in UTF-8: ssh2 exec sessions carry no `LANG`, and
tmux 3.4 then replaces TAB with `_` in listings and mangles non-ASCII output.
Its format strings hold literal TAB bytes because tmux 3.4 does not expand
`\t`. Tabs live on a dedicated socket so the owner's own tmux is never
touched. The settings chain is idempotent and runs on every create and
attach, so a server started by an older build picks up new settings. An
attach never passes `-d`, since detaching other clients closed the tab on a
second device. tmux 3.4 exits 0 with empty output for a missing target, so
empty output reads as unknown. A tab is busy when its foreground process is
not the login shell, and an unreadable login shell counts as busy, the safe
side of the close confirmation (`packages/sandbox/src/terminal/tmux.ts`).

## Code harnesses (code)

A harness never fakes a capability: one without approvals shows no approval
card rather than one answered for it (`packages/code/src/contracts/capabilities.ts`).
The Claude Code driver writes a thread's index row one patch at a time, each
computed from the row the last write left, so a rename racing a turn's end
cannot drop the turn record. Claude Code reports one cost per model, split
across token bands by Anthropic's fixed price ratios (output 5×, cache
writes 1.25×, cache reads 0.1× the input price) so the bands add up to the
total (`packages/code/src/drivers/claude-code/usage.ts`).

The Shelley driver lists only conversations tagged `tiny-agents`, plus their
subagents, because Shelley does not copy tags onto subagents. Shelley has no
"add tag", so tagging replaces the tag list with the existing tags plus ours;
conversations from before tagging are adopted once per process. Archiving
moves a conversation's subagents too, best effort, so one that will not move
does not undo the parent's archive. The conversation list is re-read on a
debounce instead of applying Shelley's RFC 6902 patches, which arrive several
times a second during a turn; a snapshot only seeds the working state of
conversations the stream has not reported, because a snapshot can trail the
stream and hide a true → false. Shelley's timestamps have second precision,
so turns under a second show no duration
(`packages/code/src/drivers/shelley/`).

## GitHub client (github)

The App JWT is backdated a minute for clock drift; GitHub allows at most ten
minutes (`packages/github/src/app-auth.ts`). GitHub refuses a search query
over 256 characters, so the review inbox adds repository qualifiers only
while the query fits and the caller filters past that. A check is shown by
its latest run per name, as GitHub's own list does, because a workflow that
runs on every PR event adds a run to the same commit each time. Mergeability
GitHub has not computed yet is `unknown`, never `conflicting` or `mergeable`
(`packages/github/src/client.ts`).
