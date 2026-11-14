/**
 * Claude plan engine (ADR 0008, ADR 0014, ADR 0018). Turns go to the worker
 * over the Worker connection (`client.ts` puts the bot protocol on it). The
 * kill switch is the Claude plan account, read on each turn: turning it off
 * does not redeploy or stop the worker.
 *
 * The transcript is durable: each message is admitted as a `claude.user`
 * entry in the conversation's own pi-durable conversation, and each turn's
 * reply is written as `claude.assistant` entries (`transcript.ts`). Turns
 * run one at a time per conversation; a message sent while one runs waits
 * for the next. Which conversations run here (and which left for pi, and
 * their Claude session ids) is the `tiny.claude-plan` document. Tool calls
 * go through the runtime's Tool gate; their Owner waits stay in memory.
 */
import { readFile, rename } from "node:fs/promises";
import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  defineDoc,
  type ConversationId,
  type EntryRecord,
  type Harness,
  type ToolExecutionResult,
  type ToolRegistration,
} from "@earendil-works/pi-durable";
import type { ToolResultPayload, ToolSpec, WorkerMessage } from "@tiny-agents/claude-worker";
import { z } from "zod";
import { gateHooksOf } from "../../approvals";
import type { ToolPermission } from "../../capabilities";
import {
  type AgentEngine,
  type ClaudeEngineFallback,
  type ClaudePlanState,
  type CompiledConversation,
  type EngineSubmission,
} from "../../engine";
import { ToolGate } from "../../gate";
import { finishedToolRow, liveToolRow, type ToolCallRow } from "../../tool-call-row";
import { gateUserMessages, windowChat } from "../../transcript";
import type {
  ChatEvent,
  ChatMessage,
  ChatState,
  ChatSubscription,
  ChatToolCall,
  ConversationRef,
  QueuedMessage,
  WithdrawOutcome,
} from "../../types";
import { WaitTracker } from "../../waiting";
import { loadHistory } from "../../conversation-store";
import { ClaudeWorkerClient, type ToolUseCall, type WebSocketLike } from "./client";
import { pauseMessage } from "./errors";
import { noWorkerLocator, type ClaudeWorkerLocator } from "./sandbox-worker";
import { claudeToolApi } from "./tools";
import {
  admittedRequestId,
  claudeMessages,
  claudeRecordOf,
  legacyEntries,
  legacyFileSchema,
  replyEntry,
  settleToolCalls,
  userEntry,
  withdrawnEntry,
  type ClaudeRecord,
  type ClaudeReply,
  type LegacySession,
} from "./transcript";

const ctx: Context = BACKGROUND_CONTEXT;

/** How a turn the worker was running when it restarted ends. */
export const WORKER_RESTARTED =
  "The Claude worker restarted and this reply was cut off. Send your message again to continue.";

/** How a turn ends when the conversation's bot settings were never applied in this process. */
const NOT_CONFIGURED = "This bot's settings are not loaded yet. Send your message again.";

/** Claude plan calls are numbered from here per conversation, apart from pi's task ids. */
const TASK_ID_BASE = 2_000_000_000;

/** Newest entries an admit searches for its request id, inside the admitting commit. */
const ADMIT_LOOKBACK = 200;

/**
 * How often a call waiting on the owner tells the worker so (register C3):
 * well inside the worker's tool result timeout (120s by default), so a wait
 * of any length never times out while the app is there to answer it.
 */
export const OWNER_WAIT_KEEPALIVE_MS = 30_000;

/**
 * The Claude plan conversations of this store: each one's Claude session id
 * (the next turn resumes it), and `left` once it moved onto pi for good (a
 * gateway fallback, or its bot left the Claude plan model; register C6).
 * `imported`: the old `.claude.json` file's transcripts are already entries.
 */
const ClaudePlanDoc = defineDoc<{
  conversations: Record<string, { left?: boolean; claudeSessionId?: string }>;
  imported?: boolean;
}>({
  kind: "tiny.claude-plan",
  version: 1,
  scope: "session",
  initial: () => ({ conversations: {} }),
  checkpointWhen: () => false,
});

export interface ClaudeSessionSync {
  model: string;
  system: string;
  tools: ToolSpec[];
  /** Every enabled tool's permission; the gate reads the stored ones, this says which are off. */
  permissions: Record<string, ToolPermission>;
  /** What runs once the Tool gate lets a call through, by tool name. */
  runners?: ReadonlyMap<string, ToolRegistration>;
}

