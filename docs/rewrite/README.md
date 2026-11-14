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
     `ModelsSettings` 961, `Routines` 903, `BotDialog` 754.
8. **Two data layers on the client, and hand-copied wire types.**
   - About 40% of response types are re-declared in `lib/*-api.ts`.
   - React Query is mounted and documented, but unused.
   - Four fetching patterns coexist, with stale-response handling hand-rolled
     in four places.

Two smaller ones:

- `packages/agent` holds about 1,100 lines of provider catalog and discovery
  and the whole sandbox/VM layer, none of which touches pi-durable.
- Secrets live in KV plus a hand-kept `__index` and a sidecar digest, which
  weakens policy binding (S11).

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
  yolo: { get(ref): Promise<YoloState>; set(ref, on: boolean, by: string): Promise<void> };

  activity: { busy(): ConversationRef[]; on(l: (e: ActivityEvent) => void): Unsubscribe };
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
  live: { browser: LiveSessions<BrowserSession>; computer: LiveSessions<Desktop> };
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
type Viewer =
  | { kind: "owner"; userId: number }
  | { kind: "guest"; userId: number; bots: ReadonlySet<string> };
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

### 4.5 Client

The wire types live once, in `apps/web/src/shared/api/<area>.ts`. Both the
server's handlers and the client import them, and the hand copies go away.

Data fetching settles on one rule:

- **React Query** for request/response resources, which is what the docs
  already say.
- **Zustand** only for live stores: the bot list with its patches, chat
  sessions and the code list.

Duplicated client code becomes one piece each:

- Past chats become a read-only mode of the chat session.
- The Browser and Computer pages and panels share one live-view page.
- God components split along their existing internal sections.

Visible markup, roles and labels stay identical, because the verify journeys
and e2e specs select on them.

### 4.6 Module boundaries and their enforcers

| Rule                                                                                                | Enforcer                                                     |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Only `packages/agent/src/runtime/**` imports `@earendil-works/pi-durable`                           | new lint rule (R11)                                          |
| `@tiny-agents/sandbox` and `@tiny-agents/models` import neither pi-durable nor `@tiny-agents/agent` | package deps + R11                                           |
| Toolkits import `ToolCall`, never pi-durable types                                                  | R11                                                          |
| No module-level mutable state in `apps/web/src/server` outside `App`                                | new lint rule (R12), allowlist that shrinks to empty         |
| The coding protocol in claude-worker matches `@tiny-agents/code/contracts`                          | type-level conformance test (Q6)                             |
| Every client API response type comes from `shared/api`                                              | lint: no `interface`/`type` exports in `client/lib/*-api.ts` |

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
