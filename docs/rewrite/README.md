# tiny-agents rewrite: design for review

Status: **draft, awaiting owner review.** No production code changes until
this design and the behavior register are approved. The decision log is
[`DECISIONS.md`](./DECISIONS.md) and the behavior register is
[`behavior-register.md`](./behavior-register.md).

## 1. What tiny-agents is, in plain English

tiny-agents is a self-hosted messenger for one person, the **owner**, where
every contact is an AI **bot**. A bot has a persona, a model and a set of
tools. You chat with it the way you chat with a person: replies stream in,
and a reply survives a page refresh, a server crash or a redeploy, because
every conversation lives in a durable store (pi-durable's `agent.db`).

What a bot can do:

- **Act.** It can run commands on a sandbox VM, drive a real Chrome, use a
  desktop by clicks and keys, search and fetch the web, call MCP servers,
  read attachments, manage tasks and routines, remember facts about the
  owner, message other bots, edit its own instructions, create new bots, and
  hand coding work to Shelley or Claude Code.
- **Ask first.** Every tool call goes through one **Tool gate**. The owner
  sets each tool to Allow, Ask or Off. Asking puts an approval card in the
  chat and can send a push to a phone. YOLO mode and an auto-review
  classifier can skip the card. Secrets in the **vault** reach tools without
  the model ever seeing them.

Around the chat:

- **Routines** fire bots on a schedule (always in IST).
- **Settling.** When a reply finishes, the app relays answers between bots,
  records routine results, updates the sidebar, sends pushes and captures
  memories.
- **Guests** can share chosen bots' chats with the owner.
- The **Code page** drives external coding agents (Shelley, Claude Code on
  the sandbox).
- The **Terminal, Browser and Computer pages** give the owner a live view of
  the sandbox.
- **Settings → Models** is where the owner adds provider accounts. The
  Claude plan engine runs a bot on a Claude subscription through a worker the
  app installs on the sandbox.

**Size.**

| Area             | Files       | Lines |
| ---------------- | ----------- | ----- |
| App-owned source | ~530        | ~100K |
| Tests            | 2,603 tests | ~60K  |

The baseline on this branch is all green: 1,902 server tests and 701 client
tests. The app runs as one Node process on two SQLite files.

### Who depends on it

| Dependent                                                   | Depends on                                                                                                                                                                                                                                                           | Constraint for the rewrite                                                                                         |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| The owner (prod on Coolify, `pnpm local` installs)          | Every page, every flow, URLs (`?focus=`, `?new=1`, `/settings?tab=`), keyboard behavior, push wording                                                                                                                                                                | Behavior parity. Recorded and diffed (§6)                                                                          |
| Guests                                                      | `GUEST_ACCESS` routes, shared chats                                                                                                                                                                                                                                  | Same access, including today's holes, unless signed off (register S-rows)                                          |
| `app.db` (13 migrations, upgrade-from-Prisma copy)          | Table shapes, `Number(conversationId)` links                                                                                                                                                                                                                         | Never edit an applied migration. Schema changes are new migrations with data copies                                |
| `agent.db` (pi-durable)                                     | Doc kinds `tiny.permissions/yolo/grants/approval/credential-request/questions`, memo keys `gate:*`, `vault:use`…, entry kinds `chat.user` (+ legacy `pi.user`), tool `details` shapes, capability ids, tool names (incl. `shelley_*` aliases, `mcp__<slug>__<tool>`) | **Frozen formats.** Everything already stored must still read and resume identically                               |
| `<agent.db>.claude.json`                                    | Claude-plan transcripts                                                                                                                                                                                                                                              | Read on upgrade (import or keep reading)                                                                           |
| The sandbox VM                                              | Worker WS protocol (`welcome`, `turn`, `coding.*`, resume cursors), `~/.tiny-agents/*` markers, locks and pid files, profile directories, tmux `-L ta-terminal` / `ta-term-N`, exit-code sentinels, host-key pins in KV `SANDBOX`                                    | Wire- and file-compatible. Worker and app ship together (sha marker), but VMs keep old desktops, profiles and pins |
| Shelley                                                     | Its HTTP API, `stream2` SSE, `X-Exedev-Userid`                                                                                                                                                                                                                       | Client only, no change                                                                                             |
| MCP servers                                                 | `/api/v1/connections/oauth/client-metadata.json` and the callback URL                                                                                                                                                                                                | Public URLs must not move                                                                                          |
| groot upstream                                              | `packages/{core,jobs,shell,ui}`, `.groot/`, synced docs and scripts                                                                                                                                                                                                  | **Out of scope.** They are synced. A rewrite there forks the boilerplate. Local kit patches go upstream as today   |
| `site/` and `scripts/demo/`                                 | Faux director scripts and UI selectors                                                                                                                                                                                                                               | Keep the faux protocol (`/ask`, `/browse N`, `/code`, `/improve`, `/newbot`, `Echo:`)                              |
| verify-tiny-agents (45 journeys), Playwright e2e (14 specs) | Page routes, roles, labels and settings sections                                                                                                                                                                                                                     | Kept green. They are part of the proof                                                                             |
| pi-durable 1.4.0 / pi-ai 1.4.0 (exact pins)                 | Its `Harness`, `Tx`, `defineTool`, storage                                                                                                                                                                                                                           | One package may import pi-durable (R-rule kept)                                                                    |

## 2. What stays, and why

The goal is not to retype 100K lines. The current code already learned many
things the hard way, and several modules are already the shape I would draw
from scratch. They stay, re-homed behind the new seams, with their tests:

| Kept as-is (shape)                                                                           | Why it's already right                                                      |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `ToolGate` rule order (plan → permission → unattended → YOLO → review → wait → run → redact) | One gate for both engines (ADR 0014). The order is the behavior             |
| `SandboxConnection` (one pooled SSH connection, ADR 0013)                                    | A deep module with a small interface                                        |
| `ThreadFeed`, `turnOutcome`, the `HarnessInstance` contract (`packages/code`)                | Clean contract plus conformance kits. Fixes are behavior changes (register) |
| `WorkerConnection` + `SessionLog` (claude-worker)                                            | Reconnect, resume and heartbeat in one place                                |
| `defineMachine` + guarded writes (`shared/state-machine.ts`)                                 | Already data-driven and tested                                              |
| `routines.arming.ts` compare-and-set writes, `memories.ledger.ts`                            | The right owners. Their leaks get closed (register)                         |
| Client `chat-session.ts` / `store/chats.ts` (Echo, Outbox)                                   | The best module in the client: pure reducer, injected ports                 |
| HTTP API paths, envelopes, SSE event shapes, WS protocols                                    | Consumers depend on them. Parity is the proof                               |
| Two SQLite files, single process, store lock, `/health` gated on resume                      | Forced by pi-durable. Still correct                                         |

## 3. Diagnosis: what is wrong with today's shape

Eight structural problems produce most of the bugs and most of the cost of
change. Each one cites what the readers found (file:line in the decision
log).

1. **No first-class Conversation.** "Who is behind conversation N?" is a
   reverse lookup done six ways:
   - `bots.conversationId`
   - `bot_chats`
   - `routines.conversationId`
   - `chatOwner`
   - raw queries in self-improve, list and people
   - legacy `coalesce(...)` SQL

   Every new feature adds another.

2. **Settling is level-triggered, and "the reply" has three definitions.**
   - The pipeline settles on any `onActivity` with `busy:false`, which
     includes wait-count changes.
   - Deliveries and routines use `finishedReplyTo(requestId)`.
   - The list and notifications use "newest assistant message".
3. **The engine seam is asymmetric.**
   - `PiEngine` has methods the interface lacks, and the runtime calls them
     directly.
   - `submit` means "admitted" on pi but "whole turn finished" on Claude.
   - The Claude transcript is an in-memory map plus a non-atomic JSON file:
     no idempotency, no queue, lost on a corrupt write, and the wrong engine
     answers reads after a restart.
   - The transcript projection, `userMessagesOf`, `lastMessage`, windowing
     and diffing are each written twice.
4. **A tool is declared twice.** Its `ToolInfo` (UI metadata) and its
   `defineTool` are kept in sync by hand. Gate plans hang off a module-level
   `WeakMap`. Memo keys are free strings.
5. **Copy-paste twins in infrastructure.**
   - Browser and computer session managers: about 400 duplicated lines,
     already drifted (reads during takeover, close-then-reopen, idle).
   - Two worker session books.
   - Four shell-quoting helpers.
   - Overlapping exit-code sentinels.
   - Per-bot and per-profile route files for both the browser and the
     computer.
6. **Process globals instead of a composition root.**
   - Runtime singleton, `setAgentRuntimeForTests`, turn-budget `WeakMap`,
     viewers, event bus, chat titler, session `managers` sets, ticket
     stores, SSE set.
   - Boot order is implicit: notifications before settled, routine rearm
     hung off the settled sweep, the `bots` and `vision` capabilities
     installed after open.
7. **God modules at both ends.**
   - Server: `bots.service.ts` (CRUD, links, guests, revisions, send,
     approvals, YOLO).
   - Client: `ChatPane` 675 lines, `ChatMessageView` 960,
     `ModelsSettings` 961, `Routines` 903, `BotDialog` 754 (split in
     step 5.6, §4.5).
8. **Two data layers on the client, and hand-copied wire types.**
   - About 40% of response types are re-declared in `lib/*-api.ts`.
   - React Query is mounted and documented, but unused.
   - Four fetching patterns coexist, with stale-response handling hand-rolled
     in four places.

Two smaller ones:

- `packages/agent` holds about 1,100 lines of provider catalog and discovery
  and the whole sandbox/VM layer, none of which touches pi-durable.
- Secrets live in KV plus a hand-kept `__index` and a sidecar digest, which
  weakens policy binding (S11). Step 4.4 moved them into `vault_values`
  ([ADR 0019](../adr/0019-vault-values-table.md)).

## 4. The new core types

TypeScript sketches. Names follow `GLOSSARY.md`, and new terms are added
there when they land. Anything marked ⚑ changes observable behavior and ships
only after the owner signs off its register row.

### 4.1 Runtime (`@tiny-agents/agent`, the only pi-durable importer)

```ts
type ConversationRef = number & { readonly brand: "ConversationRef" };

/** What a send carries, on either engine. requestId is the idempotency key everywhere. */
interface Submission {
  requestId: string;
  text: string;
  author?: { id: string; name: string }; // shared chats
  peer?: PeerEnvelope; // delivery / relay
  attachments?: AttachmentRef[];
  whenBusy: "steer" | "queue";
}

/** Compiled from a Bot row by Reconcile; the runtime never reads app.db. */
interface ConversationConfig {
  route: ModelRoute | null; // null → bot_default role
  systemPrompt: string;
  toolkits: ToolkitId[];
  permissions: PermissionMap;
  autoReview: boolean;
  unattended: boolean;
}

interface Runtime {
  create(config: ConversationConfig): Promise<ConversationRef>;
  configure(ref: ConversationRef, config: ConversationConfig): Promise<void>;
  submit(ref: ConversationRef, s: Submission): Promise<Admission>; // returns on durable admit, both engines ⚑(Claude)
  abort(ref: ConversationRef): Promise<void>;
  withdraw(ref: ConversationRef, requestId: string): Promise<void>;

  chat: ChatReader; // read / page / watch: ONE projection for both engines
  waits: OwnerWaits; // approvals, questions, credential requests
  yolo: {
    get(ref): Promise<YoloState>;
    set(ref, on: boolean, by: string): Promise<void>;
  };

  activity: {
    busy(): ConversationRef[];
    on(l: (e: ActivityEvent) => void): Unsubscribe;
  };
  turns: { onSettled(l: (e: TurnSettled) => void): Unsubscribe }; // edge: busy → idle, once per turn

  toolkits: ToolkitRegistry;
  models: ModelCatalog & { apply(config: ModelConfig): void };
}

/** The one event settling reads. Replaces level-triggered onActivity for the pipeline. */
interface TurnSettled {
  ref: ConversationRef;
  startedAt: number;
  endedAt: number;
  replies: ReadonlyMap<string /* requestId */, FinishedReply>; // every request the turn answered
  last: ChatMessage | undefined; // what list / notifications use today (kept)
}
```

**Engines become turn runners.** Both write into the same pi-durable
conversation:

- pi admits through `conversation.submit`.
- The Claude plan admits with `tx.appendEntry("claude.user")` and its
  request-id dedupe in one commit, then appends `claude.assistant` entries as
  the worker streams. Prototype P2 shows this works. A single `projectChat`
  reads both entry families, so windowing, diffing, `userMessages`,
  `lastMessage` and Finished replies exist once.

```ts
interface TurnRunner {
  readonly kind: "pi" | "claude-code";
  admit(ref: ConversationRef, s: Submission): Promise<Admission>;
  abort(ref: ConversationRef): Promise<void>;
  // runs the admitted turn; every tool call goes to the ToolGate via ToolCallContext
}
```

`PiEngine`'s extra methods (`create`, `withdraw`, `attachmentIds`, `start`)
move into the runtime's conversation store, where they belonged. Claude-only
calls (`status`, `account`, `prepare`) move to a `ClaudePlan` service in the
app, beside models.

**One tool declaration.** It yields both the UI capability and the pi
extension. The gate plan, replay mode and policy are typed fields. Tools
never import pi-durable.

```ts
const browserClick = tool({
  name: "browser_click", label: "Click", ask: "Click on the page",
  policy: { readOnly: false, default: "ask" /* | askOnly | unattendedOnly */ },
  replay: "unsafe",
  params: Type.Object({ ref: Type.String() }),
  gate: undefined,                       // or vaultGate({ sink: "browser", target: "origin" })
  run: async (args, call: ToolCall) => { /* call.memo(key, schema), call.details(), call.conversation */ },
});
const browser = defineToolkit({ id: "browser", name, description, available: (deps) => ..., tools: [browserClick, ...], sections });
```

**Owner waits are one interface with three kinds.** Today each kind already
owns these pieces informally. Now `approvals.ts`, `toolkits/questions.ts` and
`credentials.ts` each implement one interface:

```ts
interface WaitKind<Doc, Answer> {
  kind: "approval" | "question" | "credential";
  doc: TaskDocToken<Doc>;
  card(details: unknown): WaitCard | undefined; // the transcript parser
  pending(doc: Doc): boolean; // the "really waiting on me" check
  refuseUnattended: string; // the one wording
  answer(doc: Draft<Doc>, a: Answer): void;
}
```

The trackers and `WaitEvent.kind` keep today's grouping: credential requests
still count as approvals (register C-rows).

### 4.2 Sandbox (`@tiny-agents/sandbox`, new package, no pi-durable)

These move out of `packages/agent`:

- `ssh/`
- `terminal/`
- the browser and computer transports and session managers
- the VM setup scripts
- `createForwardingServer`

They are re-cut around two generic pieces:

```ts
/** One generic manager for browser and computer (today: two drifted copies). */
interface LiveSessions<S> {
  open(profile: ProfileKey): Promise<S>; // shared lazy open, cancel-on-close
  peek(profile: ProfileKey): S | undefined; // never launches
  driver(profile): "bot" | "human";
  takeOver(profile, by): void;
  handBack(profile): void;
  read<T>(profile, fn: (s: S) => Promise<T>, opts: { allowWhileHuman: boolean }): Promise<T>; // per-transport, keeps today's drift
  close(profile): Promise<void>;
}
/** A process stack on the VM: marker, install lock, pid file, launch, parsed `ok key=value` output. */
interface VmStack {
  ensureInstalled(): Promise<void>;
  launch(args): Promise<Record<string, string>>;
  stop(): Promise<void>;
}
```

`allowWhileHuman` keeps today's difference: the browser allows reads while
the owner drives and the computer refuses them. Making them uniform is a
register item.

As built in 3.5 (`packages/sandbox/src/live-sessions.ts`), `S` is the live
entry (the surface plus its driver bookkeeping). The driver stays
`"agent" | "human"`, the value the takeover routes and entries already carry.
`setDriver` maps onto `takeOver` and `handBack`. The core also has `act`
(the bounded wait), `release`, `waitForHandBack`, `drop`, `dispose` and
`closeAll`. `read` and `act` take a `LiveTurn` (`pick` before the driver
check, `finish` after it), so each instance keeps its own awaits. Both
managers keep their public shape and settle at the same microtask as before.
Each difference between the two old copies is one option, pinned by
`live-sessions-drift.test.ts` unless named:

| Drift                                 | Browser                                                                 | Computer                                                 | Option                                     | Why kept                                          |
| ------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------- |
| Read while the owner drives           | allowed (`u11.test.ts`)                                                 | refused                                                  | `read(…, { allowWhileHuman })`             | U11, Preserve                                     |
| Error when the owner drives           | plain `Error`                                                           | `OwnerDrivingError`, one text for reads, one for actions | `ownerDriving(kind)`                       | the computer toolkit maps the class to its result |
| When the driver is checked            | after the open and the agent's tab (three microtasks in)                | as soon as the open resolves (one in)                    | `read`/`act` with or without `pick`        | a takeover in the same tick wins or loses by it   |
| Open during a close in progress       | waits for it (`browser-sessions.test.ts`)                               | launches at once, so a wipe can land after               | `openWaitsForClose`                        | no behavior change in 3.5                         |
| Close with wipe while opening         | closes on arrival, wipes once after                                     | closes and wipes on arrival, then wipes again            | `wipeCancelledOpen`                        | no behavior change in 3.5                         |
| Message of a cancelled open           | "…closed while it was opening."                                         | "…closed while it was starting."                         | `closedWhileOpening`                       | tool results show it                              |
| Last open error                       | `describeBrowserError` (install hint)                                   | the raw message                                          | `describeOpenError`                        | the status routes show it                         |
| Invalid profile name                  | refused inside the open: the last open error                            | refused before anything starts: no sweep, no open error  | `checkProfile` (computer only)             | no behavior change in 3.5                         |
| A failing surface `close()`           | fails `close` (the wipe is skipped)                                     | swallowed (the wipe still runs)                          | `closeErrors`                              | no behavior change in 3.5                         |
| Open of a live session                | activity only once the agent's tab is ready                             | activity at once                                         | `touchOnOpen`                              | a sweep during a tab open closes the browser      |
| Hand-back, or setting the same driver | not activity: idle counts from the takeover                             | activity: the idle window restarts                       | `touchOnHandBack`                          | no behavior change in 3.5                         |
| Hand-back extra step                  | adopt the owner's front tab, then wake waiters                          | wake at once                                             | `handBack(profile, false)`, then `release` | `browser-toolkit.test.ts`                         |
| Idle sweep of a session               | closes it without waking waiters (a hand-back still adopting keeps its) | closes it and wakes waiters                              | `sweepReleases`                            | an idle window shorter than the hand-back wait    |
| What a release clears                 | nothing                                                                 | the bot's `takeover` request (C28 keeps it on a timeout) | `onRelease`                                | C22, C28                                          |
| Bot asks the owner to take over       | none                                                                    | `requestTakeover` on `takeOver` and `waitForHandBack`    | computer instance code                     | `computer-toolkit.test.ts`, `c22.test.ts`         |
| Tabs, bring-to-front, `closeTab`      | per agent tab in a shared profile                                       | none                                                     | browser instance code                      | `browser-toolkit.test.ts`                         |
| `takeoverOf`                          | none                                                                    | reads a takeover card from tool details                  | stays in `computer-sessions.ts`            | not session state                                 |
| Idle and hand-back wait defaults      | 10 min, 10 min                                                          | 10 min, 10 min                                           | `idleMs`, `humanDriverWaitMs`              | same today                                        |

Unified with no option, because no caller can tell: what `peek` returns
during an open (nothing, for both), when `onDisconnect` is registered, and
the order of forgetting and releasing on a close. Neither manager emits
events. One accepted difference, reachable only by a `close()` that throws
synchronously (no transport does): the computer's `closeAll` used to release
every desktop first and then reject on that throw; now, as the browser's
always did, each close runs in its own async step, so the throw rejects only
that entry, every other desktop is still released and closed, and `closeAll`
resolves.

As built in 3.6 (`packages/sandbox/src/vm-stack.ts`), a `VmStack` is one
spec plus the caller's exec. `createVmStack(spec, run)` returns
`ensureInstalled(onInstalling?)`, `launch(args)` (the parsed report, as a
record; a launch that fails is stopped first), `stop(profileDir)` and
`wipe(profileDir)`. `stop` and `wipe` take the profile because one stack
serves every profile on the VM. The spec owns the install marker, the binaries
and packages the readiness test checks, the install steps, the launch script's
parts, the report's keys, the teardown and wipe lines, and each step's timeout
and label. The pure builders (`readyScript`, `installScript`, `launchScript`,
`teardownScript`, `wipeScript`, `parseReport`, `reportLine`, `launchBudgetMs`)
generate every script from the spec, and the old exported builders
(`launchStackCommand`, `launchDesktopCommand` and the rest) are now one-line
calls of them. The browser (`browserVmStack`) and the computer
(`computerVmStack`) are the two specs.

Written once, with no option, because the two copies were already the same:
the install script's frame (the marker set as `MARK`, the check before and
after the VM-wide `browser-stack.lock` on fd 9, the X socket directory, the
marker, `installed`), the launch script's frame (the profile made absolute,
`browser-launch.lock` on fd 8 given up after 25 s, the display search from 90
to 189, the X socket wait, vncconfig, `8>&-` on every background process, the
`UP` wait loop and its failure block, the report line), the 20 s margin over
the launch budget, the teardown after a failed launch (its error swallowed),
and comparing the readiness check's trimmed output with `ready`.