export interface ClaudeCodeEngineOptions {
  /** The durable store: transcripts are entries of its conversations. Required to run or read one. */
  harness?: Harness;
  /** The Claude plan account's switch and fallback, read on each turn. Default: off, pause. */
  plan?: () => ClaudePlanState;
  /** The old engine's JSON file, imported once at `start()` and then renamed `.imported`. */
  legacyPath?: string;
  onBusy?: (ref: ConversationRef, busy: boolean) => void;
  /**
   * A queued turn found the worker unreachable (or the plan off) and the
   * fallback is the gateway: the conversation left the Claude plan, and this
   * hands the message to pi.
   */
  fallback?: (ref: ConversationRef, input: EngineSubmission) => Promise<void>;
  /** Non-fatal errors (a write that failed, an import that could not be read). */
  onReport?: (error: unknown) => void;
  /** Every tool call Claude asks for goes through it. Default: a gate of its own (tests). */
  gate?: ToolGate;
  /** When set, tests skip the real socket. */
  connect?: (url: string, token: string) => WebSocketLike;
  /** The worker on the sandbox, set up over SSH on first use. */
  worker?: ClaudeWorkerLocator;
}

interface Listener {
  ref: ConversationRef;
  listener: (events: ChatEvent[]) => void | Promise<void>;
  window?: number;
}

/** The turn running now: its reply streams here and is written when it ends. */
interface LiveTurn {
  turnId: string;
  reply: ClaudeReply;
  /** Handed to the connection (it may wait there for the socket). */
  sent: boolean;
  /** The turn went out on an open socket (false: it waits in the connection's queue). */
  dispatched: boolean;
  /** Ended: later worker events and tool rows for it are ignored (register C2). */
  closed: boolean;
  /** Calls waiting on the owner, with the timer that tells the worker so. */
  waits: Map<string, ReturnType<typeof setInterval>>;
}

/** What the store says about a conversation (the `tiny.claude-plan` entry). */
interface Stored {
  left: boolean;
  claudeSessionId?: string;
}

interface ClaudeSession {
  model: string;
  system: string;
  tools: ToolSpec[];
  permissions: Record<string, ToolPermission>;
  runners: ReadonlyMap<string, ToolRegistration>;
  /** A configure ran in this process (after a restart, only reads may come first). */
  configured: boolean;
  claudeSessionId?: string;
  /** `pi` once the conversation left the Claude plan (`leave()`): later turns run on pi. */
  surface: "claude" | "pi";
  /** What the store holds for it; undefined until written. */
  stored?: Stored;
  /** The `claude.*` records, loaded once, then kept as this engine writes them. */
  records?: Promise<ClaudeRecord[]>;
  /** Admitted messages waiting for their turn, in order. */
  queue: EngineSubmission[];
  /** Messages taken off the queue whose `claude.withdrawn` entry is not written yet. */
  withdrawing: Set<string>;
  live?: LiveTurn;
  nextTask: number;
  busy: boolean;
  /** Every write of this conversation, in order. */
  writes: Promise<unknown>;
}

