# 0033 — Decisions recorded from code comments: agent, Claude worker and models

- Status: accepted
- Date: 2026-11-20

## Context

These decisions came out of the comment sweep under
[ADR 0028](0028-code-carries-no-comments.md) over `packages/agent`,
`packages/claude-worker` and `packages/models`. Each one used to sit as a
comment beside the code it governs. Only choices a reader could not recover
from the code, its tests or an earlier ADR are kept here. The engine seam and
the Tool gate's order are in [ADR 0014](0014-tool-gate-and-engine-seam.md),
the worker's lockdown and setup in [ADR 0008](0008-claude-code-engine.md) and
[ADR 0010](0010-claude-worker-runs-on-the-sandbox.md), the coding mode in
[ADR 0012](0012-claude-code-coding-mode.md), model rows in
[ADR 0016](0016-models-are-owner-data.md) and the Claude plan transcript in
[ADR 0018](0018-claude-plan-transcripts-are-durable-entries.md).

## Prompt cache: what goes into a request

Several choices exist only so the provider's prompt cache keeps hitting:

- `packages/agent/src/context-trim.ts` drops old tool-result screenshots and
  long page reads from the copy sent to the model (the stored transcript is
  untouched). It keeps the newest few and drops older ones in steps
  (`DROP_STEP`, `PAGE_READ_STEP`), so the request prefix changes once every
  few steps instead of on every step. Reads shorter than `LONG_READ_CHARS`
  are kept because their drop would cost more than the cache miss it causes.
  Images the owner attached are never dropped. The approach follows
  Anthropic's computer-use reference loop.
- The `tool_search` section (`packages/agent/src/capabilities.ts`) lists
  loaded tools too, so loading a tool does not change the section.
