/**
 * Live Claude sessions. One `query()` per conversation. Caps: 2 live
 * processes, 1 running turn. Idle processes are evicted; processes older
 * than the max age are recycled but keep the Claude session id for `resume`.
 */
import { randomBytes } from "node:crypto";
import type { ImagePart, SessionEvent, Timings, ToolResultPayload, ToolSpec } from "./protocol";
import { SessionLog } from "./session-log";
import { ToolProxy, type ArmTimer } from "./tool-proxy";
import { usagePauseMessage, usagePauseReason, type RateLimitInfo } from "./usage";

export interface QueryTurn {
  turnId: string;
  text: string;
  images?: ImagePart[];
}

export interface QueryContext {
  model: string;
  system?: string;
  resume?: string;
  tools: readonly ToolSpec[];
  signal: AbortSignal;
  turns: AsyncIterable<QueryTurn>;
  publish: (event: SessionEvent) => void;
  callTool: (call: {
    turnId: string;
    toolUseId: string;
    name: string;
    input: unknown;
  }) => Promise<ToolResultPayload>;
  setClaudeSessionId: (id: string) => void;
  /** SDK options the adapter is about to use. Tests assert lockdown here. */
  maxTurns: number;
}

export type QueryFactory = (ctx: QueryContext) => Promise<void>;

export interface SessionOpen {
  sessionId: string;
  model: string;
  system?: string;
  resume?: string;
  tools: readonly ToolSpec[];
}

interface TurnWaiter {
  turnId: string;
  resolve: () => void;
  reject: (error: Error) => void;
}

export class Session {
  readonly id: string;
  readonly createdAt: number;
  lastUsed: number;
  claudeSessionId?: string;
  model: string;
  system?: string;
  tools: readonly ToolSpec[];
  alive = false;
  running = false;
  /** Every event of this session, numbered, kept for resume and followed by the sockets. */
  readonly log: SessionLog<SessionEvent>;
  private readonly proxy: ToolProxy;
  private turnQueue = new AsyncQueue<QueryTurn>();
  private abort = new AbortController();
  private generation = 0;
  private process: Promise<void> | undefined;
  private failed?: Error;
  private readonly pendingTurns: TurnWaiter[] = [];
  private activeGeneration = 0;

  constructor(
    open: SessionOpen,
    private readonly factory: QueryFactory,
    private readonly timings: Timings,
    private readonly arm: ArmTimer | undefined,
    now: number,
  ) {
    this.id = open.sessionId;
    this.model = open.model;
    this.system = open.system;
    this.claudeSessionId = open.resume;
    this.tools = open.tools;
    this.createdAt = now;
    this.lastUsed = now;
    this.log = new SessionLog(open.sessionId, timings.eventBuffer);
    this.proxy = new ToolProxy(timings.toolResultTimeoutMs, arm);
  }

  touch(now: number): void {
    this.lastUsed = now;
  }

  settleTool(toolUseId: string, result: ToolResultPayload): boolean {
    return this.proxy.settle(toolUseId, result);
  }

  /** Stop the process. The session id and Claude resume id stay. */
  recycle(): void {
    this.generation += 1;
    this.abort.abort();
    this.abort = new AbortController();
    this.turnQueue = new AsyncQueue();
    this.alive = false;
    this.running = false;
    this.failCurrent(new Error("Claude session process was recycled"));
  }

  async turn(turn: QueryTurn, now: number): Promise<void> {
    this.touch(now);
    if (this.failed && !this.alive) this.failed = undefined;
    const done = new Promise<void>((resolve, reject) => {
      this.pendingTurns.push({ turnId: turn.turnId, resolve, reject });
    });
    this.turnQueue.push(turn);
    await this.ensureProcess();
    return done;
  }

  abortTurn(): void {
    const turnId = this.pendingTurns[0]?.turnId;
    if (!turnId) return;
    this.onFactoryEvent({ type: "turn_end", turnId, stopReason: "aborted" });
  }

  private async ensureProcess(): Promise<void> {
    if (this.alive) return;
    if (this.failed) throw this.failed;
    this.alive = true;
    const generation = this.generation;
    this.activeGeneration = generation;
    const signal = this.abort.signal;
    this.process = this.factory({
      model: this.model,
      system: this.system,
      resume: this.claudeSessionId,
      tools: this.tools,
      signal,
      turns: this.turns(),
      publish: (event) => this.onFactoryEvent(event),
      callTool: (call) => this.onTool(call),
      setClaudeSessionId: (id) => {
        this.claudeSessionId = id;
        this.publish({ type: "session", claudeSessionId: id });
      },
      maxTurns: this.timings.maxTurns,
    }).then(
      () => {
        if (generation !== this.generation) return;
        this.alive = false;
        this.failCurrent(new Error("Claude process ended"));
      },
      (error: unknown) => {
        if (generation !== this.generation) return;
        this.alive = false;
        const wrapped = error instanceof Error ? error : new Error(String(error));
        this.failed = wrapped;
        this.failCurrent(wrapped);
      },
    );
  }