export class ClaudeCodeEngine implements AgentEngine {
  readonly kind = "claude-code" as const;
  private readonly sessions = new Map<ConversationRef, ClaudeSession>();
  private readonly listeners = new Set<Listener>();
  private client: ClaudeWorkerClient | undefined;
  private readonly plan: () => ClaudePlanState;
  private readonly gate: ToolGate;
  /** Writes to the `tiny.claude-plan` document, in order. */
  private docWrites: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: ClaudeCodeEngineOptions) {
    this.plan = options.plan ?? (() => ({ enabled: false, fallback: "pause" }));
    this.gate = options.gate ?? new ToolGate({ approvals: new WaitTracker() });
  }

  /**
   * Learn which conversations run here from the store, after importing the
   * old JSON file once. Before the first read: reads after a restart go to
   * the Claude plan transcript, not pi's (register C4).
   */
  async start(): Promise<void> {
    if (!this.options.harness) return;
    await this.importLegacy();
    const doc = await this.harness.snapshot(ClaudePlanDoc, ctx);
    for (const [key, value] of Object.entries(doc?.conversations ?? {})) {
      const ref = Number(key);
      if (!Number.isFinite(ref) || this.sessions.has(ref)) continue;
      const stored: Stored = {
        left: value.left === true,
        ...(value.claudeSessionId ? { claudeSessionId: value.claudeSessionId } : {}),
      };
      const session = this.blank();
      session.surface = stored.left ? "pi" : "claude";
      session.stored = stored;
      if (stored.claudeSessionId) session.claudeSessionId = stored.claudeSessionId;
      this.sessions.set(ref, session);
    }
  }

  runs(ref: ConversationRef): boolean {
    return this.sessions.get(ref)?.surface === "claude";
  }

  /**
   * Take the Claude plan part of the conversation's config. Without one the
   * bot left the Claude plan model, and later turns run on pi. A
   * conversation that left (or fell back to the gateway) stays left.
   */
  async configure(
    ref: ConversationRef,
    compiled: Pick<CompiledConversation, "claude">,
  ): Promise<void> {
    const info = compiled.claude;
    if (!info) {
      await this.leave(ref);
      return;
    }
    const session = this.ensure(ref);
    session.model = info.model;
    session.system = info.system;
    session.tools = info.tools;
    session.permissions = info.permissions;
    session.runners = info.runners ?? new Map();
    session.configured = true;
    await this.remember(ref, session);
  }

  /** The conversation leaves the Claude plan for good: its turns run on pi from now on. */
  private async leave(ref: ConversationRef): Promise<void> {
    const session = this.sessions.get(ref);
    if (!session || session.surface === "pi") return;
    session.surface = "pi";
    await this.remember(ref, session);
  }

  busy(ref: ConversationRef): boolean {
    return this.sessions.get(ref)?.busy === true;
  }

  /**
   * Durably admit a message and return; its turn runs after the ones before
   * it. Retrying a request id never admits it twice. A steer cannot join a
   * running Claude Code turn (the worker runs one turn at a time), so it
   * waits like a follow-up. `unavailable`: the plan is off and the fallback
   * is the gateway, so the conversation leaves the Claude plan for good and
   * the runtime hands the message to pi. With the `pause` fallback the
   * message is admitted and answered with a pause.
   */
  async submit(ref: ConversationRef, input: EngineSubmission): Promise<"accepted" | "unavailable"> {
    const session = this.sessions.get(ref);
    if (!session || session.surface !== "claude") return "unavailable";
    const { enabled, fallback } = this.plan();
    if (!enabled && fallback === "gateway") {
      await this.leave(ref);
      return "unavailable";
    }
    const paused = enabled
      ? undefined
      : pauseMessage("The Claude plan is turned off (Settings → Models).");
    return this.write(ref, session, async (records): Promise<"accepted"> => {
      if (records.some((r) => r.kind === "user" && r.data.requestId === input.requestId)) {
        return "accepted";
      }
      const user = {
        requestId: input.requestId,
        text: input.text,
        createdAt: Date.now(),
        ...(input.peer ? { peer: input.peer } : {}),
        ...(input.author ? { author: { id: input.author.id, name: input.author.name } } : {}),
        ...(input.attachments?.length ? { attachments: input.attachments } : {}),
      };
      const pause: ClaudeReply | undefined = paused
        ? {
            turnId: input.requestId,
            text: "",
            status: "error",
            error: paused,
            createdAt: Date.now(),
          }
        : undefined;
      const appended = await this.harness.commit(async (tx) => {
        const recent = await tx.scanEntries(
          { conversationId: ref as ConversationId, order: "descending" },
          ADMIT_LOOKBACK,
        );
        if (recent.items.some((entry) => admittedRequestId(entry) === input.requestId)) return [];
        const added = [await tx.appendEntry(ref as ConversationId, userEntry(user))];
        if (pause) added.push(await tx.appendEntry(ref as ConversationId, replyEntry(pause)));
        return added;
      }, ctx);
      for (const entry of appended) {
        const record = this.recordOf(entry);
        if (record) records.push(record);
      }
      if (appended.length === 0 || pause) {
        this.emit(ref);
        return "accepted";
      }
      session.queue.push(input);
      this.setBusy(ref, session, true);
      this.emit(ref);
      this.pump(ref, session);
      return "accepted";
    });
  }

  /** Stop the running turn and withdraw the messages waiting for one. */
  async abort(ref: ConversationRef): Promise<void> {
    const session = this.sessions.get(ref);
    if (!session) return;
    const queued = session.queue.splice(0);
    if (queued.length > 0) {
      await this.withdrawn(
        ref,
        session,
        queued.map((input) => input.requestId),
      );
    }
    const live = session.live;
    if (live && !live.closed) {
      this.client?.send({ type: "abort", sessionId: String(ref) });
      await this.finish(ref, session, live.turnId, "stopped");
      return;
    }
    if (!session.live && session.busy) {
      this.setBusy(ref, session, false);
      this.emit(ref);
    }
  }

  /**
   * Withdraw a message by its request id: one still waiting for its turn
   * leaves the queue (and the transcript); the running one is already
   * placed; one answered is settled.
   */
  async withdraw(ref: ConversationRef, requestId: string): Promise<WithdrawOutcome> {
    const session = this.sessions.get(ref);
    if (!session) return "not_found";
    const index = session.queue.findIndex((input) => input.requestId === requestId);
    if (index >= 0) {
      session.queue.splice(index, 1);
      await this.withdrawn(ref, session, [requestId]);
      return "withdrawn";
    }
    if (session.live?.turnId === requestId && !session.live.closed) return "already_placed";
    const records = await this.records(ref, session);
    if (records.some((r) => r.kind === "withdrawn" && r.requestIds.includes(requestId))) {
      return "withdrawn";
    }
    return records.some((r) => r.kind === "user" && r.data.requestId === requestId)
      ? "settled"
      : "not_found";
  }

  /** The conversation's user messages, newest first, as the Tool gate reads them. */
  async userMessages(ref: ConversationRef) {
    const session = this.sessions.get(ref);
    if (!session) return [];
    return gateUserMessages(await this.messages(ref, session));
  }

  async read(ref: ConversationRef): Promise<ChatState> {
    const session = this.require(ref);
    return this.state(session, await this.messages(ref, session));
  }

  /**
   * Unlike pi's stream, each change is a whole snapshot, windowed afresh to
   * the newest messages (the window's start does not stay put).
   */
  async watch(
    ref: ConversationRef,
    listener: (events: ChatEvent[]) => void | Promise<void>,
    { window }: { window?: number } = {},
  ): Promise<ChatSubscription> {
    const session = this.require(ref);
    const initial = this.state(session, await this.messages(ref, session), window);
    const entry: Listener = { ref, listener, window };
    this.listeners.add(entry);
    void listener([{ type: "snapshot", state: initial }]);
    return {
      initial,
      stop: async () => {
        this.listeners.delete(entry);
      },
    };
  }

  /** The sandbox worker, or none when no sandbox is configured. */
  private locator(): ClaudeWorkerLocator {
    return this.options.worker ?? noWorkerLocator;
  }

  /** Stop the socket and the keepalives, and let the writes already started land. */
  async close(): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.live) this.stopWaits(session.live);
    }
    this.client?.close();
    this.options.worker?.close();
    await Promise.allSettled([
      this.docWrites,
      ...[...this.sessions.values()].map((session) => session.writes),
    ]);
  }

  // ── Turns ─────────────────────────────────────────────────────────────

  /** Start the next waiting turn, unless one runs; idle once none waits. */
  private pump(ref: ConversationRef, session: ClaudeSession): void {
    if (session.live) return;
    const next = session.queue.shift();
    if (!next) {
      if (session.busy) {
        this.setBusy(ref, session, false);
        this.emit(ref);
      }
      return;
    }
    void this.runTurn(ref, session, next).catch((error: unknown) => this.report(error));
  }

  private async runTurn(
    ref: ConversationRef,
    session: ClaudeSession,
    input: EngineSubmission,
  ): Promise<void> {
    const turnId = input.requestId;
    const live: LiveTurn = {
      turnId,
      reply: {
        turnId,
        text: "",
        status: "streaming",
        ...(session.model ? { model: session.model } : {}),
        createdAt: Date.now(),
      },
      sent: false,
      dispatched: false,
      closed: false,
      waits: new Map(),
    };
    session.live = live;
    this.emit(ref);
    if (session.surface !== "claude") {
      await this.handOff(ref, session, live, input);
      return;
    }
    const { enabled, fallback, maxTurns } = this.plan();
    if (!enabled) {
      await this.unavailable(
        ref,
        session,
        live,
        input,
        fallback,
        "The Claude plan is turned off (Settings → Models).",
      );
      return;
    }
    if (!session.configured) {
      await this.finish(ref, session, turnId, "error", NOT_CONFIGURED);
      return;
    }
    try {
      // Sets the worker up when needed; the connection resolves it again on every reconnect.
      await this.locator().resolve();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await this.unavailable(ref, session, live, input, fallback, detail);
      return;
    }
    if (live.closed) return;
    const worker = this.worker();
    worker.track(String(ref));
    live.sent = true;
    live.dispatched = worker.send({
      type: "turn",
      sessionId: String(ref),
      turnId,
      text: input.text,
      model: session.model,
      system: session.system,
      ...(session.claudeSessionId ? { resume: session.claudeSessionId } : {}),
      tools: session.tools,
      ...(input.images?.length ? { images: input.images } : {}),
      ...(maxTurns ? { maxTurns } : {}),
    });
  }

  /** The turn cannot run on the Claude plan: pause it, or hand it to pi (gateway fallback). */
  private async unavailable(
    ref: ConversationRef,
    session: ClaudeSession,
    live: LiveTurn,
    input: EngineSubmission,
    fallback: ClaudeEngineFallback,
    detail: string,
  ): Promise<void> {
    if (fallback === "gateway") {
      await this.leave(ref);
      await this.handOff(ref, session, live, input);
      return;
    }
    await this.finish(ref, session, live.turnId, "error", pauseMessage(detail));
  }

  /** The conversation left the Claude plan: this message (and every one after it) goes to pi. */
  private async handOff(
    ref: ConversationRef,
    session: ClaudeSession,
    live: LiveTurn,
    input: EngineSubmission,
  ): Promise<void> {
    live.closed = true;
    session.live = undefined;
    const rest = [input, ...session.queue.splice(0)];
    for (const message of rest) {
      try {
        // eslint-disable-next-line react-doctor/async-await-in-loop -- pi admits them in order
        await this.options.fallback?.(ref, message);
      } catch (error) {
        this.report(error);
      }
    }
    // pi has them now: the Claude plan's part of the conversation is idle.
    this.setBusy(ref, session, false);
    this.emit(ref);
  }

  /**
   * End the running turn once: its reply is written with its final status,
   * and anything the worker sends for it later is ignored. Then the next
   * waiting turn starts, or the conversation goes idle.
   */
  private async finish(
    ref: ConversationRef,
    session: ClaudeSession,
    turnId: string,
    status: "done" | "error" | "stopped",
    error?: string,
  ): Promise<void> {
    const live = session.live;
    if (!live || live.turnId !== turnId || live.closed) return;
    live.closed = true;
    this.stopWaits(live);
    const toolCalls = settleToolCalls(
      live.reply.toolCalls,
      status === "stopped" ? "aborted" : "interrupted",
    );
    const reply: ClaudeReply = {
      ...live.reply,
      status,
      ...(error ? { error } : {}),
      ...(toolCalls ? { toolCalls } : {}),
    };
    live.reply = reply;
    await this.appendReply(ref, session, reply);
    session.live = undefined;
    const more = session.queue.length > 0;
    if (!more) session.busy = false;
    // A call still waiting on the owner belongs to the turn that ended.
    this.gate.abandon(ref);
    if (!more) this.options.onBusy?.(ref, false);
    this.emit(ref);
    this.pump(ref, session);
  }

  /** Write a reply (a turn's end, or mid-turn once a tool call finished). */
  private async appendReply(
    ref: ConversationRef,
    session: ClaudeSession,
    reply: ClaudeReply,
  ): Promise<void> {
    const snapshot = structuredClone(reply);
    await this.write(ref, session, async (records) => {
      try {
        const entry = await this.harness.commit(
          (tx) => tx.appendEntry(ref as ConversationId, replyEntry(snapshot)),
          ctx,
        );
        const record = this.recordOf(entry);
        if (record) records.push(record);
      } catch (error) {
        // The chat still shows it until a restart; the store failing is the host's to handle.
        records.push({ kind: "reply", data: snapshot });
        this.report(error);
      }
    });
  }

  /** Record queued messages withdrawn before their turn ran (already off the queue). */
  private async withdrawn(
    ref: ConversationRef,
    session: ClaudeSession,
    requestIds: string[],
  ): Promise<void> {
    for (const id of requestIds) session.withdrawing.add(id);
    try {
      await this.write(ref, session, async (records) => {
        const entry = await this.harness.commit(
          (tx) => tx.appendEntry(ref as ConversationId, withdrawnEntry(requestIds)),
          ctx,
        );
        const record = this.recordOf(entry);
        if (record) records.push(record);
      });
    } catch (error) {
      // Withdrawn all the same in this process; a restart shows them unanswered.
      this.report(error);
      return;
    }
    for (const id of requestIds) session.withdrawing.delete(id);
    this.emit(ref);
  }

  /** One connection for the engine's life; it finds the worker again on every reconnect. */
  private worker(): ClaudeWorkerClient {
    this.client ??= new ClaudeWorkerClient({
      resolveTarget: () => this.locator().resolve(),
      ...(this.options.connect ? { connect: this.options.connect } : {}),
      onEvent: (message) => this.onWorker(message),
      onTool: (call) => this.onTool(call),
      onConnected: (rebooted) => this.onConnected(rebooted),
    });
    return this.client;
  }

  /**
   * After every (re)connect, before queued turns go out. A worker that
   * restarted lost the turns it was running: they end now, with an error the
   * owner can see, instead of waiting forever. The conversation keeps its
   * Claude session id, so the next turn resumes it. Turns still queued go to
   * the new worker.
   */
  private onConnected(rebooted: boolean): void {
    for (const [ref, session] of this.sessions) {
      const live = session.live;
      if (!live?.sent || live.closed) continue;
      if (rebooted && live.dispatched) {
        void this.finish(ref, session, live.turnId, "error", WORKER_RESTARTED);
        continue;
      }
      live.dispatched = true;
    }
  }

  /**
   * Claude asks for a tool: the call goes through the Tool gate like a pi
   * call, with its answer held by the gate (a Claude call does not survive
   * a restart). Its row in the chat is the one a pi call gets: projected
   * from the details it publishes while it runs (any Owner wait's card),
   * then from its result. A call of a turn that already ended does not run.
   */
  private async onTool(call: ToolUseCall): Promise<ToolResultPayload> {
    const ref = Number(call.sessionId);
    const session = this.sessions.get(ref);
    if (!session) return { content: "Unknown conversation.", isError: true };
    const live = session.live;
    if (!live || live.turnId !== call.turnId || live.closed) {
      return { content: "This reply has ended.", isError: true };
    }
    const args = asRecord(call.input);
    const row = (fields: ToolCallRow) => {
      if (live.closed) return;
      const tool: ChatToolCall = { id: call.toolUseId, name: call.name, args, ...fields };
      upsertTool(live.reply, tool);
      this.ownerWait(ref, live, call.toolUseId, tool.status);
      this.emit(ref);
    };
    const finished = (fields: ToolCallRow) => {
      row(fields);
      // A tool round finished: what the turn has so far survives a restart.
      if (!live.closed) void this.appendReply(ref, session, live.reply);
    };
    const failed = (content: string): ToolResultPayload => {
      finished(finishedToolRow({ output: content, isError: true }));
      return { content, isError: true };
    };
    row(liveToolRow({ status: "running" }));
    if (session.permissions[call.name] === "off")
      return failed(`${call.name} is off for this bot.`);
    session.nextTask += 1;
    const taskId = session.nextTask;
    // As on pi, a result without details keeps the last ones the call published.
    let published: unknown;
    const api = claudeToolApi({
      name: call.name,
      conversation: ref,
      task: taskId,
      docs: this.harness,
      details: (value) => {
        published = value;
        row(liveToolRow({ status: "running", taskId, details: value }));
      },
    });
    const runner = session.runners.get(call.name);
    try {
      const result = await this.gate.run(
        {
          name: call.name,
          args,
          replaySafe: runner?.replay === "safe",
          hooks: runner ? gateHooksOf(runner) : undefined,
          api,
          context: ctx,
          answers: "memory",
          userMessages: () => this.userMessages(ref),
          instructions: async () => session.system || undefined,
        },
        async () => {
          row(liveToolRow({ status: "running", taskId }));
          if (!runner) return unavailable(call.name);
          return runner.execute(args, api, ctx);
        },
      );
      const content = resultText(result);
      // The Claude plan does not time its calls: the row has no duration.
      finished(
        finishedToolRow({
          output: content,
          details: result.details ?? published,
          ...(result.isError ? { isError: true } : {}),
          ...(result.diagnostics ? { diagnostics: result.diagnostics } : {}),
        }),
      );
      return { content, ...(result.isError ? { isError: true } : {}) };
    } catch (error) {
      return failed(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * While a call waits on the owner, tell the worker now and then, so its
   * tool result timeout does not end a wait the owner may still answer
   * (register C3). Stops when the call moves on or the turn ends.
   */
  private ownerWait(
    ref: ConversationRef,
    live: LiveTurn,
    toolUseId: string,
    status: ChatToolCall["status"],
  ): void {
    const waiting = status.startsWith("awaiting_");
    const timer = live.waits.get(toolUseId);
    if (!waiting) {
      if (timer) clearInterval(timer);
      live.waits.delete(toolUseId);
      return;
    }
    if (timer) return;
    const tell = () =>
      this.client?.send({ type: "tool_waiting", sessionId: String(ref), toolUseId });
    tell();
    const next = setInterval(tell, OWNER_WAIT_KEEPALIVE_MS);
    next.unref?.();
    live.waits.set(toolUseId, next);
  }

  private stopWaits(live: LiveTurn): void {
    for (const timer of live.waits.values()) clearInterval(timer);
    live.waits.clear();
  }

  private onWorker(message: WorkerMessage): void {
    if (message.type === "error") {
      const ref = Number(message.sessionId);
      const session = this.sessions.get(ref);
      const live = session?.live;
      if (session && live && (!message.turnId || message.turnId === live.turnId)) {
        void this.finish(ref, session, live.turnId, "error", message.message);
      }
      return;
    }
    if (message.type !== "event") return;
    const ref = Number(message.sessionId);
    const session = this.sessions.get(ref);
    if (!session) return;
    const event = message.event;
    if (event.type === "session") {
      if (session.claudeSessionId === event.claudeSessionId) return;
      session.claudeSessionId = event.claudeSessionId;
      void this.remember(ref, session);
      return;
    }
    // Only the running turn's events count: a stopped turn stays stopped.
    const live = session.live;
    if (!live || live.closed || !("turnId" in event) || event.turnId !== live.turnId) return;
    if (event.type === "text") {
      live.reply.text = event.text;
      this.emit(ref);
      return;
    }
    if (event.type === "usage_pause") {
      void this.finish(
        ref,
        session,
        live.turnId,
        "error",
        pauseMessage(`Usage-credit guard: ${event.reason}.`),
      );
      return;
    }
    if (event.type === "turn_end") {
      void this.finish(
        ref,
        session,
        live.turnId,
        event.stopReason === "end_turn" ? "done" : "error",
        event.error,
      );
    }
  }

  // ── Transcript ────────────────────────────────────────────────────────

  private async messages(ref: ConversationRef, session: ClaudeSession): Promise<ChatMessage[]> {
    const records = await this.records(ref, session);
    return claudeMessages(records, {
      ...(session.live ? { reply: session.live.reply } : {}),
      queued: new Set([...session.queue.map((input) => input.requestId), ...session.withdrawing]),
    });
  }

  /** A transcript that fits its window is sent whole, with no `hasMore` or `cursor`. */
  private state(session: ClaudeSession, messages: ChatMessage[], window?: number): ChatState {
    const state = { messages, busy: session.busy, queued: this.queued(session) };
    return window && messages.length > window ? windowChat(state, window)! : state;
  }

  /** Messages waiting for their turn, as the owner's held messages (a peer delivery is not one). */
  private queued(session: ClaudeSession): QueuedMessage[] {
    return session.queue
      .filter((input) => !input.peer)
      .map((input) => ({
        requestId: input.requestId,
        mode: "followUp" as const,
        text: input.text,
        ...(input.author ? { author: input.author } : {}),
      }));
  }

  private emit(ref: ConversationRef): void {
    const session = this.sessions.get(ref);
    if (!session || ![...this.listeners].some((entry) => entry.ref === ref)) return;
    void this.messages(ref, session)
      .then((messages) => {
        for (const entry of this.listeners) {
          if (entry.ref !== ref) continue;
          void entry.listener([
            { type: "snapshot", state: this.state(session, messages, entry.window) },
          ]);
        }
      })
      .catch((error: unknown) => this.report(error));
  }

  /** The conversation's `claude.*` records, loaded from the store once. */
  private records(ref: ConversationRef, session: ClaudeSession): Promise<ClaudeRecord[]> {
    session.records ??= this.load(ref);
    return session.records;
  }

  private async load(ref: ConversationRef): Promise<ClaudeRecord[]> {
    const conversation = await this.harness.conversation(ref as ConversationId, ctx);
    if (!conversation) return [];
    return (await loadHistory(conversation)).flatMap((entry) => this.recordOf(entry) ?? []);
  }

  /** A stored entry as a record; one that does not fit its shape is reported and skipped. */
  private recordOf(entry: Pick<EntryRecord, "kind" | "data">): ClaudeRecord | undefined {
    try {
      return claudeRecordOf(entry);
    } catch (error) {
      this.report(error);
      return undefined;
    }
  }

  /**
   * Run a change of the conversation's transcript after the ones before it,
   * with its records loaded first (so a load never misses or doubles a write).
   */
  private write<T>(
    ref: ConversationRef,
    session: ClaudeSession,
    change: (records: ClaudeRecord[]) => Promise<T>,
  ): Promise<T> {
    const run = session.writes.then(async () => change(await this.records(ref, session)));
    session.writes = run.catch(() => undefined);
    return run;
  }

  /** Keep the `tiny.claude-plan` entry in step with the session (left, Claude session id). */
  private async remember(ref: ConversationRef, session: ClaudeSession): Promise<void> {
    const next: Stored = {
      left: session.surface === "pi",
      ...(session.claudeSessionId ? { claudeSessionId: session.claudeSessionId } : {}),
    };
    const stored = session.stored;
    if (stored && stored.left === next.left && stored.claudeSessionId === next.claudeSessionId) {
      return;
    }
    session.stored = next;
    const run = this.docWrites.then(() =>
      this.harness.commit(async (tx) => {
        const doc = await tx.doc(ClaudePlanDoc);
        doc.conversations[String(ref)] = {
          ...(next.left ? { left: true } : {}),
          ...(next.claudeSessionId ? { claudeSessionId: next.claudeSessionId } : {}),
        };
      }, ctx),
    );
    this.docWrites = run.catch(() => undefined);
    try {
      await run;
    } catch (error) {
      session.stored = stored;
      this.report(error);
    }
  }

  /**
   * Import the old engine's JSON file once: every conversation's messages
   * become entries, and its session id and surface the document's entry, in
   * one commit; then the file is renamed `<path>.imported`. A file that
   * cannot be read or parsed is left as it is and reported, never deleted.
   */
  private async importLegacy(): Promise<void> {
    const path = this.options.legacyPath;
    if (!path) return;
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch (error) {
      if (!isMissing(error)) this.report(new Error(`Could not read ${path}`, { cause: error }));
      return;
    }
    const doc = await this.harness.snapshot(ClaudePlanDoc, ctx);
    if (!doc?.imported) {
      let parsed: z.infer<typeof legacyFileSchema>;
      try {
        parsed = legacyFileSchema.parse(JSON.parse(raw));
      } catch (error) {
        this.report(
          new Error(`${path} is not a Claude plan transcript file; it was left as it is`, {
            cause: error,
          }),
        );
        return;
      }
      try {
        await this.harness.commit(async (tx) => {
          const state = await tx.doc(ClaudePlanDoc);
          // A transaction reads its tables before its first write: find the
          // conversations the store still has, then write.
          const sessions: [string, LegacySession][] = [];
          for (const [key, session] of Object.entries(parsed.sessions ?? {})) {
            const ref = Number(key);
            if (!Number.isFinite(ref)) continue;
            // eslint-disable-next-line react-doctor/async-await-in-loop -- one commit, in order
            if (await tx.conversation(ref as ConversationId)) sessions.push([key, session]);
          }
          for (const [key, session] of sessions) {
            const ref = Number(key);
            for (const entry of legacyEntries(session)) {
              // eslint-disable-next-line react-doctor/async-await-in-loop -- entries keep their order
              await tx.appendEntry(ref as ConversationId, entry);
            }
            const left = session.surface === "pi" || state.conversations[key]?.left === true;
            const claudeSessionId =
              session.claudeSessionId ?? state.conversations[key]?.claudeSessionId;
            state.conversations[key] = {
              ...(left ? { left: true } : {}),
              ...(claudeSessionId ? { claudeSessionId } : {}),
            };
          }
          state.imported = true;
        }, ctx);
      } catch (error) {
        this.report(new Error(`Could not import ${path}; it was left as it is`, { cause: error }));
        return;
      }
    }
    try {
      await rename(path, `${path}.imported`);
    } catch (error) {
      this.report(new Error(`Imported ${path} but could not rename it`, { cause: error }));
    }
  }

  // ── Sessions ──────────────────────────────────────────────────────────

  /** The durable store (only status checks run without one). */
  private get harness(): Harness {
    const { harness } = this.options;
    if (!harness) throw new Error("The Claude plan engine has no store.");
    return harness;
  }

  private setBusy(ref: ConversationRef, session: ClaudeSession, busy: boolean): void {
    if (session.busy === busy) return;
    session.busy = busy;
    this.options.onBusy?.(ref, busy);
  }

  private blank(): ClaudeSession {
    return {
      model: "",
      system: "",
      tools: [],
      permissions: {},
      runners: new Map(),
      configured: false,
      surface: "claude",
      queue: [],
      withdrawing: new Set(),
      nextTask: TASK_ID_BASE,
      busy: false,
      writes: Promise.resolve(),
    };
  }

  private ensure(ref: ConversationRef): ClaudeSession {
    const existing = this.sessions.get(ref);
    if (existing) return existing;
    const session = this.blank();
    this.sessions.set(ref, session);
    return session;
  }

  private require(ref: ConversationRef): ClaudeSession {
    const session = this.sessions.get(ref);
    if (!session) throw new Error(`Conversation ${ref} is not a Claude plan session`);
    return session;
  }

  private report(error: unknown): void {
    if (this.options.onReport) this.options.onReport(error);
    else console.warn("Claude plan engine:", error);
  }
}

function upsertTool(reply: ClaudeReply, tool: ChatToolCall): void {
  const tools = reply.toolCalls ? [...reply.toolCalls] : [];
  const index = tools.findIndex((item) => item.id === tool.id);
  // Each update is the whole row: a finished call keeps nothing of its wait.
  if (index >= 0) tools[index] = tool;
  else tools.push(tool);
  reply.toolCalls = tools;
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function unavailable(name: string): ToolExecutionResult {
  return {
    output: [{ type: "text", text: `${name} is not available on the Claude plan engine.` }],
    isError: true,
  };
}

/** The text Claude reads back from a tool's result. */
function resultText(result: ToolExecutionResult): string {
  return (result.output ?? [])
    .map((block) => (block.type === "text" ? block.text : ""))
    .filter(Boolean)
    .join("\n");
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value))
    return value as Record<string, unknown>;
  return { value };
}