Each difference between the two old copies is one spec field. Every script
is pinned byte for byte, and every row is pinned by `vm-stack-drift.test.ts`
(recorded on the old code):

| Drift                          | Browser                                                                            | Computer                                                                                            | Option                                  | Why kept                                                              |
| ------------------------------ | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------- |
| Install marker                 | `~/.tiny-agents/browser-stack-v1`                                                  | `~/.tiny-agents/computer-stack-v1`                                                                  | `marker`                                | D9: existing VMs and `docker/sandbox/Dockerfile` carry them           |
| What counts as installed       | `Xtigervnc`, `google-chrome-stable`                                                | eight binaries, and each extra package by `dpkg-query`                                              | `commands`, `packages`                  | the stacks differ                                                     |
| Readiness script layout        | the marker path inline, a multi-line `if`                                          | `MARK` set first, a one-line `if`                                                                   | `readyLayout`                           | the scripts stay byte-identical; the answer is the same               |
| Install steps                  | amd64 only, plain apt, the Chrome .deb                                             | apt waits 180 s for dpkg's lock, the extras; a bad extra name refused once the install starts       | `installSteps()`, built when it runs    | the stacks differ; the refusal comes after the `installing` phase     |
| Check and install timeouts     | 15 s, 10 min                                                                       | 30 s, 15 min                                                                                        | `steps.check`, `steps.install`          | no behavior change in 3.6                                             |
| Lock give-up message           | "…another browser to finish starting…"                                             | "…another browser or desktop to finish starting…"                                                   | `launch.lockHolders`                    | stderr reaches the error                                              |
| Before the launch lock         | nothing                                                                            | points the desktop's Chrome at the browser profile                                                  | `launch.beforeLock`                     | a running desktop's menu follows too                                  |
| The profile's last run         | kills its recorded pids, then every Chrome on the profile (waits up to 10 s)       | reattaches when the recorded desktop is up at this size (`reused=1`), else kills its process groups | `launch.clearPrevious`                  | a desktop outlives the app, a browser does not                        |
| Ports                          | VNC and CDP                                                                        | VNC                                                                                                 | `launch.ports`                          | the stacks differ                                                     |
| Before Xtigervnc               | log paths, the pid file emptied                                                    | the XFCE settings seed, log paths, `stop_started`                                                   | `launch.prepare`                        | the stacks differ                                                     |
| Xtigervnc                      | CSS size times the scale, `-desktop tiny-agents`                                   | the size as given, `-desktop tiny-agents-computer`                                                  | `launch.geometry`, `launch.desktopName` | a VNC viewer shows the name                                           |
| Pid file                       | `.stack-pids`, the X pid through `XPID`                                            | `.desktop-pids`, `$!` directly                                                                      | `launch.pidFile`, `launch.xPidVariable` | D9 (the desktop's Chrome reads `.stack-pids`); byte-identical scripts |
| X server that never came up    | carries on, and the CDP wait fails                                                 | fails at once: "The display server did not start…"                                                  | `launch.afterX`                         | the error text differs                                                |
| App and readiness probe        | Chrome; `curl /json/version`, 30 s, deadline `CDPWAIT`                             | a session bus and XFCE; `wmctrl -m`, 30 s, deadline `WMWAIT`                                        | `launch.start`, `launch.up`             | the stacks differ                                                     |
| Cleanup when the app is not up | kills and removes the pid file                                                     | `stop_started`, removes the env file                                                                | `launch.up.cleanup`                     | the stacks differ                                                     |
| Once up                        | nothing                                                                            | records `.desktop` (display, port, size)                                                            | `launch.afterUp`                        | the reattach reads it                                                 |
| Report                         | `ok display= vnc= cdp=`                                                            | `ok display= vnc=` and an optional ` reused=1`                                                      | `report.variables`, `report.flags`      | parsing unchanged: first match anywhere, keys in order, digits only   |
| Missing report                 | "The VM did not report the browser stack ports"                                    | "The VM did not report the desktop's display"                                                       | `report.missing`                        | tool results show it                                                  |
| Launch budget                  | 80 s (adds the 10 s Chrome stop wait)                                              | 70 s                                                                                                | `launch.otherWaitSeconds`               | the exec timeout is the budget plus 20 s                              |
| Teardown                       | kills the recorded pids                                                            | kills each recorded process group, then the pid; removes the state and env files                    | `teardown`                              | the stacks differ                                                     |
| Teardown timeout               | 15 s                                                                               | 30 s                                                                                                | `steps.stop`                            | no behavior change in 3.6                                             |
| Wipe                           | the profile made absolute, every Chrome on it stopped                              | the recorded process groups killed                                                                  | `wipe`                                  | the computer's Chrome may hold the browser profile                    |
| Exec failure wording           | `VM exec failed (<code>): <step>`, then stderr's (or stdout's) last 600 characters | `Could not <step> on the VM (exit <code>): ` and the last 600 of stderr's first 4000 (or stdout's)  | each transport's `VmRun`                | the computer's runner also serves its tools                           |
| Exec timeout wording and cap   | `VM exec timed out: <step>`, 16 MiB                                                | `The computer did not answer within <n>s`, 12 MiB                                                   | each transport's `VmRun`                | tool results show it                                                  |