  private async onTool(call: {
    turnId: string;
    toolUseId: string;
    name: string;
    input: unknown;
  }): Promise<ToolResultPayload> {
    const cached = this.proxy.cached(call.toolUseId);
    if (cached) return cached;
    const first = this.proxy.markAnnounced(call.toolUseId);
    const waiting = this.proxy.wait(call.toolUseId);
    if (first) {
      this.publish({
        type: "tool_use",
        turnId: call.turnId,
        toolUseId: call.toolUseId,
        name: call.name,
        input: call.input,
      });
    }
    return waiting;
  }

  private onFactoryEvent(event: SessionEvent): void {
    if (this.activeGeneration !== this.generation) return;
    if (event.type === "usage_pause") {
      this.publish(event);
      this.publish({
        type: "turn_end",
        turnId: event.turnId,
        stopReason: "paused",
        error: usagePauseMessage(event.reason),
      });
      return;
    }
    if (event.type === "turn_end") {
      this.publish(event);
      this.finishTurn(event.turnId);
      return;
    }
    this.publish(event);
  }

  /** A rate-limit payload from the SDK adapter. */
  noteRateLimit(turnId: string, info: RateLimitInfo | undefined): boolean {
    const reason = usagePauseReason(info);
    if (!reason) return false;
    this.onFactoryEvent({ type: "usage_pause", turnId, reason });
    return true;
  }

  private finishTurn(turnId: string): void {
    this.running = false;
    const index = this.pendingTurns.findIndex((item) => item.turnId === turnId);
    const waiter = index >= 0 ? this.pendingTurns[index] : undefined;
    if (index >= 0) this.pendingTurns.splice(index, 1);
    waiter?.resolve();
  }

  private failCurrent(error: Error): void {
    this.running = false;
    const waiters = [...this.pendingTurns];
    this.pendingTurns.length = 0;
    for (const waiter of waiters) waiter.reject(error);
  }

  private publish(event: SessionEvent): void {
    this.log.append(event);
  }

  private async *turns(): AsyncIterable<QueryTurn> {
    const queue = this.turnQueue;
    const signal = this.abort.signal;
    while (!signal.aborted) {
      // One consumer, in order. The next turn is pulled only after this yield
      // returns, so two turns cannot run and a queued push cannot be stolen.
      // eslint-disable-next-line react-doctor/async-await-in-loop -- sequential turn queue
      const next = await queue.next();
      if (signal.aborted) return;
      this.running = true;
      yield next;
    }
  }
}

/** A queue that does not drop a push that arrives before the consumer waits. */
class AsyncQueue<T> {
  private readonly items: T[] = [];
  private readonly waiters: ((value: T) => void)[] = [];

  push(value: T): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(value);
    else this.items.push(value);
  }

  next(): Promise<T> {
    const item = this.items.shift();
    if (item !== undefined) return Promise.resolve(item);
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

export function newToolUseId(): string {
  return `toolu_${randomBytes(8).toString("hex")}`;
}

export class SessionBook {
  private readonly sessions = new Map<string, Session>();
  runningTurns = 0;

  constructor(
    private readonly factory: QueryFactory,
    private readonly timings: Timings,
    private readonly arm?: ArmTimer,
  ) {}

  liveProcesses(): number {
    let count = 0;
    for (const session of this.sessions.values()) if (session.alive) count += 1;
    return count;
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  open(input: SessionOpen, now: number): Session {
    const existing = this.sessions.get(input.sessionId);
    if (existing) {
      existing.model = input.model;
      existing.system = input.system;
      if (input.tools.length > 0) existing.tools = input.tools;
      if (input.resume) existing.claudeSessionId = input.resume;
      existing.touch(now);
      return existing;
    }
    const session = new Session(input, this.factory, this.timings, this.arm, now);
    this.sessions.set(input.sessionId, session);
    return session;
  }

  /**
   * Run one turn under the caps. Evicts idle and over-age processes first.
   * A second concurrent turn is rejected. A third live process is rejected
   * when nothing idle can be evicted.
   */
  async runTurn(input: SessionOpen, turn: QueryTurn, now: number): Promise<Session> {
    this.sweep(now);
    if (this.runningTurns >= this.timings.maxRunningTurns) {
      throw new SessionLimitError("turn_busy", "A Claude turn is already running.");
    }
    const session = this.open(input, now);
    if (!session.alive && this.liveProcesses() >= this.timings.maxLiveProcesses) {
      throw new SessionLimitError("at_capacity", "Two Claude processes are already live.");
    }
    this.runningTurns += 1;
    try {
      await session.turn(turn, now);
      return session;
    } finally {
      this.runningTurns = Math.max(0, this.runningTurns - 1);
    }
  }

  sweep(now: number): void {
    for (const session of this.sessions.values()) {
      if (session.running) continue;
      const idle = now - session.lastUsed >= this.timings.idleEvictMs;
      const aged = now - session.createdAt >= this.timings.maxSessionAgeMs;
      if (session.alive && (idle || aged)) session.recycle();
    }
  }

  settle(sessionId: string, toolUseId: string, result: ToolResultPayload): boolean {
    return this.sessions.get(sessionId)?.settleTool(toolUseId, result) ?? false;
  }
}

export class SessionLimitError extends Error {
  constructor(
    readonly code: "turn_busy" | "at_capacity",
    message: string,
  ) {
    super(message);
    this.name = "SessionLimitError";
  }
}
