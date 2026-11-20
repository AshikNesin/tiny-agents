import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  WorkerRequestError,
  connectWorker,
  type SessionStreams,
  type WebSocketLike,
  type WorkerClock,
  type WorkerConnection,
  type WorkerConnectionOptions,
  type WorkerFrame,
  type WorkerTarget,
} from "../../../../packages/claude-worker/src/client";
import type { ResumeResult } from "../../../../packages/claude-worker/src/index";

const connections: WorkerConnection[] = [];

afterEach(() => {
  for (const connection of connections.splice(0)) connection.close();
});

function manualClock(): WorkerClock & { advance(ms: number): void; pending(): number } {
  let now = 0;
  let timers: { at: number; fn: () => void }[] = [];
  return {
    now: () => now,
    schedule(fn, ms) {
      const timer = { at: now + ms, fn };
      timers.push(timer);
      return () => {
        timers = timers.filter((item) => item !== timer);
      };
    },
    advance(ms) {
      const until = now + ms;
      for (;;) {
        const next = timers.filter((item) => item.at <= until).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        timers = timers.filter((item) => item !== next);
        now = next.at;
        next.fn();
      }
      now = until;
    },
    pending: () => timers.length,
  };
}

interface FakeSocket extends WebSocketLike {
  target: WorkerTarget;
  sent: Array<Record<string, unknown>>;
  pings: number;
  emit(event: string, ...args: unknown[]): void;
}

function fakeWorker(options: { greet?: boolean } = {}) {
  let boot = 1;
  let refuse: number | undefined;
  let answering = true;
  const sockets: FakeSocket[] = [];
  const sessions = new Map<string, Array<{ seq: number; data: string }>>();
  const requests: Array<Record<string, unknown>> = [];

  const emitFrame = (socket: FakeSocket, frame: Record<string, unknown>) => {
    if (socket.readyState === 1) socket.emit("message", JSON.stringify(frame));
  };
  const live = () => sockets.filter((socket) => socket.readyState === 1);

  const receive = (socket: FakeSocket, frame: Record<string, unknown>) => {
    socket.sent.push(frame);
    if (frame.type === "ping") {
      if (answering) emitFrame(socket, { type: "pong" });
      return;
    }
    if (frame.type === "resume") {
      const buffer = sessions.get(String(frame.sessionId));
      const afterSeq = Number(frame.afterSeq);
      const result: ResumeResult = buffer
        ? {
            known: true,
            gap: afterSeq < (buffer[0]?.seq ?? 1) - 1,
            firstSeq: buffer[0]?.seq ?? 1,
            lastSeq: buffer.at(-1)?.seq ?? 0,
          }
        : { known: false, gap: false, firstSeq: 1, lastSeq: 0 };
      emitFrame(socket, { type: "reply", requestId: frame.requestId, ok: true, result });
      for (const event of buffer ?? []) {
        if (event.seq > afterSeq) socket.emit("message", event.data);
      }
      return;
    }
    if (frame.type === "hello") {
      emitFrame(socket, { type: "reply", requestId: frame.requestId, ok: true, result: { boot } });
      return;
    }
    if (typeof frame.requestId === "string") requests.push({ ...frame, socket });
  };

  const socketFor = (target: WorkerTarget): WebSocketLike => {
    const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
    const socket: FakeSocket = {
      target,
      readyState: 0,
      sent: [],
      pings: 0,
      on(event, listener) {
        handlers.set(event, [...(handlers.get(event) ?? []), listener]);
      },
      emit(event, ...args) {
        for (const listener of handlers.get(event) ?? []) listener(...args);
      },
      send(data) {
        receive(socket, JSON.parse(data) as Record<string, unknown>);
      },
      ping() {
        socket.pings += 1;
        if (answering) socket.emit("pong");
      },
      close() {
        if (socket.readyState === 3) return;
        socket.readyState = 3;
        socket.emit("close");
      },
      terminate() {
        socket.close();
      },
    };
    sockets.push(socket);
    const status = refuse;
    queueMicrotask(() => {
      if (status !== undefined) {
        socket.emit("unexpected-response", {}, { statusCode: status });
        return;
      }
      socket.readyState = 1;
      socket.emit("open");
      if (options.greet !== false) emitFrame(socket, { type: "welcome", bootId: `boot-${boot}` });
    });
    return socket;
  };

  return {
    sockets,
    requests,
    socketFor,
    get socket(): FakeSocket {
      const socket = sockets.at(-1);
      if (!socket) throw new Error("no socket yet");
      return socket;
    },
    publish(sessionId: string, payload: string, keep = 1000) {
      const buffer = sessions.get(sessionId) ?? [];
      const seq = (buffer.at(-1)?.seq ?? 0) + 1;
      const data = JSON.stringify({ type: "event", sessionId, seq, payload });
      buffer.push({ seq, data });
      buffer.splice(0, Math.max(0, buffer.length - keep));
      sessions.set(sessionId, buffer);
      for (const socket of live()) socket.emit("message", data);
      return seq;
    },
    raw(frame: Record<string, unknown>) {
      for (const socket of live()) socket.emit("message", JSON.stringify(frame));
    },
    answer(request: Record<string, unknown>, reply: Record<string, unknown>) {
      const socket = request.socket as FakeSocket;
      emitFrame(socket, { type: "reply", requestId: request.requestId, ...reply });
    },
    drop() {
      for (const socket of live()) socket.close();
    },
    restart() {
      boot += 1;
      sessions.clear();
      for (const socket of live()) socket.close();
    },
    refuseWith(status: number | undefined) {
      refuse = status;
    },
    mute() {
      answering = false;
    },
  };
}