One label is new and never shown: the computer's teardown after a failed
launch now runs as "stop the desktop", and its failure is swallowed as before.

The Claude worker's setup (`sandbox-setup.ts`) is not a `VmStack`, because
its shape is different, not drifted: its marker lives in a directory picked
at run time (`/opt/tiny-agents/claude-worker` when the image baked it, else
`~/.tiny-agents/claude-worker`) and an install deletes older markers; its
install lock is its own (`install.lock` in that directory), so npm may run
beside apt, and taking the VM-wide lock would change that; there is no
separate readiness check, no display and no VNC; and its launch is a
reuse-or-replace keyed on the bundle's sha, answering `missing`, `upload` or
`ok <token>` on the last line, which drives up to four rounds with an upload
on stdin between them. It uses the shell module like everything else.

`packages/sandbox/src/shell.ts` is the one place that quotes, wraps and reads
exit codes, re-exported from the package root for the agent's toolkits:

| Export                   | Replaces                                                                                                                                                          |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shQuote`                | the browser setup's (re-exported there for its suite) and three hand-rolled copies: tmux `typeLineCommand`, the sandbox toolkit's detach, the attachments `mkdir` |
| `bashScript`             | five `bash -c` wrappers: the browser and computer setups, the desktop tools, the Claude worker, confined commands                                                 |
| `exitWith`               | every sentinel exit: the desktop tools' 97, 96 and 95, confined commands' 97 and 96, and the stack scripts' generic failures                                      |
| `exitSentinel`           | the reads of those codes: the desktop tools (`DESKTOP_EXITS`) and `run_command` (`CONFINED_EXITS`)                                                                |
| `EXIT_COMMAND_NOT_FOUND` | tmux's literal 127 ("tmux is missing")                                                                                                                            |
| `EXIT_NO_STATUS`         | the connection's literal 255 (a signal, or no exit status)                                                                                                        |
| `failureDetail`          | the browser's, the computer's and the Claude worker's "stderr, else stdout, trimmed, the last N characters" (600, 600, 800)                                       |

Kept as they were, and pinned: a desktop tool's error quotes stderr only (its
last 400 characters); outside the tool that expects it, a window mismatch
(96) or a missing app (95) reads as success; and `run_command` reads 97 as "the
VM can't confine commands" even for a command it did not confine.

### 4.3 Models (`@tiny-agents/models`, new package, pi-ai only)

`providers/*` moves here:

- kinds and templates
- discovery
- test calls
- `buildProviders`
- `ModelCatalog`

The runtime takes a `ModelCatalog`, which is unchanged as a projection.

### 4.4 App server (`apps/web/src/server`)

```ts
/** Composition root: built once by entry.node.ts, or by a test with fakes. Replaces module singletons. */
interface App {
  db: Db;
  clock: Clock;
  runtime: Runtime;
  sandbox: SandboxConnection | undefined;
  live: {
    browser: LiveSessions<BrowserSession>;
    computer: LiveSessions<Desktop>;
  };
  conversations: Conversations;
  access: Access;
  bus: AppBus;
  vault: Vault;
  models: Models;
  connections: Connections;
  code: CodeHub;
  claudePlan: ClaudePlan;
}

/** The one reverse lookup. Today: six. */
type ConversationOwner =
  | { kind: "chat"; bot: BotRow; startedAt: Date }
  | { kind: "routine"; bot: BotRow; routineId: string }
  | { kind: "past"; bot: BotRow; chatId: string }
  | { kind: "none" };
interface Conversations {
  ownerOf(ref: ConversationRef): Promise<ConversationOwner>;
  current(botId: string): ConversationRef; // the bot's chat
  moveBot(botId, to: ConversationRef, why: "new-chat" | "continue"): Promise<void>;
  claimForRoutine(routineId, ref): Promise<boolean>;
}

