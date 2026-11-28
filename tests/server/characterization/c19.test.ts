import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  CodingBook,
  DEFAULT_CODING_LIMITS,
  DEFAULT_TIMINGS,
  SessionBook,
  type QueryFactory,
  type ResumeResult,
} from "../../../packages/claude-worker/src/index";
import type { CodingDeps } from "../../../packages/claude-worker/src/coding-session";
import {
  connectWorker,
  type WebSocketLike,
  type WorkerClock,
  type WorkerConnection,
} from "../../../packages/claude-worker/src/client";
import {
  createShelleyStream,
  type ShelleyStream,
} from "../../../packages/code/src/drivers/shelley/stream";

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

describe("C19: the Claude worker's books", () => {
  it("drops a dead session's event log and tool results once it has been idle past the sweep", async () => {
    const factory: QueryFactory = async (ctx) => {
      for await (const turn of ctx.turns) {
        ctx.publish({ type: "turn_end", turnId: turn.turnId, stopReason: "end_turn" });
      }
    };
    const book = new SessionBook(factory, { ...DEFAULT_TIMINGS, idleEvictMs: 1_000 });
    const ids = ["s1", "s2", "s3"];
    const held = new Map<string, ReturnType<typeof book.get>>();
    for (const [index, id] of ids.entries()) {
      const session = await book.runTurn(
        { sessionId: id, model: "claude-sonnet-4-6", tools: [] },
        { turnId: `t-${id}`, text: "hi" },
        index * 5_000,
      );
      expect(session.settleTool(`toolu_${id}`, { content: "done" })).toBe(true);
      held.set(id, session);
    }

    book.sweep(60 * 60_000);
    expect(book.liveProcesses()).toBe(0);

    expect(held.get("s1")?.alive).toBe(false);
    expect(book.get("s1")).toBeUndefined();
    expect(book.get("s2")).toBeUndefined();
    expect(book.get("s3")).toBeUndefined();
    expect(book.settle("s3", "toolu_s3", { content: "again" })).toBe(false);
    const revived = book.open(
      { sessionId: "s1", model: "claude-sonnet-4-6", tools: [] },
      60 * 60_000,
    );
    expect(revived).not.toBe(held.get("s1"));
  });

  it("keeps a busy session through the sweep, and a live one that is still inside the idle window", async () => {
    const gates = new Map<string, () => void>();
    const factory: QueryFactory = async (ctx) => {
      for await (const turn of ctx.turns) {
        ctx.publish({ type: "text", turnId: turn.turnId, text: "working" });
        await new Promise<void>((resolve) => gates.set(turn.turnId, resolve));
        ctx.publish({ type: "turn_end", turnId: turn.turnId, stopReason: "end_turn" });
      }
    };
    const book = new SessionBook(factory, {
      ...DEFAULT_TIMINGS,
      idleEvictMs: 1_000,
      maxRunningTurns: 2,
    });
    const open = { sessionId: "s", model: "claude-sonnet-4-6", tools: [] as const };
    const running = book.runTurn(open, { turnId: "t1", text: "go" }, 0);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const idle = book.runTurn(
      { ...open, sessionId: "resting" },
      { turnId: "t2", text: "go" },
      1_200,
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    gates.get("t2")!();
    await idle;
    book.sweep(1_500);
    expect(book.get("s")).toBeDefined();
    expect(book.get("resting")).toBeDefined();
    gates.get("t1")!();
    await running;
    book.sweep(3_000);
    expect(book.get("s")).toBeUndefined();
    expect(book.get("resting")).toBeUndefined();
  });

  it("keep every coding session after it is closed", () => {
    const deps = {
      limits: DEFAULT_CODING_LIMITS,
      now: () => 0,
      env: {},
    } as unknown as CodingDeps;
    const book = new CodingBook(deps);
    for (const id of ["c1", "c2", "c3"]) book.ensure(id, { cwd: "/tmp" }).close();
    expect(book.list().map((session) => session.id)).toEqual(["c1", "c2", "c3"]);
    expect(book.get("c1")?.log.lastSeq).toBeGreaterThan(0);
  });
});

describe("C19: the worker connection's cursors", () => {
  it("resume every session it ever saw on each reconnect; nothing untracks one", async () => {
    const sockets: Array<WebSocketLike & { sent: Array<Record<string, unknown>>; drop(): void }> =
      [];
    const socketFor = (): WebSocketLike => {
      const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
      const emit = (event: string, ...args: unknown[]) =>
        (handlers.get(event) ?? []).forEach((listener) => listener(...args));
      const reply = (frame: Record<string, unknown>) => emit("message", JSON.stringify(frame));
      const socket = {
        readyState: 0,
        sent: [] as Array<Record<string, unknown>>,
        on(event: string, listener: (...args: unknown[]) => void) {
          handlers.set(event, [...(handlers.get(event) ?? []), listener]);
        },
        send(data: string) {
          const frame = JSON.parse(data) as Record<string, unknown>;
          socket.sent.push(frame);
          if (frame.type === "resume") {
            const result: ResumeResult = { known: true, gap: false, firstSeq: 1, lastSeq: 1 };
            reply({ type: "reply", requestId: frame.requestId, ok: true, result });
          }
        },
        close() {
          if (socket.readyState === 3) return;
          socket.readyState = 3;
          emit("close");
        },
        drop() {
          socket.close();
        },
        emitFrame: reply,
      };
      sockets.push(socket);
      queueMicrotask(() => {
        socket.readyState = 1;
        emit("open");
        reply({ type: "welcome", bootId: "boot-1" });
      });
      return socket;
    };
    let now = 0;
    let timers: Array<{ at: number; fn: () => void }> = [];
    const clock: WorkerClock = {
      now: () => now,
      schedule(fn, ms) {
        const timer = { at: now + ms, fn };
        timers.push(timer);
        return () => void (timers = timers.filter((item) => item !== timer));
      },
    };
    const connection: WorkerConnection = connectWorker(
      async () => ({ url: "ws://worker", token: "t" }),
      {
        sessions: { event: "event", resume: "resume", join: "start" },
        socket: socketFor,
        clock,
        onMessage: () => undefined,
      },
    );
    closers.push(() => connection.close());
    const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
    const resumed = (index: number) =>
      sockets[index]!.sent.filter((frame) => frame.type === "resume").map((f) => f.sessionId);

    await settle();
    connection.track("s1");
    connection.track("s2");
    (sockets[0] as unknown as { emitFrame(frame: object): void }).emitFrame({
      type: "event",
      sessionId: "s3",
      seq: 1,
    });
    expect(resumed(0)).toEqual(["s1", "s2"]);

    for (let blip = 1; blip <= 3; blip++) {
      sockets.at(-1)!.drop();
      now += 60_000;
      const due = timers.filter((timer) => timer.at <= now);
      timers = timers.filter((timer) => timer.at > now);
      due.forEach((timer) => timer.fn());
      await settle();
      expect(sockets).toHaveLength(blip + 1);
      expect(resumed(blip)).toEqual(["s1", "s2", "s3"]);
    }
  });
});

describe("C19: Shelley's `working` map", () => {
  it("still holds a conversation that left Shelley's list, so its late turn end fires", async () => {
    const encoder = new TextEncoder();
    let push: ((frame: object) => void) | undefined;
    let rows = [
      {
        conversation_id: "c1",
        working: false,
        updated_at: "2026-11-05T00:00:00Z",
        created_at: "2026-11-05T00:00:00Z",
      },
    ];
    const fetch = async (url: string) => {
      if (url.endsWith("/api/stream2")) {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            push = (frame) =>
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
          },
        });
        return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
      }
      return Response.json({ conversations: rows });
    };
    const stream: ShelleyStream = createShelleyStream({
      deps: { config: { url: "http://shelley" }, fetch },
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
      listDebounceMs: 1,
    });
    closers.push(() => stream.stop());
    const ends: string[] = [];
    stream.onTurnEnd((end) => void ends.push(end.conversationId));
    const lists: number[] = [];
    stream.onList(() => void lists.push(stream.list()?.length ?? -1));
    stream.start();
    await expect.poll(() => lists).toEqual([1]);

    push!({ conversation_id: "c1", conversation_state: { working: true } });
    rows = [];
    push!({ conversation_list_patch: [{ op: "remove", path: "/0" }] });
    await expect.poll(() => lists).toEqual([1, 0]);
    expect(stream.list()).toEqual([]);

    push!({ conversation_id: "c1", conversation_state: { working: false } });
    await expect.poll(() => ends).toEqual(["c1"]);
  });
});