const BOT: SessionStreams = { event: "event", resume: "resume", join: "now" };
const CODING: SessionStreams = { event: "event", resume: "resume", join: "start" };

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function open(
  worker: ReturnType<typeof fakeWorker>,
  overrides: Partial<WorkerConnectionOptions> & { resolve?: () => Promise<WorkerTarget> } = {},
) {
  const clock = manualClock();
  const frames: WorkerFrame[] = [];
  const states: Array<[string, string | undefined]> = [];
  const connects: boolean[] = [];
  const resumes: Array<[string, ResumeResult]> = [];
  let resolves = 0;
  const connection = connectWorker(
    overrides.resolve ??
      (async () => {
        resolves += 1;
        return { url: `ws://127.0.0.1:${4000 + resolves}`, token: "t" };
      }),
    {
      sessions: CODING,
      socket: worker.socketFor,
      clock,
      onMessage: (frame) => frames.push(frame),
      onState: (state, detail) => states.push([state, detail]),
      onConnected: (rebooted) => connects.push(rebooted),
      onResume: (sessionId, result) => resumes.push([sessionId, result]),
      ...overrides,
    },
  );
  connections.push(connection);
  const payloads = (sessionId?: string) =>
    frames
      .filter((frame) => frame.type === "event" && (!sessionId || frame.sessionId === sessionId))
      .map((frame) => frame.payload);
  return {
    connection,
    clock,
    frames,
    states,
    connects,
    resumes,
    payloads,
    resolves: () => resolves,
    async after(ms: number) {
      clock.advance(ms);
      await settle();
    },
  };
}

describe("worker connection: the socket", () => {
  it("queues sends until the worker greets, then sends them in order", async () => {
    const worker = fakeWorker();
    const { connection, connects, states } = open(worker);
    expect(connection.state).toBe("connecting");
    expect(connection.send({ type: "turn", n: 1 })).toBe(false);
    expect(connection.send({ type: "turn", n: 2 })).toBe(false);
    await settle();
    expect(connection.state).toBe("connected");
    expect(connects).toEqual([false]);
    expect(states.at(-1)).toEqual(["connected", undefined]);
    expect(worker.socket.sent.map((frame) => frame.n)).toEqual([1, 2]);
    expect(connection.send({ type: "turn", n: 3 })).toBe(true);
    expect(worker.socket.sent.at(-1)).toEqual({ type: "turn", n: 3 });
  });

  it("stays up for an hour while pongs arrive, and closes after 60s of silence", async () => {
    const worker = fakeWorker();
    const { connection, after } = open(worker);
    await settle();
    const first = worker.socket;
    for (let minute = 0; minute < 60; minute++) await after(60_000);
    expect(first.readyState).toBe(1);
    expect(first.pings).toBeGreaterThan(150);
    expect(first.sent.filter((frame) => frame.type === "ping").length).toBeGreaterThan(150);

    worker.mute();
    await after(60_000);
    expect(first.readyState).toBe(3);
    expect(connection.state).toBe("reconnecting");
    expect(connection.detail).toBe("The Claude worker went silent.");
  });

  it("answers the worker's pings", async () => {
    const worker = fakeWorker();
    open(worker);
    await settle();
    worker.raw({ type: "ping" });
    expect(worker.socket.sent.at(-1)).toEqual({ type: "pong" });
  });

  it("reconnects with backoff and resolves the worker again on every attempt", async () => {
    const worker = fakeWorker();
    let calls = 0;
    let failing = false;
    const { connection, after, states } = open(worker, {
      resolve: async () => {
        calls += 1;
        if (failing) throw new Error("Cannot reach the sandbox.");
        return { url: `ws://127.0.0.1:${4000 + calls}`, token: "t" };
      },
    });
    await settle();
    expect(worker.socket.target.url).toBe("ws://127.0.0.1:4001");

    failing = true;
    worker.drop();
    await settle();
    expect(connection.state).toBe("reconnecting");
    await after(1_000);
    expect(calls).toBe(2);
    expect(connection.detail).toBe("Cannot reach the sandbox.");
    await after(1_999);
    expect(calls).toBe(2);
    await after(1);
    expect(calls).toBe(3);

    failing = false;
    await after(4_000);
    expect(calls).toBe(4);
    expect(connection.state).toBe("connected");
    expect(worker.socket.target.url).toBe("ws://127.0.0.1:4004");
    expect(states.map(([state]) => state)).toContain("reconnecting");

    worker.drop();
    await settle();
    await after(1_000);
    expect(calls).toBe(5);
  });

  it("reports a refused token and an HTTP status", async () => {
    const worker = fakeWorker();
    worker.refuseWith(401);
    const { connection, after } = open(worker);
    await settle();
    expect(connection.state).toBe("connecting");
    expect(connection.detail).toBe("The Claude worker refused the token.");
    worker.refuseWith(502);
    await after(1_000);
    expect(connection.detail).toBe("The Claude worker answered HTTP 502.");
    worker.refuseWith(undefined);
    await after(2_000);
    expect(connection.state).toBe("connected");
    expect(connection.detail).toBeUndefined();
  });

  it("gives up on a worker that never greets", async () => {
    const worker = fakeWorker({ greet: false });
    const { connection, after } = open(worker);
    await settle();
    expect(connection.state).toBe("connecting");
    await after(60_000);
    expect(connection.detail).toBe("The Claude worker did not greet back.");
  });

  it("closes for good", async () => {
    const worker = fakeWorker();
    const { connection, clock } = open(worker);
    await settle();
    const pending = connection.request({ type: "op" });
    connection.close();
    await expect(pending).rejects.toThrow("closed");
    expect(connection.state).toBe("closed");
    expect(worker.socket.readyState).toBe(3);
    expect(connection.send({ type: "late" })).toBe(false);
    await expect(connection.request({ type: "op" })).rejects.toThrow("closed");
    expect(clock.pending()).toBe(0);
  });
});