- Prompt sections hold only stable text. pi-durable re-sends a section into
  the transcript whenever its text changes, so the bot roster
  (`toolkits/bots.ts`) carries no live busy flag, the skills section
  (`skills.ts`) lists only names and descriptions, today's date
  (`toolkits/today.ts`) is day resolution, and the memory block
  (`toolkits/memory.ts`) renders in a fixed order and is left as shown when
  the only new memories were learned in that same conversation (Hermes
  Agent's frozen snapshot, refreshed for edits the chat did not make).
- The gateway catalog in `packages/models/src/kinds.ts` copies each Claude
  model's Anthropic compat flags onto the gateway entry. pi-ai's gateway
  entries leave out `supportsMidConvoToolChanges` and
  `supportsMidConvoSystemMessages`, so without them every tool load resent
  the whole tool list (issue #360).
- `today.ts` prints the configured zone name, not ICU's resolved one, which
  reports Asia/Kolkata as the old alias Asia/Calcutta.

## Context ceiling at 150k tokens

`packages/agent/src/context-ceiling.ts` summarizes a chat once its context
passes `CONTEXT_CEILING_TOKENS`, whatever the model's window. pi-durable on
its own compacts only near `contextWindow - reserveTokens`, so on a 1M-token
model one request and every tool step after it could carry close to a
million tokens. Hermes Agent compresses at half the window for the same
reason. The override is computed per model at every resolution, because
pi-durable reads `modelOverrides` each time, so a model added in Settings
gets its ceiling without a restart; a host's own override wins.

## Deferred tools are chosen by schema size

A connection's tools go behind `tool_search` once their schemas pass
`MCP_DEFER_CHARS` (`packages/agent/src/mcp.ts`), measured in characters, not
counted in tools: a few GitHub-style tools can outweigh dozens of small ones
(issue #360). Descriptions are cut at `MCP_DESCRIPTION_MAX`, as Claude Code
does, because some servers put whole manuals there and every request
re-sends them. MCP tools are `replay: "unsafe"` unless the server marks them
read-only or idempotent, and the legacy HTTP+SSE fallback is never tried for
an auth error. On the Claude plan, `tool_search` is not offered
(`engines/claude-code/tools.ts`): Claude Code defers MCP tools itself.

## Replay of tool calls after a restart

Each toolkit's `replay` follows one rule: a call re-runs only when its
effect is idempotent or the store dedupes it.

- `tasks`, `routines` and `bots` are `safe` because the store dedupes on an
  idempotency key. The key is the durable tool task's id, not the model's
  tool call id: a provider's `callId` is unique only within one assistant
  message, and OpenAI-compatible upstreams send short ids (`call_0`) or none.
  The task id is a per-store counter, so `toolIdempotencyKey` in
  `toolkits/tasks.ts` salts it with the conversation's persisted UUIDv7, and
  a fresh agent store beside an old app database never hits old rows.
- Deletes (`delete_task`, `delete_routine`) and `code_send` memoize their
  outcome per tool task. A re-run of a delete would otherwise report "not
  found" for a delete that worked, and harness chat endpoints have no
  idempotency key, so a re-sent message would arrive twice.
- `create_bot` and `see_image` are `unsafe`: re-creating a bot duplicates it
  or fails on the taken name, and a vision answer may differ between runs.
- A call that only waits on the owner (`ask_owner`, `request_credentials`,
  `browser_enter_code` without a vault handle) is replay-safe even when its
  tool is not, so a restart re-attaches to its document instead of
  reporting "interrupted".

## The Tool gate's limits

`packages/agent/src/gate.ts` memoizes every decision on the call, so a
replay or a permission change mid-call never flips it. A budgeted
conversation (a routine run) past its budget has every call refused so the
model wraps up, and past `BUDGET_STOP_FACTOR` times the budget it is
stopped. A run (one reply through all its tool rounds) past
`RUN_TOOL_CALL_LIMIT` calls is refused, and stopped after `RUN_STOP_AFTER`
more: a stuck loop must not run until someone presses Stop. Run counts live
in memory; a restart starts them over, which only ever allows more. In a
shared chat, YOLO and auto-review trust only the owner's messages (`by`, S6):
a guest's or another bot's turn always shows the card. Vault uses always
reach the owner.

The runtime stops a run from a `setTimeout`
(`packages/agent/src/runtime.ts`), outside the calling tool's own
invocation, because aborting joins that invocation.

## Auto-review only removes cards

The reviewer (`packages/agent/src/reviewer.ts`) answers "approve" or "ask
the owner", never "deny", and any failure means "ask the owner". It reads
the owner's own messages and the pending call, never tool results or
fetched content, where injected instructions arrive.

## Owner waits and their documents

- An approval document is marked `asked` by the wait that created it
  (`packages/agent/src/approvals.ts`). A host answer for a call that never
  asked creates an unmarked document and is refused, so only a waiting call
  can be decided.
- The host-side reads of a question or credential request document throw
  for another tool's task, and that throw rolls back the document the read
  would have created.
- A push names only an item and the target's host (the phishing tell),
  never the full target or a value.

## YOLO mode is its own document

`YoloDoc` (`packages/agent/src/policy.ts`) is apart from `PermissionsDoc`
because the permissions are recompiled from the bot on every send, while
YOLO is the chat's and only the owner's toggle writes it. A fork starts with
it off. On the Claude plan, which has no gate plans, YOLO keeps every call of
a vault-flagged tool asking (`ToolInfo.vault`).

## Runtime open order

`AgentRuntime.open` registers the accounts' providers, installs the context
trim and every capability, and opens the harness before `resume()`, because
an interrupted turn or tool call re-runs against them. The trim is installed
first so conversations that never chose capabilities get it too. pi-durable
stores extension names, so a capability installed later (an MCP server that
reconnects) is picked up without reconfiguring. Follow-ups queued behind a
busy reply are answered together in one run (`followUpMode: "all"`,
issue #396).

## Store lock

`packages/agent/src/lock.ts` holds an exclusive SQLite lock on a sidecar
file for the life of the process. pi-durable has no cross-process locking,
and two processes on one `agent.db` (a rolling deploy overlapping
containers) would corrupt each other's work. The OS releases the lock when
the process dies, so a crash never leaves it stale, and it works across
containers that share the volume.

## Deprecated re-exports

The package root and the `./sandbox`, `./terminal`, `./browser`,
`./computer` and `./testing` subpaths of `@tiny-agents/agent` re-export
symbols that moved to `@tiny-agents/sandbox` and `@tiny-agents/models`
(rewrite steps 3.3 and 3.4). They are deprecated: nothing in this repo
imports them from here, and they stay only so outside importers keep
compiling until a major removes them. Import from the new package. The
Photon image helpers are re-exported from the root because `apps/web` must
not import pi-durable.

## Untrusted content

- Attachment text (`toolkits/attachments.ts`) is fenced as untrusted, and a
  fence-like sequence inside cannot close it. Memory capture reads an owner
  message through `stripAttachmentNotes`, so a file can never plant facts
  about the owner.
- `sanitizePeerText` (`toolkits/peer-text.ts`) neutralizes a leading line
  that imitates the system's own attribution, so another bot cannot present
  itself as the owner. Only the delivery pipeline sets `peer`; the envelope
  parser alone never attributes a card.
- `create_bot` and `update_instructions` are `askOnly`, and the app's store
  refuses them in unattended turns and shared chats, so a planted prompt
  never reaches a later request without the owner watching.

## Vault sinks

- The redactor (`packages/agent/src/redact.ts`) is a backstop: no code path
  hands a value to anything but a sink. Values shorter than four characters
  are not scrubbed (a CVC would turn every "123" into noise), and longer
  forms are replaced first so a base64 form leaves no raw tail.
- Env injection into `run_command` asks on every use, because model-written
  code holds the value; a grant names one handle, so a call using several
  items asks every time. Several items are resolved each inside the previous
  one's sink, so no value outlives the call. A vault approval nobody answers
  fails closed.
- The host check on a command's text is a heuristic early refusal; the
  confinement is the control. `packages/agent/src/toolkits/sandbox-egress.ts`
  runs a confined command in a transient `systemd-run` unit
  (`NoNewPrivileges`, `IPAddressDeny=any` with the allowlist,
  `RestrictAddressFamilies=AF_INET AF_INET6`, a read-only `/etc/hosts`),
  because the sandbox user has passwordless sudo and could undo a firewall
  or group it can edit. Secrets arrive on stdin, never argv, a file or ssh
  `AcceptEnv`.
- The sandbox toolkit never falls back to a default host: an unset one would
  dial localhost, the app server itself. A detached command runs whole inside
  one `sh -c`, so chains stay in the detached session and the redirect
  covers every step.
- A credential request in a page frame (`frameOrigin`) fills only in that
  frame and only while the page is still on its `origin`.

## Browser and computer actions

- A page read returns at most `READ_LIMIT` characters, with the rest in
  windows the model asks for. An action returns the page after it (the first
  part of a new page, or the changed lines of the same page) so most steps
  need no separate snapshot. Typed text is never echoed back, not even in the
  page's change.
- Navigation is an action and waits out a takeover like every other effect.
- On the computer, a closing chord, closing a window and reading the
  clipboard ask even under always-allow. A read of a desktop found gone
  relaunches it once; an action is never retried, because coordinates aimed
  at a desktop that died mean nothing on a fresh one.

## Web requests

`http_request` (`packages/agent/src/toolkits/web.ts`) is made by this server,
never through TinyFish, so a vault key reaches only its item's hosts. The URL
is resolved once and the connection is pinned to the checked addresses
(`pinnedFetch`), so a second lookup cannot swap in a private address (S7).
Every redirect hop is checked again and the vault header is dropped on a hop
that leaves the original host. Fetch waits `FETCH_TIMEOUT_MS`, past
TinyFish's 120-second CDN ceiling, so its error arrives, and asks with
`ttl: 0` to skip TinyFish's cache.

## Vision side calls

`see_image` fails open: an upstream failure returns an error result so the
bot keeps its turn. The transcriber declares image input on its copy of the
model, because pi-ai strips image blocks for a model the registry lists as
text-only.

## Claude plan engine

- A worker restart ends the turns it was running with an error the owner
  sees instead of letting them wait forever, and the conversation keeps its
  Claude session id so the next turn resumes it
  (`engines/claude-code/engine.ts`).
- Claude plan tool calls are numbered from `TASK_ID_BASE`, apart from pi's
  task ids in the same conversation.
- The legacy JSON import reads every table it needs before its first write,
  because a store transaction reads before it writes.
- A bot session joins at the live edge (`join: "now"`), because replaying an
  old bot turn would run its tools again. On every handshake the Worker
  connection (`packages/claude-worker/src/connection.ts`) asks
  `resolveTarget` again (the tunnel's port can change, and resolving restarts
  a worker that is gone), resumes tracked sessions before sending anything
  that waited, and sets a resume's cursor synchronously when its answer
  arrives, because the replayed events follow in the same burst.
- The worker defaults `maxTurns` to 100 because tools are proxied and a
  browser task can take dozens of turns. `maxTurns` is fixed when a Claude
  Code process starts, so a change restarts the idle process, which resumes
  the same conversation. A stop closes the SDK query so the process stops
  running tools nobody reads.
- The model list (`createSdkModelLister`) starts a query that never sends a
  prompt and reads only its initialization.
- `isUsingOverage` is undocumented and honored only when present
  (`packages/claude-worker/src/usage.ts`).

## Claude worker on the sandbox

- Bump `CLAUDE_WORKER_STACK_VERSION`
  (`engines/claude-code/sandbox-setup.ts`) whenever the install steps or the
  pins change, so existing sandboxes run them again.
- Remote commands settle shortly after exit (`settleOnExit`), because the
  backgrounded worker keeps the SSH channel from closing. A failed setup is
  never cached; the next call tries again.
- The worker listens before Claude Code is signed in, because the app sets it
  up ahead of the login; every session checks the login before it starts.
  The Agent SDK is optional and typed by a local declaration, so CI
  typechecks without it and never calls Anthropic.

## Coding protocol

Streaming text (`coding.partial`) and the command catalog are not
sequenced: they are ephemeral, and a reconnect starts from a fresh snapshot.
Reply payloads are not validated on the client, which trusts its worker.
Attachments travel as file paths in the prompt and Claude Code reads them
with its own Read tool. The SDK needs `settingSources` to include `project`
for the repo's `CLAUDE.md`, and `allowDangerouslySkipPermissions` only at
process start, so switching into `bypassPermissions` waits for a restart. A
stop that lands before the turn arms is sent again on the turn's first
output, because an older CLI drops it. History reads each tool's patch back
from Claude Code's own session file (`session-patches.ts`), best effort,
because `getSessionMessages` leaves the structured result out.

## Models and the gateway

- Discovery goes through the `get` the app hands in, its guarded fetch, so
  `packages/models` never opens a connection itself.
- Gateway catalog models are named so they are not mistaken for the owner's
  own providers: Workers AI models run on Cloudflare's plan.
- A gateway custom provider's model goes to that provider's own gateway URL
  under its bare id, also for a `custom-…` slug the settings lack, because
  the unified endpoint cannot add the provider's base path and answers 404.
  Workers AI reads `Authorization`, an authenticated gateway reads
  `cf-aig-authorization`, and `cf-aig-gateway-id` routes the call.
- Classifiers call Workers AI's `/ai/run` with the gateway header
  (`packages/models/src/workers-ai.ts`); the gateway's provider-native
  `/workers-ai/{model}` route answered 402 for `typesafe/jev`.
- Models that always think adaptively refuse `thinking: {type: "disabled"}`,
  which pi-ai sends for a call with no thinking level, so `kinds.ts` marks
  "off" unsupported for them and the setting is left out.
- Side calls (memory capture, chat titles) run on pi only
  (`model-catalog.ts`): a Claude plan model there would skip the call.