/** Who is asking, resolved once per request; services check actions, routes keep GUEST_ACCESS. */
type Viewer = { kind: "owner"; userId: number } | { kind: "guest"; userId: number };
// As built in 4.2 (D14): no `bots` set. Shares are read at each check, as today.
```

`Conversations` starts as a module over today's three columns, with no
schema change. Whether it later becomes a `conversations` table is open
question Q3.

**Feature modules after the re-cut.** Behavior is unchanged in each:

| Module     | What goes into it                                                                                                 |
| ---------- | ----------------------------------------------------------------------------------------------------------------- |
| `bots`     | CRUD and links only                                                                                               |
| `chat`     | send, steer/queue, withdraw, abort, approvals, questions, YOLO, stream                                            |
| `settle`   | consumes `TurnSettled`. Steps in today's order: deliveries, routine runs, bot list, notifications, memory capture |
| `delivery` | delivery                                                                                                          |
| `routines` | routines                                                                                                          |
| `memory`   | memory                                                                                                            |
| `access`   | people, guests, live access, `GUEST_ACCESS`                                                                       |
| `live`     | browser and computer routes, one profile-addressed router plus the per-bot aliases                                |
| others     | `vault`, `models`, `connections`, `code`, `uploads`, `terminal`, `notifications`, `tasks`, `skills`               |

**`live`, as built in 4.3** (`apps/web/src/server/api/live/`).
`live.router.ts` is the one router: each route's handler is written once and
registered twice per surface, by profile and as the per-bot alias, which
resolves the bot to its profile (`browserTargetForBot`) and runs the same
handler. `live.routes.ts` declares the two surfaces, the browser and the
computer. The four old routers are gone; the session managers, the VNC
bridges and their ticket stores stay in `api/bots/`, unchanged.

Every route keeps its method, path, guard, envelope, status codes and error
text (D9), and the mount order is the old one. All are under `/api/v1`
behind the session guard. Guests reach only the rows marked _guest_, on a
bot shared with them (`GUEST_ACCESS`, unchanged); anything else answers 403
"Only the owner can do that". In the Refusals column, _bot_ is 404 "Bot not
found", _profile_ is 404 "No such browser." or "No such desktop." for a
profile no bot has, _hint_ is 409 with the computer's setup hint (else "The
computer is not configured."), _body_ is 400 "Validation failed", and _502_
is the failure's message, else the fallback text shown.

| Method | Path                            | Guest | `data`                                                                                                            | Refusals, in order                                                                                                           |
| ------ | ------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/bots/:id/browser`             | yes   | `active, profile, url, driver, mode, scale, starting, phase, error`                                               | bot                                                                                                                          |
| POST   | `/bots/:id/browser/start`       |       | `{ starting: true }`                                                                                              | bot                                                                                                                          |
| POST   | `/bots/:id/browser/vnc-ticket`  | yes   | `path, scale`                                                                                                     | bot; 404 "No browser session for this bot yet."; 409 "This browser is headless and has no live view."                        |
| POST   | `/bots/:id/browser/resize`      |       | `width, height`                                                                                                   | body; bot; 404 "No browser session…"; 409 "This browser cannot be resized."; 502 "Could not resize the browser."             |
| POST   | `/bots/:id/browser/driver`      |       | `driver`                                                                                                          | body; bot; 404 "No browser session…"                                                                                         |
| DELETE | `/bots/:id/browser/profile`     |       | `{ reset: true }`                                                                                                 | bot; 502 "Could not reset the browser."                                                                                      |
| GET    | `/browser`                      |       | `liveView, setupHint, browsers[]`: the profile entry, `active, driver, mode, starting, phase, error`              | none                                                                                                                         |
| POST   | `/browser/:profile/start`       |       | `{ starting: true }`                                                                                              | profile                                                                                                                      |
| POST   | `/browser/:profile/vnc-ticket`  |       | `path, scale`                                                                                                     | profile; 404 "This browser is not running."; 409 "…headless…"                                                                |
| POST   | `/browser/:profile/resize`      |       | `width, height`                                                                                                   | profile, body (together); 404 "This browser is not running."; 409 "…cannot be resized."; 502 "Could not resize the browser." |
| POST   | `/browser/:profile/driver`      |       | `driver`                                                                                                          | profile, body (together); 404 "This browser is not running."                                                                 |
| DELETE | `/browser/:profile`             |       | `{ reset: true }`                                                                                                 | profile; 502 "Could not reset the browser."                                                                                  |
| GET    | `/bots/:id/computer`            | yes   | `configured, setupHint, active, profile, driver, width, height, takeover, starting, phase, error`                 | bot                                                                                                                          |
| POST   | `/bots/:id/computer/start`      |       | `{ starting: true }`                                                                                              | bot; hint                                                                                                                    |
| POST   | `/bots/:id/computer/vnc-ticket` | yes   | `path, scale` (1)                                                                                                 | bot; hint; 404 "No desktop is running for this bot yet." (also for a desktop with no view)                                   |
| POST   | `/bots/:id/computer/driver`     |       | `driver`                                                                                                          | bot, body (together); hint; 404 "No desktop is running…"                                                                     |
| DELETE | `/bots/:id/computer/profile`    |       | `{ reset: true }`                                                                                                 | bot; hint; 502 "Could not reset the computer."                                                                               |
| GET    | `/computer`                     |       | `configured, setupHint, width, height, desktops[]`: the entry, `active, driver, takeover, starting, phase, error` | none                                                                                                                         |
| POST   | `/computer/:profile/start`      |       | `{ starting: true }`                                                                                              | profile; hint                                                                                                                |
| POST   | `/computer/:profile/vnc-ticket` |       | `path, scale` (1)                                                                                                 | profile; hint; 404 "This desktop is not running."; 409 "This desktop has no live view."                                      |
| POST   | `/computer/:profile/driver`     |       | `driver`                                                                                                          | profile, body (together); hint; 404 "This desktop is not running."                                                           |
| GET    | `/computer/:profile/apps`       |       | `apps`                                                                                                            | profile; hint; 404 "This desktop is not running."; 502 "Could not list the apps."                                            |
| POST   | `/computer/:profile/apps`       |       | `opened`                                                                                                          | profile, body (together); hint; 404 "…not running."; 409 "Take control of the desktop first."; 502 "Could not open the app." |
| DELETE | `/computer/:profile`            |       | `{ reset: true }`                                                                                                 | profile; hint; 502 "Could not reset the computer."                                                                           |