describe("worker connection: handshake and reboot", () => {
  it("sends the hello first on every socket and is connected once it is answered", async () => {
    const worker = fakeWorker();
    const hellos: unknown[] = [];
    const { connection } = open(worker, {
      hello: { type: "hello" },
      onConnected: (_rebooted, hello) => hellos.push(hello),
    });
    connection.send({ type: "queued" });
    connection.track("s1");
    await settle();
    expect(worker.socket.sent.map((frame) => frame.type)).toEqual(["hello", "resume", "queued"]);
    expect(hellos).toEqual([{ boot: 1 }]);
  });

  it("tells a worker restart from a dropped socket, and starts every session over", async () => {
    const worker = fakeWorker();
    const { connection, connects, after, payloads, resumes } = open(worker);
    connection.track("s1");
    await settle();
    worker.publish("s1", "a");
    worker.publish("s1", "b");

    worker.drop();
    await settle();
    await after(1_000);
    expect(connects).toEqual([false, false]);

    worker.restart();
    await settle();
    await after(1_000);
    expect(connects).toEqual([false, false, true]);
    expect(worker.socket.sent.find((frame) => frame.type === "resume")?.afterSeq).toBe(0);
    expect(resumes.at(-1)).toEqual(["s1", { known: false, gap: false, firstSeq: 1, lastSeq: 0 }]);
    worker.publish("s1", "c");
    expect(payloads("s1")).toEqual(["a", "b", "c"]);
  });
});

describe("worker connection: resume", () => {
  it("delivers each event once, in order, across a dropped socket", async () => {
    const worker = fakeWorker();
    const { connection, after, payloads } = open(worker);
    connection.track("s1");
    await settle();
    worker.publish("s1", "a");
    worker.drop();
    worker.publish("s1", "b");
    worker.publish("s1", "c");
    await settle();
    await after(1_000);
    expect(worker.socket.sent.find((frame) => frame.type === "resume")?.afterSeq).toBe(1);
    worker.publish("s1", "d");
    expect(payloads("s1")).toEqual(["a", "b", "c", "d"]);
    worker.raw({ type: "event", sessionId: "s1", seq: 2, payload: "b" });
    expect(payloads("s1")).toEqual(["a", "b", "c", "d"]);
  });

  it("replays from the cursor when an event is missing", async () => {
    const worker = fakeWorker();
    const { connection, payloads } = open(worker);
    connection.track("s1");
    await settle();
    worker.publish("s1", "a");
    worker.publish("s1", "b");
    const before = worker.socket.sent.filter((frame) => frame.type === "resume").length;
    worker.raw({ type: "event", sessionId: "s1", seq: 4, payload: "late" });
    const resumes = worker.socket.sent.filter((frame) => frame.type === "resume");
    expect(resumes.length).toBe(before + 1);
    expect(resumes.at(-1)?.afterSeq).toBe(2);
    expect(payloads("s1")).toEqual(["a", "b"]);
  });

  it("joins at the start: replays what the worker holds, and follows untracked sessions", async () => {
    const worker = fakeWorker();
    worker.publish("s1", "old-1");
    worker.publish("s1", "old-2");
    worker.publish("s2", "x-1");
    const { connection, payloads } = open(worker, { sessions: CODING });
    await settle();
    connection.track("s1");
    expect(payloads("s1")).toEqual(["old-1", "old-2"]);

    worker.publish("s2", "x-2");
    expect(payloads("s2")).toEqual(["x-1", "x-2"]);
  });

  it("joins now: skips what the worker holds, without losing what comes next", async () => {
    const worker = fakeWorker();
    worker.publish("s1", "old-1");
    worker.publish("s1", "old-2");
    const { connection, after, payloads } = open(worker, { sessions: BOT });
    connection.track("s1");
    await settle();
    expect(worker.socket.sent.find((frame) => frame.type === "resume")?.afterSeq).toBe(
      Number.MAX_SAFE_INTEGER,
    );
    worker.publish("s1", "new-1");
    worker.drop();
    worker.publish("s1", "new-2");
    await settle();
    await after(1_000);
    expect(payloads("s1")).toEqual(["new-1", "new-2"]);

    worker.publish("s2", "y-1");
    worker.drop();
    worker.publish("s2", "y-2");
    await settle();
    await after(1_000);
    worker.publish("s2", "y-3");
    expect(payloads("s2")).toEqual(["y-1", "y-2", "y-3"]);
    worker.publish("s3", "z-1");
    worker.publish("s3", "z-2");
    connection.close();
    const late = open(worker, { sessions: BOT });
    await settle();
    worker.publish("s3", "z-3");
    expect(late.payloads("s3")).toEqual(["z-3"]);
  });

  it("moves the cursor past a gap the worker reports", async () => {
    const worker = fakeWorker();
    const { connection, after, payloads, resumes } = open(worker);
    connection.track("s1");
    await settle();
    worker.publish("s1", "a", 2);
    worker.drop();
    for (const payload of ["b", "c", "d", "e"]) worker.publish("s1", payload, 2);
    await settle();
    await after(1_000);
    expect(resumes.at(-1)?.[1]).toMatchObject({ known: true, gap: true, firstSeq: 4 });
    expect(payloads("s1")).toEqual(["a", "d", "e"]);
  });
});

describe("worker connection: requests", () => {
  const op = (n: number) => ({ type: "op", n });

  it("resolves a reply, rejects a refusal with its code, and passes other frames on", async () => {
    const worker = fakeWorker();
    const { connection, frames } = open(worker);
    await settle();
    const ok = connection.request<{ n: number }>(op(1));
    const refused = connection.request(op(2));
    const [first, second] = worker.requests;
    worker.answer(first!, { ok: true, result: { n: 1 } });
    worker.answer(second!, {
      ok: false,
      error: { code: "not_found", message: "No such session." },
    });
    await expect(ok).resolves.toEqual({ n: 1 });
    const error = await refused.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(WorkerRequestError);
    expect(error).toMatchObject({ code: "not_found", message: "No such session." });
    worker.raw({ type: "coding.catalog", catalog: {} });
    expect(frames.map((frame) => frame.type)).toEqual(["coding.catalog"]);
  });

  it("sends an unanswered request again on the next socket", async () => {
    const worker = fakeWorker();
    const { connection, after } = open(worker);
    await settle();
    const reply = connection.request<string>(op(1));
    expect(worker.requests).toHaveLength(1);
    worker.drop();
    await settle();
    await after(1_000);
    expect(worker.requests).toHaveLength(2);
    worker.answer(worker.requests[1]!, { ok: true, result: "done" });
    await expect(reply).resolves.toBe("done");
  });

  it("times out, saying why the worker is not reachable", async () => {
    const worker = fakeWorker();
    worker.refuseWith(401);
    const { connection, after } = open(worker);
    await settle();
    const reply = connection.request({ type: "op" }, { timeoutMs: 5_000 });
    const failed = reply.catch((error: unknown) => error);
    await after(5_000);
    expect(String(await failed)).toContain(
      "The Claude worker is not reachable: The Claude worker refused the token.",
    );

    worker.refuseWith(undefined);
    await after(30_000);
    expect(connection.state).toBe("connected");
    const slow = connection.request({ type: "op" }, { timeoutMs: 5_000 }).catch((e: unknown) => e);
    await after(5_000);
    expect(String(await slow)).toContain("did not answer in time");
  });
});