Written once, with no option, because the old routers already agreed: start
in the background and swallow its failure (the status reports it), the
driver route (404 when nothing runs, then the manager's `setDriver`), the
502 rule (the error's message, else a fallback), the ticket path
(`<the route's prefix>/vnc?ticket=`, the id or profile URI-encoded), touching
the idle clock on a ticket, a resize and an opened app, the reset (close and
wipe, `{ reset: true }`), the open fields every status ends with (`starting`,
`phase`, `error`), and `profile: "shared" | "own"`.

Each difference between the old routers is one field of `LiveSurface`,
pinned by `live-routes-drift.test.ts` (recorded on the old routers):

| Drift                       | Browser                                                                        | Computer                                                                                  | Option                                     | Why kept                                                                      |
| --------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------- |
| No sandbox VM               | a headless manager: every route works, the view routes answer 409              | no manager: every route but the status answers 409 with the setup hint, after the address | `ops()` throws                             | the statuses report `configured: false`                                       |
| Status and list fields      | `url`, `mode`, `scale`; the list has `liveView`                                | `configured`, `width`, `height`, `takeover`                                               | `bots.status`, `profiles.list`             | D9: the panels and pages read them                                            |
| Unknown profile             | "No such browser."                                                             | "No such desktop."                                                                        | `profiles.notFound`                        | D9                                                                            |
| Nothing running, by bot     | "No browser session for this bot yet."                                         | "No desktop is running for this bot yet."                                                 | `bots.notRunning`                          | D9                                                                            |
| Nothing running, by profile | "This browser is not running."                                                 | "This desktop is not running."                                                            | `profiles.notRunning`                      | D9                                                                            |
| Ticket without a live view  | 409 "This browser is headless and has no live view." either way                | by profile 409 "This desktop has no live view."; by bot the not-running 404               | `noView`, `bots.noViewIsNotRunning`        | D9                                                                            |
| Ticket, by bot              | opens the bot's tab first (its failure swallowed)                              | mints at once                                                                             | `bots.opensTabForTicket`                   | the viewer lands on the bot's tab in a shared browser (`live-access.test.ts`) |
| Ticket scale                | the browser's (2, or 1 with `BROWSER_SCALE=1`)                                 | 1                                                                                         | `view()`                                   | the desktop has no scale                                                      |
| Ticket store and fields     | by bot `userId, botId, target, viewOnly`; by profile `userId, profile, target` | by bot `userId, botId, profile, viewOnly`; by profile `userId, profile`                   | `bots.issueTicket`, `profiles.issueTicket` | each VNC path redeems only its own store (`*.vnc.ts`, unchanged)              |
| Resize                      | a route, by bot and by profile                                                 | none: 404 "Cannot POST …"                                                                 | `resize`                                   | the desktop has a fixed size the viewer scales                                |
| Apps                        | none                                                                           | by profile only                                                                           | `apps`                                     | a Computer page action                                                        |
| Body and bot, by bot        | the body first: a bad body is 400 even for an unknown bot                      | the bot first: an unknown bot is 404 even with a bad body                                 | `bots.bodyBeforeBot`                       | which status a doubly bad request gets                                        |
| Takeover stamp              | the route writes `Date.now()` after the manager's `takeOver`                   | the manager's stamp, on its own clock                                                     | `touchOnTakeover`                          | the same in production; differs under an injected clock                       |
| Reset                       | `close(target, { wipeProfile: true })`, "Could not reset the browser."         | `close(profile, { wipe: true })`, "Could not reset the computer."                         | `ops().reset`, `resetFailed`               | the managers differ                                                           |

By profile, the address is the profile and the owner's tab (`owner`); by bot,
the bot's profile and its tab (its id). The desktop ignores the tab. The
profile routes, and the computer's bot routes, look the target up first and
read the body after: a request bad on both counts is 404. The drift tests pin
that.

**`access`, as built in 4.2** (`apps/web/src/server/api/people/`).
`access.ts` owns the `Viewer` and every guest or owner check past the guard;
`guest.guard.ts` resolves the `Viewer` once per request and applies
`GUEST_ACCESS` (`shared/guest-access.ts`, unchanged, also read by the
client); `live-access.ts` and `people.service.ts` stay beside them. The
folder keeps its name (as D13): five suites import the guard and live access
by path, and the step's proof is that they pass unchanged. The checks hold no
state, so they are plain functions; the one piece of state, the held live
connections, was already `app().liveAccess`.

| Function                                                    | Used by                         | Answers                                                                                          |
| ----------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------ |
| `resolveViewer(userId)`, `isGuestAccount(userId)`           | the guard; `removeGuest`        | `{ kind: "guest" }` for an account with a `guests` row, else `{ kind: "owner" }` (S8)            |
| `canOpenBot(viewer, botId)`                                 | the guard                       | the owner always; a guest when the bot is shared with them                                       |
| `canReachUpload(viewer, id, reach)`                         | the guard; `requireAttachable`  | the owner always; a guest's own upload, or for `uploadedOrShared` one first sent in a shared bot |
| `followsConversation(viewer, conversation)`                 | `/events` (sync, at each event) | the owner every conversation; a guest a shared bot's chat                                        |
| `requireAttachable(viewer, uploadIds)`                      | `POST /bots/:id/messages`       | 404 `Unknown attachment "<id>"` for the first one not reached                                    |
| `requireApprovalAnswer(viewer, input, waitingCall)`         | `decideApproval` (chat service) | a guest: 403 for `alwaysAllow` or `grant`, then 403 on a vault card                              |
| `seesConnections(viewer)`, `countsAsWatching(viewer)`       | `/events`, `/bots/:id/stream`   | the owner only (connection events; the watch that holds back pushes, S2)                         |
| `watchOnly(viewer)`                                         | the live router's bot tickets   | a guest: the ticket is view-only (S2)                                                            |
| `codeCapabilities`, `requireCodeChange`, `requireCodeAsset` | the Code routes                 | a guest's capabilities without the host's controls; the three Code 403s (S3)                     |

The inventory below is every guest or owner check the server made on the
base of 4.2 (`e545172`), with the check that runs before it. Each kept its
status, text and place in that order. Rows 1 to 21 decide by who is asking;
rows 22 to 28 decide by whether the conversation is shared, take no
`Viewer` and stayed where they were. _ac_ is
`tests/server/routes/access-checks.test.ts`, recorded on the base first.

| #   | Where (base)                                 | Condition                                                                     | Answer                                                                                                           | Runs after                                                                                         | Now                     | Pinned by                                  |
| --- | -------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------ |
| 1   | `guest.guard.ts:53`                          | no session user                                                               | 401 "Authentication required"                                                                                    | `requireSession`, which answers 401 `SESSION_INVALID` first, so never reached                      | guard                   | sharing (the session guard's 401)          |
| 2   | `guest.guard.ts:56`                          | the account has no `guests` row: the owner, who skips 3 to 5 (S8)             | `viewer`                                                                                                         | the session guard                                                                                  | guard, `resolveViewer`  | sharing, golden `people-and-sharing`       |
| 3   | `guest.guard.ts:59`                          | a guest's method and path match no `GUEST_ACCESS` rule                        | 403 "Only the owner can do that"                                                                                 | 2; before any route check, an unmounted path's 404 included                                        | guard                   | guest-access, sharing, golden, drift, _ac_ |
| 4   | `guest.guard.ts:61`                          | a bot rule, and the bot is not shared with the guest, or unknown              | 404 "Bot not found"                                                                                              | 3; before the body and task id                                                                     | guard, `canOpenBot`     | sharing, drift, _ac_                       |
| 5   | `guest.guard.ts:65`                          | an upload rule, and the guest does not reach it (unknown or malformed id too) | 404 "Unknown upload"                                                                                             | 3; before the route's 400 "Invalid upload id"                                                      | guard, `canReachUpload` | sharing, _ac_                              |
| 6   | `bots.routes.ts:92`                          | `/events` for a guest                                                         | no `connection` events; activity and `models.changed` still sent                                                 | the stream's snapshot                                                                              | `seesConnections`       | sharing, _ac_                              |
| 7   | `bots.routes.ts:69`, `people.service.ts:149` | `/events` activity for a guest                                                | only a shared bot's chat, by the shares at each event                                                            | the guard                                                                                          | `followsConversation`   | sharing, _ac_                              |
| 8   | `bots.routes.ts:108`                         | `/bots/:id/stream` by a guest                                                 | the follow is not counted as watched (S2)                                                                        | 404 "Bot not found" (`getBot`)                                                                     | `countsAsWatching`      | bots.stream, _ac_                          |
| 9   | `bots.routes.ts:155`                         | a sent attachment the viewer does not reach (`uploadedOrShared`), in order    | 404 `Unknown attachment "<id>"` (the owner reaches all; S14)                                                     | the guard, the body's 400                                                                          | `requireAttachable`     | sharing, s14, _ac_                         |
| 10  | `chats.service.ts:197`                       | a guest's answer with `alwaysAllow` or `grant`                                | 403 "Only the owner can do that"                                                                                 | task id 400, body 400, bot 404; before S5's 400s and the runtime's 409                             | `requireApprovalAnswer` | _ac_                                       |
| 11  | `chats.service.ts:199`                       | a guest's answer, either way, on a vault card                                 | 403 "Only the owner can approve vault use"                                                                       | 10                                                                                                 | `requireApprovalAnswer` | _ac_                                       |
| 12  | `bots.service.ts:243`                        | `POST /bots/:id/read` by a guest                                              | marks their `bot_guests` row, not the bot's; answers the bot row                                                 | 404 "Bot not found"                                                                                | `viewer.kind`           | sharing, _ac_                              |
| 13  | `bots.list.ts:83`                            | `GET /bots` by a guest                                                        | only shared bots, `lastReadAt` and `unread` from their marker                                                    | the guard                                                                                          | `viewer.kind`           | sharing, golden, _ac_                      |
| 14  | `live.router.ts:234`                         | a bot's VNC ticket for a guest                                                | `viewOnly: true`: the bridge drops its input (S2)                                                                | the ticket route's own refusals                                                                    | `watchOnly`             | drift, browser.vnc, rfb-view-only          |
| 15  | `code.routes.ts:129`                         | `/code/status` for a guest                                                    | no `changeCwd`, `bypassPermissions`, `browse`, `findFiles`, `uploads` or `worktrees`                             | the guard                                                                                          | `codeCapabilities`      | code/routes                                |
| 16  | `code.routes.ts:240`, `:242`                 | a guest's thread start or settings with `bypassPermissions`, then with `cwd`  | 403 "Only the owner can turn off permission prompts.", then 403 "Only the owner can choose a working directory." | the body's 400 (settings: the thread's 404 first); before 404 "No such harness" and the mode's 400 | `requireCodeChange`     | code/routes, _ac_                          |
| 17  | `code.routes.ts:476`                         | a guest's asset ref not starting `img:`                                       | 403 "Only the owner can open files from the harness host."                                                       | 404 "No such harness", 400 "ref is required"; before `capability_missing`                          | `requireCodeAsset`      | code/routes, _ac_                          |
| 18  | `people.routes.ts:12`                        | `GET /people/me`                                                              | `{ guest }`                                                                                                      | the guard                                                                                          | `viewer.kind`           | sharing, golden, client u12                |
| 19  | `people.service.ts:94`                       | removing an account with no `guests` row (the owner, or unknown)              | 404 "Guest not found"                                                                                            | the guard's 403, 400 "Invalid userId format"                                                       | `isGuestAccount`        | sharing, _ac_                              |
| 20  | `people.service.ts:112`                      | sharing with an id that has no `guests` row                                   | 400 "Unknown guest"                                                                                              | update: model 400, name 409, links written; create: the bot, which stays made                      | unchanged               | sharing, _ac_                              |
| 21  | `live-access.ts:33`                          | a held stream, viewer or ticket: the account is gone, or a guest's share is   | closed at once; revoked on remove, unshare and delete                                                            | the request's guard                                                                                | unchanged               | live-access, bot-resources                 |
| 22  | `self-improve.store.ts:46`                   | `update_instructions` in a shared chat                                        | refused `shared` (S1)                                                                                            | unattended                                                                                         | unchanged               | self-improve.store                         |
| 23  | `bot-builder.store.ts:31`                    | creating a bot from a shared chat                                             | refused `shared`                                                                                                 | the owner lookup                                                                                   | unchanged               | bot-builder.store                          |
| 24  | `vault.service.ts:375`                       | a vault use in a shared chat                                                  | always asks the owner                                                                                            | the item's policy                                                                                  | unchanged               | vault suites                               |
| 25  | `bots.owner.ts:66`                           | a shared bot                                                                  | memory off, whatever the row says                                                                                | none                                                                                               | unchanged               | sharing                                    |
| 26  | `chats.service.ts:49`                        | a send in a shared chat                                                       | `Name: text`, with `author` (U3)                                                                                 | none                                                                                               | unchanged               | u3, sharing                                |
| 27  | `bots.conversation.ts:216`                   | a shared bot's prompt                                                         | names everyone, the owner first: the first account without a `guests` row (S8)                                   | none                                                                                               | unchanged               | sharing                                    |
| 28  | `bots.conversation.ts:239`                   | a YOLO-by-default bot's new chat                                              | YOLO on, trusting `ownerUserId()` (S8); the gate's `ownerTurn` and the reviewer (S6) judge each turn             | not unattended                                                                                     | unchanged               | bots.routes, reviewer                      |

### 4.5 Client

The wire types live once, in `apps/web/src/shared/api/<area>.ts`. Both the
server's handlers and the client import them, and the hand copies go away.

Step 5.1 did this (naming in `shared/api/common.ts`: a `…Data` type is what a
handler hands to `ok()`, dates as `Date`; the plain name is its `Jsonified`
form the client reads). A handler or service is annotated with its response
type, so a server change that breaks the client fails the typecheck. Request
bodies stay validated by the routes' zod schemas, and
`tests/server/api/wire-types.test.ts` fails the typecheck when a body type is
one its schema would not accept. R13 keeps types out of `client/lib/*-api.ts`.

Where a client hand copy disagreed with what the server sends, the shared
type follows the server and nothing at runtime changed (D9). The
disagreements:

| #   | Wire type (route)                                | The hand copy said                                                                      | The server sends                                                                                                      |
| --- | ------------------------------------------------ | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| W1  | `Bot.modelId` (every route returning a bot)      | `string`                                                                                | `string \| null`: null when the bot runs on the `bot_default` role                                                    |
| W2  | `Bot`                                            | no `chatStartedAt`, `memoryCapturedThrough`, `connectionCapabilities`                   | all three                                                                                                             |
| W3  | `DELETE /bots/:id`, `POST /bots/:id/read`        | untyped                                                                                 | the bot                                                                                                               |
| W4  | `PastChatView.state` (`GET /bots/:id/chats/:id`) | `{ messages, hasMore? }`                                                                | the windowed `ChatState`: also `busy`, `queued`, `cursor`                                                             |
| W5  | `CapabilityInfo.tools[]` (`GET /capabilities`)   | no `unattendedOnly`, `vault`                                                            | the agent package's `ToolInfo`, both optional                                                                         |
| W6  | `BrowserStatus` (`GET /bots/:id/browser`)        | `profile`, `mode`, `scale`, `starting`, `phase`, `error` optional                       | all six, always                                                                                                       |
| W7  | `UploadStatus.meta` (`GET /uploads/:id`)         | all fields optional; no `chars`, `title`, `author`, `valid`, `imagePages`, `suspicious` | the stored extraction meta: `format` and `chars` always (the server itself typed it `Record<string, unknown>`)        |
| W8  | `UploadText` (`GET /uploads/:id/text`)           | `format: string`; entries without `compressedSize`                                      | `format` is the attachment format union; entries are the agent's `AttachmentEntry`                                    |
| W9  | `Routine.done` (every routine route)             | optional                                                                                | always a boolean                                                                                                      |
| W10 | `RoutineRun` (both runs lists)                   | no `requestId`                                                                          | the whole `routine_runs` row, `requestId` included                                                                    |
| W11 | `Connection` (every connection route)            | no `secretRef`                                                                          | `secretRef: string \| null`                                                                                           |
| W12 | `POST /connections/test`                         | tools without `name`; `transport: string`                                               | each tool's server `name`; `transport` is `streamable-http` or `sse`                                                  |
| W13 | `DiscoveredModel` (discover, available, refresh) | no `compat`, `aliases`                                                                  | the models package's `DiscoveredModel`                                                                                |
| W14 | `VaultItemDetail.events` (`GET /vault/items/:h`) | no `itemId`, `taskId`                                                                   | the whole audit row                                                                                                   |
| W15 | `POST /vault/requests/:id/submit`                | `{ filled, savedHandle }`                                                               | also `saveFailed`                                                                                                     |
| W16 | deletes, `cancel`, connection `DELETE`           | `{ deleted: boolean }`, `{ cancelled: boolean }`, `void`                                | `{ deleted: true }`, `{ cancelled: true }`                                                                            |
| W17 | bodies: skills create/update, guest add          | `Partial<Skill>` (any skill field); `NewGuest.name` required                            | the schemas take name, description, body, files, source, sourceUrl, botIds (update: four); a guest's name is optional |
| W18 | server-side only: text columns typed `string`    | the unions the client relied on                                                         | `bots.browserProfile`, `routine_runs.trigger` now `$type` their union; model and vault views cast theirs              |
| W19 | server-side only: `GET /routines` `schedule`     | `Schedule`                                                                              | the stored JSON, unparsed (`unknown`); every write parses it, so the view casts                                       |

W1 also reveals a client quirk, left as it is behind a typed cast: when a bot
is on the default model and no default is set, `ChatComposer` passes null to
the model chip and its "no longer in the model catalog" line names no model
(`ChatComposer.tsx`, `bot-dialog/ProfileSection.tsx`). `FilePreview.statusLabel` reads W7's
meta as `Partial<UploadMeta>`. Test fixtures gained the fields W2, W6, W9 and
W10 add, with values that render the same.

Data fetching settles on one rule:

- **React Query** for request/response resources, which is what the docs
  already say.
- **Zustand** only for live stores: the bot list with its patches, chat
  sessions and the code list.

Step 5.2 moved Tasks, Routines, Skills and Memory onto React Query
(`apps/web/src/client/queries/`), keeping what each page did:

| Page         | Reads                                                                                       | While loading / on failure                                                                                             | Refetches                                                                                                                                                          | Optimistic                                                    | Overlapping answers before                                              |
| ------------ | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Tasks        | `GET /tasks` on mount                                                                       | "Loading…"; "Couldn't load tasks" with Retry, over a loaded list too (tab counts keep it), shown until a retry answers | after add (once the box clears), tick (before the "Task completed" toast; after the error toast when it fails), Undo, delete (after its toast), save (after close) | the tick flips at once; a failed write's refetch puts it back | none guarded: they landed in arrival order                              |
| Routines     | the routines and 10 recent runs on mount, landing together; the editor's bots on every open | skeleton; "Couldn't load routines" with Retry. The editor keeps the last bot list; a failed read offers none           | after each card action, before its toast (the card's busy state covers both); after save, once the editor closed. Each bot list that lands picks the landing bot   | none                                                          | none guarded                                                            |
| Skills       | `GET /skills` on mount                                                                      | "Loading…"; "Couldn't load skills" with Retry; search shows once a non-empty list loaded                               | never: a create opens the new skill                                                                                                                                | none                                                          | none guarded                                                            |
| Skill detail | the skill on mount and on another id (loading again); the bots once per mount               | "Loading…"; "Couldn't load skill" with Back and Retry. A failed bot read shows "No bots yet"                           | never: a save shows its answer and resets the form; a bot tick keeps unsaved edits                                                                                 | the bot tick, replaced by the answer, put back on failure     | the bot read dropped after unmount; an older id's skill could land last |
| Memory       | the store's `loadBots`, then each bot's memories, landing together; each bot's switch once  | skeleton; "Couldn't load memories" with Retry. A switch that cannot be read shows on                                   | after a switch or delete (before its toast), after save (once closed); the switches are never read again                                                           | the switch flips at once, back on failure                     | `loadBots` keeps the newest list (store); memories in arrival order     |

None refetched on focus, reconnect or a timer, retried a failed read or
write, or showed a previous visit's data. So each resource overrides the
shell's defaults (`RESOURCE_QUERY`, `RESOURCE_MUTATION`): `staleTime: 0` and
`gcTime: 0` (every mount fetches and shows its loading state), no
`retry` (the app's one mutation retry included), no focus or reconnect
refetch, and `networkMode: "always"` (offline fails with the offline
sentence instead of pausing). React Query clears a query's error when a retry
starts with no data yet, so `useResource` keeps the last failure until an
answer lands. Writes are plain mutations; the page refetches at the point it
always did, never earlier, and the skill writes only mark the library stale.
The one difference is race-only: a refresh cancels a fetch still in flight,
so the newest request's answer is the one shown, where overlapping requests
used to land in arrival order. The bot editor's skill list (`BotDialog`)
stays with the bot editor.

Step 5.3 moved Connections, Vault and Settings → Models onto the same
resources (`queries/connections.ts`, `queries/vault.ts`, `queries/models.ts`),
keeping what each page did:

| Page                  | Reads                                                                                                                                    | While loading / on failure                                                                                 | Refetches                                                                                                                                                                  | Optimistic                                                                    | Overlapping answers before                                        |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Connections           | `GET /connections` on mount                                                                                                              | "Loading…"; "Couldn't load connections" with Retry, shown until a retry answers                            | on every connection change on the events feed and every finished sign-in                                                                                                   | none                                                                          | none guarded                                                      |
| Connection            | the connection on mount and on another id (loading again, the remove prompt closed); the bots from the live store                        | "Loading…"; "Couldn't load connection" with Back and Retry, over a loaded page too                         | on its own change event; on its sign-in finishing (after the toast); after a failed bot or tool switch (after the error toast). Reconnect and a bot tick show their answer | the bot tick and the tool switch, at once; a failure's refetch puts them back | none guarded: an event's refetch could land after a tick's answer |
| Connection tool       | the tool on mount and on another tool (loading again); the playground runs only on Run, after a confirm when the tool may change data    | "Loading…"; "Couldn't load tool" with Back and Retry; a failed run shows inline and clears the last result | on its connection's change event; after a failed switch                                                                                                                    | the switch, replaced by the answer                                            | none guarded                                                      |
| Add connection        | nothing: Test and Add run on click, Add through step-up, an OAuth popup opened in the click                                              | a failed test shows inline until the next edit                                                             | none: a new connection opens its page                                                                                                                                      | none                                                                          | none guarded                                                      |
| Vault                 | `GET /vault` on mount; Refresh asks `?refresh=1` (the button off while it runs), Retry and every other read do not                       | "Loading…"; "Couldn't load the vault" with Retry                                                           | only on Refresh or Retry: a link opens the linked item                                                                                                                     | none                                                                          | none guarded                                                      |
| Vault item            | the item on mount (the page is keyed by handle); a value only on Reveal or Copy, through step-up, each click a new request               | "Loading…"; "Couldn't load the item", with no action                                                       | after a policy save (unless the handle changed: then it opens the new one) and a value save (dialog closed). Each answer resets the policy form                            | none                                                                          | none guarded                                                      |
| New item              | nothing                                                                                                                                  | a failed save is a toast                                                                                   | none: a save opens the item                                                                                                                                                | none                                                                          | none guarded                                                      |
| Credential request    | the request on mount and on another task id (the last request stays on screen until it lands)                                            | "Loading…"; "Nothing to fill" with the reason                                                              | never: Continue and Cancel go to the bot's chat                                                                                                                            | none                                                                          | an older task's request could land last                           |
| Settings → Models     | the accounts with their templates and the roles on mount, landing together; then the store's model list after every load, failed or not  | nothing until the first load; a failed load is a toast and the last accounts stay                          | after every write: an account switch, check, edit, custom providers or delete; a model add, switch, move or delete; a role; a new account                                  | none                                                                          | none guarded                                                      |
| Add a model (a card)  | what the account's endpoint lists that it lacks, once per open card and again after a check (`available`); an answer after close dropped | "Loading models…"; "Couldn't list the models. Type a model id to add it."                                  | never: an added model leaves the list                                                                                                                                      | none                                                                          | none guarded                                                      |
| Add models, providers | nothing: discover, test and connect run on click, connect and the gateway's providers through step-up                                    | each failure is a toast                                                                                    | none: the page reloads once the dialog is done                                                                                                                             | none                                                                          | none guarded                                                      |

The same overrides apply, and the same race-only difference. Three of these
read in ways the 5.2 pages did not, so `useResource` takes two options: the
vault item resets its policy form to every answer (`structuralSharing: false`,
so an unchanged answer still lands as a new object), the credential request
keeps the last request on screen across task ids (`placeholderData:
keepPreviousData`), and the vault's Refresh reads with `?refresh=1` while every
other fetch of the same resource does not. Settings → Models had no error
state, so its query toasts each failure itself and reloads the store's model
list after each load. Calls that ask a provider (discover, `available`, an
account's check, a model's test) are mutations, never queries a focus or a
timer could repeat; `available` still runs once per mounted card.

Secrets stay out of the cache. A write that sends a key, a password or a
value (a new connection or account, a test with a header secret or key, a
vault item or value, a filled credential request) or answers with one (a
revealed or copied value) is a `useSecretMutation`: `gcTime: 0` and a reset
once it answers, so neither its variables nor its answer outlive the call. A
revealed value lives, as before, only in its row's state, hidden after 30
seconds or on Hide and gone with the page. The step-up prompt
(`components/vault/StepUp`) stays outside React Query: its password stays in
the prompt's state and the token in `vault-api.ts`'s memory, and
`useStepUp().run` still asks once and retries the write once. The bot
editor's connection list (`BotDialog`), the OAuth sign-in
(`lib/connection-auth.ts`) and the Claude plan status (`ClaudePlanStatus`)
are unchanged.

Duplicated client code becomes one piece each:

- Past chats become a read-only mode of the chat session.
- The Browser and Computer pages and panels share one live-view page.
- God components split along their existing internal sections.

Visible markup, roles and labels stay identical, because the verify journeys
and e2e specs select on them.

Step 5.4 made a past chat a read-only mode of the chat session. It is a
session in the same store (`store/chats.ts`, keyed by `pastChatKey`), changed
by the same reducer (a `past-chat` action: the read's window as a snapshot,
its routine cards, its record), paged by the same `loadOlder` and rendered by
the same `ChatSessionTranscript`. `usePastChat` hands it to the pane without
send, stop, withdraw or YOLO. Every way the two render the same messages
stays one explicit flag in `lib/chat-mode.ts` (`LIVE_CHAT`, `PAST_CHAT`):

| #   | What                                                    | Live chat                                                                      | Past chat                                                                                                                  | Kept by                       |
| --- | ------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| P1  | A waiting approval, vault, credentials or takeover card | the card, acting through the owner's actions                                   | no card: the tool row with a clock and "not answered"                                                                      | `ownerActions`                |
| P2  | A waiting Question card                                 | the questionnaire, answered or dismissed                                       | the asked questions, "not answered"                                                                                        | `ownerActions`                |
| P3  | Where the transcript opens                              | the newest read message (`last-anchor`), read messages anchoring for 2 frames  | the newest message (`end`), no anchors                                                                                     | `openAt`, `scrollAnchors`     |
| P4  | A new message at the bottom                             | followed (`autoScroll`)                                                        | not followed                                                                                                               | `autoScroll`                  |
| P5  | "New messages" divider                                  | above the first reply since the last visit                                     | never                                                                                                                      | `unreadDivider`               |
| P6  | No messages                                             | the bot's avatar, name and description, else "Say hi to start…"                | nothing                                                                                                                    | `emptyState`                  |
| P7  | Typing dots                                             | while the bot works with nothing on screen                                     | never                                                                                                                      | `typing`                      |
| P8  | "Reconnecting…" and offline pill                        | after 1 s of a dropped stream, or offline                                      | never: no stream                                                                                                           | `streamHealth`                |
| P9  | First-load spinner                                      | after 300 ms, only over an empty transcript                                    | at once, until the chat is read                                                                                            | `loadingSpinner`              |
| P10 | The transcript content's test id                        | none                                                                           | `past-chat-transcript`                                                                                                     | `contentTestId`               |
| P11 | Echo bubbles, "Waiting to send" rows, the YOLO banner   | from the owner's sends and the stream                                          | none: its handle cannot send, and the pane renders no held rows or banner                                                  | `usePastChat`'s handle        |
| P12 | Older pages                                             | `GET /bots/:id/messages?before=`                                               | `GET /bots/:id/chats/:chatId/messages?before=`; both 50 at a time, a failure retried on the next scroll                    | the session key (`loadOlder`) |
| P13 | Routine cards                                           | the stream's `routine-runs`                                                    | the read's `runs`                                                                                                          | the `past-chat` action        |
| P14 | Where the session comes from                            | the bot stream, reconnecting with a fresh snapshot; opening marks the bot read | one read per mount, dropped on unmount; a failed read toasts "Failed to open the past chat" and goes back to the live chat | `open` / `openPast`           |

Everything else in a message (bubbles, attachments and their preview, tool
rows and groups, peer and hand-off cards, markers, day dividers, "Earlier
messages", the jump-to-latest button) was already the one `Transcript` and
`ChatMessageView` path and stays it. Each pane keeps its own chrome: the live
chat its header (bot menu, live view, New chat), model warning, composer,
file drop, live panels and confirmations; a past chat its header (back,
bot / title, Chat history, Continue and Delete) and footer ("Past chat ·
title", dates and count, Current chat, Continue this chat).

Step 5.5 did the live view. The chat's two panels are one `LivePanel` and the
two pages one `LivePage` (`client/components/live/`), each rendering the
surface it is given; `BrowserPanel`, `ComputerPanel`, `BrowserPage` and
`ComputerPage` only pass theirs. As on the server, every difference between
the old Browser and Computer components is one field of the client's
`LiveSurface` (`live/surface.ts`, the two in `live/surfaces.tsx`), pinned by
`live-panel-surfaces.test.tsx` and `live-page-surfaces.test.tsx` (the element
tree and the markup of every state a mocked status reaches, recorded on the
old components). The panel's:

| Difference                                                   | Browser                                                                                                                                      | Computer                                                                                                                                                    | Field                                       |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Title                                                        | "Browser"                                                                                                                                    | "Computer"                                                                                                                                                  | `panel.title`                               |
| Width                                                        | remembered as `tiny-agents:browser-panel-width`, 640 px at first, through `--browser-panel-width`                                            | `tiny-agents:computer-panel-width`, 720 px, `--computer-panel-width`                                                                                        | `panel.width`                               |
| Resize handle, close                                         | "Resize browser panel" (test id `browser-resize`), "Close browser panel"                                                                     | "Resize computer panel" (no test id), "Close computer panel"                                                                                                | `resizeLabel`, `resizeTestId`, `closeLabel` |
| Status and actions                                           | `GET /bots/:id/browser`, its `driver`, `start` and `DELETE …/browser/profile`                                                                | the `computer` routes                                                                                                                                       | `panel.api`                                 |
| A failed open's toast                                        | "Failed to open the browser"                                                                                                                 | "Failed to open the computer"                                                                                                                               | `panel.startFailed`                         |
| Reset's confirm and toast                                    | "Reset the shared browser?" (every bot on it signed out) or "Reset this bot's browser?"; "Shared browser wiped…" or "Browser profile wiped…" | "Reset the shared computer?" or "Reset this bot's computer?" (files in the home folder stay); "Computer reset; the next session starts a fresh desktop."    | `panel.resetCopy`                           |
| What streams                                                 | an active browser with `mode: "vnc"`; active without it is headless                                                                          | an active desktop                                                                                                                                           | `panel.mode`                                |
| Not set up                                                   | never: the closed state shows before the first status                                                                                        | `configured: false`: "No computer on this server." with the hint, else "The computer is not configured."; nothing before the first status; no link or reset | `panel.setup`                               |
| Header detail                                                | the bot's URL (`browser-url`), only while the browser is headless (a stream shows its own address bar)                                       | none                                                                                                                                                        | `panel.headlessDetail`                      |
| Hand-off titles (the stream's Take control layer, Hand back) | "Click and type in the browser yourself. _bot_ waits."; "Hand the browser back to _bot_"                                                     | "Click and type on the computer yourself. _bot_ waits and sees nothing."; "Hand the computer back to _bot_"                                                 | `takeTitle`, `releaseTitle`                 |
| A bot's takeover request                                     | none                                                                                                                                         | the hand-back reads "I'm done"; a banner "_bot_ asked you: … It sees nothing until you press I'm done." (`computer-takeover-reason`)                        | `panel.takeover`                            |
| Link to the page                                             | "Open in the Browser page", `/browser?profile=shared` or `bot-<id>`, the owner only                                                          | "Open the Computer page", `/computer`, guests too                                                                                                           | `panel.openPage`                            |
| Reset button                                                 | "Reset browser profile", "Close the (shared) browser and wipe its profile…"                                                                  | "Reset computer", "Close the (shared) desktop and wipe its settings…"                                                                                       | `panel.reset`                               |
| Connecting                                                   | "Connecting to the browser…"                                                                                                                 | "Connecting to the computer…"                                                                                                                               | `panel.connecting`                          |
| Headless                                                     | "No live view for this browser." with the `SANDBOX_HOST` note (`browser-headless`)                                                           | never                                                                                                                                                       | `panel.headless`                            |
| Not streaming                                                | a globe; "Setting up the browser on the VM", "Starting the browser", "Couldn't open the browser", "No browser is open.", "Open browser"      | a monitor; "Setting up the computer on the VM", "Starting the computer", "Couldn't open the computer", "The computer is off.", "Open computer"              | `panel.off`                                 |
| A guest's viewer                                             | asks Chrome's window to keep its size (S2)                                                                                                   | has no window to fit                                                                                                                                        | `fitsWindow`                                |
| Test ids                                                     | `browser-…`                                                                                                                                  | `computer-…`                                                                                                                                                | `kind`                                      |

The page's:

| Difference               | Browser                                                                                                                                 | Computer                                                                                                                                      | Field                                   |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Title, description       | "Browser", "The bots' browsers on the sandbox VM…"                                                                                      | "Computer", "The bots' desktops on the sandbox VM…"                                                                                           | `page.title`, `page.description`        |
| Remembered tab           | `tiny-agents:browser-page-profile`                                                                                                      | `tiny-agents:computer-desktop`                                                                                                                | `page.selectedKey`                      |
| `?profile=`              | picks the tab and is remembered; a tab click drops it                                                                                   | ignored                                                                                                                                       | `page.deepLink`                         |
| List and actions         | `GET /browser`, `/browser/:profile/…`                                                                                                   | `GET /computer`, `/computer/:profile/…`                                                                                                       | `page.api`, `items`, `withItems`        |
| No live view here        | `liveView: false`: "No live browser on this server", else "The browser runs headless here."                                             | `configured: false`: "No computer on this server", else "The computer is not configured."                                                     | `available`, `setupHint`, `unavailable` |
| Loading, a failed load   | "Loading browsers…"; "Couldn't load the browsers", else "Failed to load the browsers"                                                   | "Loading desktops…"; "Couldn't load the computer", else "Failed to load the desktops"                                                         | `page.loading`, `page.loadFailed`       |
| A failed open's toast    | "Failed to open the browser"                                                                                                            | "Failed to start the desktop"                                                                                                                 | `page.startFailed`                      |
| Reset's confirm, toast   | "Reset the _label_ browser?", naming the bots a shared one signs out; "Browser reset; it starts fresh next time."                       | "Reset the _label_ desktop?", "for every bot that uses it" past one bot; "Desktop reset; it starts fresh next time."                          | `page.resetCopy`                        |
| Tabs                     | "Browsers"; a bot's own is "own browser"; a failed open turns the dot red                                                               | "Desktops"; "own desktop"; the dot stays grey                                                                                                 | `page.tabs`                             |
| Take control layer       | "Click and type in this browser yourself. Bots on it wait."                                                                             | "Click and type on this desktop yourself. Bots on it wait and see nothing."                                                                   | `page.takeTitle`                        |
| A bot's takeover request | none                                                                                                                                    | a hand ("Needs you") on its tab; while driving, "A bot asked you: … It sees nothing until you hand it back." (`computer-page-takeover`)       | `page.takeover`                         |
| Connecting               | "Connecting to the browser…"                                                                                                            | "Connecting to the desktop…"                                                                                                                  | `page.connecting`                       |
| Headless                 | "This browser is headless", "Bots can use it, but it has no display to show."                                                           | never                                                                                                                                         | `page.headless`                         |
| Not live                 | a globe; "Installing Chrome on the VM", "Starting the browser", "Couldn't start the browser", "This browser is closed.", "Open browser" | a monitor; "Setting up the computer on the VM", "Starting the desktop", "Couldn't start the desktop", "This desktop is off.", "Start desktop" | `page.off`                              |
| Reset button             | "Reset browser", "Close this browser and wipe its profile"                                                                              | "Reset desktop", "Close this desktop and wipe its settings"                                                                                   | `page.reset`                            |
| Apps and Keys menus      | none                                                                                                                                    | Apps (listed when opened, opened by id) and Keys (`DESKTOP_SHORTCUTS`), shown while you drive                                                 | `page.apps`, `page.keys`                |
| The viewer's size        | fits Chrome's window through the page's resize route                                                                                    | scales the fixed desktop                                                                                                                      | `page.api.resize`                       |

The rest was already shared and stays where it was, keyed by `kind` where it
differs: the poll (`useLiveView`: every 1.5s while starting, else 3s; a panel
follows its own status, a page any entry in its list), take control, release,
paste, full screen and the open and reset flows; the keys full screen locks
(`LOCKED_KEYS`, the desktop's adds Ctrl+Q and Alt+F4), the status a reset
leaves and a release answering a takeover (`settle`); and in `VncView` the
viewer (view-only until the owner drives, a guest's always; the ticket's
scale; the desktop's `remoteResize: false`; the browser's window fit; Cmd as
Ctrl on a Mac).

Step 5.6 split the god components along their existing internal sections,
moving code without rewriting it: the same DOM, roles, labels, classes and
order, and effects declared in the same order. Each was pinned first, on the
one-file component, by an element-tree and markup snapshot of every state its
tests and the app reach (`chat-pane-pinned`, `chat-message-view-pinned`,
`bot-dialog-pinned`, `routines-pinned`, `models-settings-pinned`; the live
view's 5.5 pins; `doctor-pages-pinned` for the three React Doctor named).

| Component                                   | Keeps                                                     | Moved to                                                                                                                                                                                                       |
| ------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ChatPane` (543 → 193 lines)                | the chat, sending, the model chip, reset, the frame       | `components/chat-pane/`: the header, the model and YOLO notices, held messages, the file drop, the live views (`useLiveViews` and their tabs), the `?history=1` menu page, the two confirmations               |
| `ChatMessageView` (960 → 65)                | the dispatch by message kind                              | `components/chat-message/`: a person's bubble, the peer cards, an assistant turn, its tool rows and groups, the owner's cards (approval, vault use, credentials, takeover), the shared time, copy and entrance |
| `BotDialog` (755 → 239)                     | the draft, its reset on open, save, delete, the tab frame | `components/bot-dialog/`: the Profile, Tools (a group per toolkit), Skills and Sharing sections, the footer with its delete confirmation, the lists read on open                                               |
| `Routines` (888 → 186)                      | the list, its actions, the editor's open state            | `pages/routines/`: the card, Upcoming and Recent runs, the editor, its schedule fields, the form and its compile step (`routine-form.ts`)                                                                      |
| `ModelsSettings` (967 → 117)                | the page, the account list, the dialogs' open state       | `pages/settings/models/`: an account's card, its actions, model rows, Add a model and Claude plan settings, the Default models card, the edit and move dialogs, `modelOptions`                                 |
| `LivePanel` (375 → 196)                     | the poll, the sizing, the viewer                          | `components/live/`: the header (title and status line, hand-off, tools), the off states; the takeover banner and connecting overlay (`live-parts.tsx`) shared with the page                                    |
| `LivePage` (586 → 231)                      | the poll, the body, the viewer                            | `components/live/`: the tabs and status line, the header actions, the Apps and Keys menus, the off state, the remembered tab (`useSelectedProfile`)                                                            |
| `ConnectionDetail`, `SkillDetail`, `Memory` | the data and its actions                                  | `pages/connections/detail/` and `pages/skills/detail/` (each card, section and prompt); Memory's filter and bot order as pure functions and the bots without memories as a component                           |

Three effects that reset a form when its subject changes stay as they were
(the bot editor's, the routine editor's, the memory editor's): a reset by
`key` would remount the dialog, dropping its close animation, and the
routine editor keeps a reopened edit's unsaved changes, which a remount
would not.

### 4.6 Module boundaries and their enforcers

| Rule                                                                                                | Enforcer                                                           |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Only `packages/agent/src/runtime/**` imports `@earendil-works/pi-durable`                           | new lint rule (R11)                                                |
| `@tiny-agents/sandbox` and `@tiny-agents/models` import neither pi-durable nor `@tiny-agents/agent` | package deps + R11                                                 |
| Toolkits import `ToolCall`, never pi-durable types                                                  | R11                                                                |
| No module-level mutable state in `apps/web/src/server` outside `App`                                | new lint rule (R12), allowlist that shrinks to empty               |
| The coding protocol in claude-worker matches `@tiny-agents/code/contracts`                          | type-level conformance test (Q6)                                   |
| Every client API response type comes from `shared/api`                                              | lint: no `interface`/`type` exports in `client/lib/*-api.ts` (R13) |

## 5. Prototypes run for this design

The prototype scripts are kept outside the repo, in the session scratchpad.
Results:

| #   | Question                                                                                                                              | Result                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Can a flow's HTTP responses, SSE frames and `app.db` rows be recorded deterministically enough to diff after each PR?                 | **Yes.** In-process app, real runtime on the faux model, `FIXED_NOW`, ids normalized by first appearance. Three runs gave byte-identical traces. It also recorded a real quirk: `GET /bots/:id/messages` without `before` returns 400                   |
| P2  | Can the Claude-plan engine keep its transcript durably in the same pi-durable conversation, with idempotent admit, without waking pi? | **Yes.** `tx.appendEntry` with custom kinds plus a `tx.scanEntries` request-id check in one commit. The retry was deduplicated, entries survived a close and reopen, and no pi tasks were created                                                       |
| P3  | Does switching the settle pipeline to a busy → idle edge change behavior?                                                             | **Barely.** A plain turn emits exactly one busy and one idle event, and an abort while idle emits none. The difference only exists when wait counts change after the idle edge, so the switch is gated on a golden for the abort-during-wait flow (C16) |

Not prototyped yet. These are design-level, and their PR proves them:

- the `defineToolkit` typing
- the `LiveSessions` generic
- the `App` root

## 6. How behavior parity is proven

Every rewrite PR must pass all of these. A PR that changes behavior on
purpose is a separate PR that names its signed-off register row, and it
updates only that row's goldens.

1. **Golden traces (`tests/golden/`, new; `pnpm golden:check`).**
   - Scripted flows run in-process for every API area: bots, chat and
     stream, deliveries, routines, memory, tasks, skills, vault, models,
     connections, uploads, code (fake harness), people and guests, live views
     (fake transport), terminal (fake tmux).
   - Each flow records requests and responses, SSE frames, normalized
     `app.db` tables and the `agent.db` transcript and docs.
   - They are recorded once on today's code, in PR 0, and committed.
2. **Characterization tests.** Every register row marked _Preserve_ gets a
   test that pins today's behavior, which proves the quirk is real (several
   are inferred from reading).
3. **The existing suites, unchanged.** That is 2,603 tests plus the SIGKILL
   durability suite. A PR may move a test's imports. Changing an assertion
   needs a register row.
4. **The browser layer.**
   - The verify launcher becomes deterministic. Today it uses the real clock,
     a `Date.now()` stamp in names, the host's TZ and locale, and
     animations.
   - That requires a test-only clock seam in the server (`TINY_AGENTS_FIXED_NOW`, ignored unless faux mode is on) and fixing `full-pass.sh`, which is
     broken today: three journeys are missing from its groups.
   - The ARIA snapshots of the no-infrastructure journeys then become
     goldens.
   - Sandbox, Shelley and Cloudflare journeys run once per phase on a session
     with that infrastructure.

## 7. Proposed definition of done

Your message left this as a placeholder, so here is a concrete proposal to
edit or approve. **Done** means that on the final commit of the rewrite, all
five checks pass:

1. `pnpm verify` exits 0 (all static gates, server and client tests,
   durability included).
2. `pnpm golden:check` exits 0. Every flow matches the PR 0 baseline except
   goldens updated by signed-off register rows.
3. `full-pass.sh --no-infra` passes every journey that needs no sandbox,
   Shelley or Cloudflare key. The infrastructure journeys pass once on a
   `--sandbox --shelley` run, with the evidence attached to the last PR.
4. `pnpm check:old-modules` exits 0: no file on the retired-paths list
   exists, and nothing imports one. The list is in the plan, starting with
   `engines/claude-code/engine.ts` (old transcript), `bots.runtime.ts`
   singletons and the hand-copied `lib/*-api.ts` types. `bots.service.ts`,
   `browser-sessions.ts` and `computer-sessions.ts` stay, narrowed (D13).
5. `pnpm check:dead` (knip) exits 0.

## 8. Rough shape of the plan

The detailed plan comes after approval. Rough shape:

| Phase | Content                                                                                                                                                                    | PRs (est.) |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 0     | Proof harness: golden recorder and flows, characterization tests, deterministic verify, `full-pass.sh` fix, baseline. No production change except the test-only clock seam | 5–7        |
| 1     | `App` composition root. Singletons out. Boot order as declared dependencies                                                                                                | 4–6        |
| 2     | Runtime: one projection, `TurnRunner`, `TurnSettled`, `Conversations`, settle pipeline on edges                                                                            | 6–8        |
| 3     | `defineToolkit`, `LiveSessions`, `VmStack`, `@tiny-agents/sandbox` and `@tiny-agents/models` packages                                                                      | 6–8        |
| 4     | Server domain re-cut: bots/chat split, access, unified live routes, vault values table (Q4)                                                                                | 6–8        |
| 5     | Client: shared wire types, React Query resources, past chats as a session mode, component splits                                                                           | 6–8        |
| 6     | Delete retired modules, add the old-modules gate                                                                                                                           | 1–2        |

Total: roughly 35–50 small PRs. Signed-off behavior fixes interleave as their
own PRs.

**Coordination risk.** This branch's history shows about 59 commits a week.
Feature work in an area being migrated will conflict, so I suggest one of
two options (Q8):

- (a) a soft freeze per phase
- (b) features land on the new module once its area has migrated

## 9. Open questions for you

| #   | Question                                                                                                                                                                                       | My recommendation                                                                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Q1  | Is the groot kit (`packages/core`, `jobs`, `shell`, `ui`) out of scope?                                                                                                                        | Yes. It is synced, and a rewrite forks the boilerplate                                                     |
| Q2  | Should the Claude-plan transcript move into `agent.db` (P2)? That fixes C1, C2 and C4, imports `.claude.json` once and changes Claude-plan behavior (dedupe, queue, `submit` returns on admit) | Yes, as one signed-off change                                                                              |
| Q3  | Should `Conversations` become a real `conversations` table later, or stay a module over today's columns?                                                                                       | Module first. Table only if Phase 2 shows the columns fight it                                             |
| Q4  | Should vault values move from KV + `__index` into a `vault_values` table (fixes C11 and S11), with connection header secrets as vault items?                                                   | Yes, signed off with a data migration                                                                      |
| Q5  | The security-relevant register rows (S1–S14): preserve them during the rewrite and fix them after, or fix them first on today's code?                                                          | Fix S1–S5 first, as small PRs on today's code, so the goldens record the fixed behavior. Preserve the rest |
| Q6  | Claude-worker coding protocol vs `@tiny-agents/code/contracts`: a type conformance test, or a shared contracts package?                                                                        | Conformance test (no package cycle)                                                                        |
| Q7  | Should the client keep separate SSE streams (`/events`, `/code/events`, per chat, per thread) or multiplex onto one?                                                                           | Keep them. It's wire-visible and not a source of bugs                                                      |
| Q8  | How should feature work coexist with the migration?                                                                                                                                            | (b)                                                                                                        |
| Q9  | Definition of done (§7): approve or edit                                                                                                                                                       | as written                                                                                                 |
