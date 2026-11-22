/**
 * `ta-verify up --demo-agent`: a coding agent with no model, for driving the
 * Code workspace in a verify run. It is a real `HarnessInstance`: the app sees
 * it exactly as it sees Shelley or Claude Code. Each turn follows a small
 * script chosen by words in the message:
 *
 *   (anything)  thinks, runs `ls`, edits a file in the thread's directory,
 *               answers. About three seconds.
 *   slow        the same over fifteen seconds, to steer, queue or stop it.
 *   commit      also commits what it edited, so Publish has a commit.
 *   ask         stops on an approval card until it is answered.
 *   fail        ends with a retryable error.
 *
 * Threads live in memory and end with the run.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import {
  NO_CAPABILITIES,
  threadIdOf,
  type Capabilities,
  type HarnessInstance,
  type InstanceEvent,
  type QueuedMessage,
  type ThreadEvent,
  type ThreadSnapshot,
  type ThreadSummary,
  type TranscriptItem,
  type TurnOutcome,
} from "../../../../packages/code/src/contracts";
import { ThreadFeed } from "../../../../packages/code/src/server/feed";

const run = promisify(execFile);
const ID = "demo";

interface DemoThread {
  summary: ThreadSummary;
  items: TranscriptItem[];
  queued: QueuedMessage[];
  feed: ThreadFeed;
  timers: Set<NodeJS.Timeout>;
  waiting?: { id: string; resume: (allowed: boolean) => void };
  turn: number;
}

const CAPABILITIES: Capabilities = {
  ...NO_CAPABILITIES,
  turns: {
    interrupt: true,
    steer: true,
    queue: true,
    manageQueue: true,
    recovery: ["retry"],
    compact: false,
  },
  threads: { ...NO_CAPABILITIES.threads, archive: true, delete: true, rename: true, rewind: true },
  approvals: { tools: true, questions: false },
};

export function createDemoAgent(): HarnessInstance {
  const listeners = new Set<(event: InstanceEvent) => void>();
  const threads = new Map<string, DemoThread>();
  let made = 0;
  let row = 0;
  const now = () => new Date().toISOString();
  const emit = (event: InstanceEvent) => listeners.forEach((listener) => listener(event));
  const need = (nativeId: string): DemoThread => {
    const thread = threads.get(nativeId);
    if (!thread) throw new Error(`No demo thread ${nativeId}`);
    return thread;
  };

  const snapshotOf = (thread: DemoThread): ThreadSnapshot => ({
    thread: { ...thread.summary, queuedCount: thread.queued.length },
    items: [...thread.items],
    settings: { model: "demo", effort: null, permissionMode: "default" },
    queued: [...thread.queued],
    jobs: [],
    children: [],
    context: { used: thread.items.length * 400, max: 200_000 },
    costUsd: 0,
  });

  const publish = (thread: DemoThread) => {
    thread.summary.updatedAt = now();
    thread.summary.cursor += 1;
    thread.feed.items(thread.items, thread.summary.cursor);
  };
  const put = (thread: DemoThread, item: TranscriptItem) => {
    const at = thread.items.findIndex((existing) => existing.id === item.id);
    if (at < 0) thread.items.push(item);
    else thread.items[at] = item;
    publish(thread);
  };
  const setWorking = (thread: DemoThread, working: boolean) => {
    thread.summary.working = working;
    thread.feed.state({ working, queued: [...thread.queued] });
    emit({ type: "threads" });
  };

  const outcomeOf = (thread: DemoThread): TurnOutcome => {
    const last = [...thread.items]
      .reverse()
      .find((i) => i.kind === "assistant" || i.kind === "notice");
    return {
      working: thread.summary.working,
      title: thread.summary.title,
      cwd: thread.summary.cwd,
      text: last && "text" in last ? last.text : "",
      failed: last?.kind === "notice" && last.level === "error",
      endedAt: thread.summary.working ? undefined : Date.now(),
      cursor: thread.summary.cursor,
    };
  };

  const finish = (thread: DemoThread, started: number) => {
    put(thread, { kind: "turn", id: `turn-${thread.turn}`, durationMs: Date.now() - started });
    setWorking(thread, false);
    emit({ type: "turn_ended", nativeId: thread.summary.nativeId, outcome: outcomeOf(thread) });
    const next = thread.queued.shift();
    if (next) void startTurn(thread, next.text);
  };

  const wait = (thread: DemoThread, ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        thread.timers.delete(timer);
        resolve();
      }, ms);
      thread.timers.add(timer);
    });

  const lastLine = (message: string) =>
    message
      .split("\n")
      .map((line) => line.trim())
      .findLast(Boolean) ?? "";

  async function startTurn(thread: DemoThread, message: string): Promise<void> {
    const turn = ++thread.turn;
    const started = Date.now();
    const live = () => thread.turn === turn && thread.summary.working;
    const step = /\bslow\b/i.test(message) ? 3000 : 600;
    put(thread, { kind: "user", id: `u-${++row}`, text: message, attachments: [] });
    setWorking(thread, true);

    thread.feed.partial({ text: "", thinking: "Reading the request and the directory." });
    await wait(thread, step);
    if (!live()) return;
    put(thread, {
      kind: "thinking",
      id: `th-${++row}`,
      text: "Reading the request and the directory.",
    });

    const cwd = thread.summary.cwd;
    const ls = `ls-${++row}`;
    put(thread, {
      kind: "tool",
      id: ls,
      tool: "bash",
      name: "bash",
      input: { command: "ls" },
      summary: "ls",
      status: "running",
      live: true,
      images: [],
    });
    await wait(thread, step);
    if (!live()) return;
    const listing = cwd && fs.existsSync(cwd) ? fs.readdirSync(cwd).slice(0, 20).join("\n") : "";
    put(thread, {
      kind: "tool",
      id: ls,
      tool: "bash",
      name: "bash",
      input: { command: "ls" },
      summary: "ls",
      status: "done",
      output: listing,
      exitCode: 0,
      durationMs: step,
      images: [],
    });

    if (/\bask\b/i.test(message)) {
      const id = `req-${++row}`;
      const request = {
        kind: "tool" as const,
        tool: "bash" as const,
        name: "bash",
        input: { command: "pnpm test" },
        summary: "pnpm test",
      };
      put(thread, { kind: "request", id, request, status: "open" });
      emit({
        type: "attention",
        nativeId: thread.summary.nativeId,
        text: "Wants to run pnpm test",
        key: id,
      });
      const allowed = await new Promise<boolean>((resume) => (thread.waiting = { id, resume }));
      thread.waiting = undefined;
      if (!live()) return;
      put(thread, { kind: "request", id, request, status: allowed ? "allowed" : "denied" });
    }

    if (cwd && fs.existsSync(cwd)) {
      const file = "NOTES.md";
      const target = path.join(cwd, file);
      const before = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
      const line = `- ${lastLine(message).slice(0, 80)}`;
      fs.writeFileSync(target, `${before}${line}\n`);
      const diff = `--- a/${file}\n+++ b/${file}\n@@ -${before.split("\n").length},0 +${before.split("\n").length},1 @@\n+${line}\n`;
      put(thread, {
        kind: "tool",
        id: `edit-${++row}`,
        tool: "edit",
        name: "edit",
        input: { path: file },
        summary: file,
        status: "done",
        diff: { path: file, diff },
        durationMs: 40,
        images: [],
      });
      if (/\bcommit\b/i.test(message)) {
        const command = "git add -A && git commit -m 'Add a note'";
        const { stdout } = await run("bash", ["-c", command], { cwd }).catch(
          (error: { stdout?: string; message: string }) => ({
            stdout: error.stdout ?? error.message,
          }),
        );
        put(thread, {
          kind: "tool",
          id: `commit-${++row}`,
          tool: "bash",
          name: "bash",
          input: { command },
          summary: command,
          status: "done",
          output: stdout,
          exitCode: 0,
          durationMs: 120,
          images: [],
        });
      }
    }
    await wait(thread, step);
    if (!live()) return;

    if (/\bfail\b/i.test(message)) {
      put(thread, {
        kind: "notice",
        id: `n-${++row}`,
        level: "error",
        text: "The model request failed.",
        retryable: true,
        code: "harness",
      });
      return finish(thread, started);
    }

    const answer = `Done. I noted "${lastLine(message).slice(0, 60)}" in NOTES.md.`;
    for (let at = 12; at < answer.length + 12; at += 12) {
      thread.feed.partial({ text: answer.slice(0, at), thinking: "" });
      await wait(thread, step / 6);
      if (!live()) return;
    }
    put(thread, { kind: "assistant", id: `a-${++row}`, text: answer });
    finish(thread, started);
  }

  const stop = (thread: DemoThread) => {
    for (const timer of thread.timers) clearTimeout(timer);
    thread.timers.clear();
    thread.waiting?.resume(false);
    thread.turn += 1;
  };

  return {
    id: ID,
    kind: "demo",
    label: "Demo agent",
    capabilities: () => CAPABILITIES,
    start: () => emit({ type: "connected" }),
    stop: () => threads.forEach(stop),
    status: () => ({ state: "connected" }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async listThreads(view) {
      return [...threads.values()]
        .map((thread) => thread.summary)
        .filter((summary) => summary.archived === (view === "archived"));
    },
    async getThread(nativeId) {
      return snapshotOf(need(nativeId));
    },
    watchThread(nativeId, listener: (event: ThreadEvent) => void) {
      const thread = need(nativeId);
      const off = thread.feed.subscribe(listener);
      thread.feed.snapshot(snapshotOf(thread), "waiting");
      return off;
    },
    async outcome(nativeId) {
      return outcomeOf(need(nativeId));
    },
    async createThread(input) {
      const nativeId = `d${++made}`;
      const thread: DemoThread = {
        summary: {
          id: threadIdOf(ID, nativeId),
          instanceId: ID,
          kind: "demo",
          nativeId,
          title: lastLine(input.message).slice(0, 60),
          cwd: input.cwd ?? null,
          model: "demo",
          parentId: null,
          createdAt: now(),
          updatedAt: now(),
          working: false,
          archived: false,
          cursor: 0,
        },
        items: [],
        queued: [],
        feed: new ThreadFeed(),
        timers: new Set(),
        turn: 0,
      };
      threads.set(nativeId, thread);
      void startTurn(thread, input.message);
      return { nativeId };
    },
    async forkBefore(nativeId, at) {
      const source = need(nativeId);
      const cut = source.items.findIndex((item) => item.id === at);
      if (cut < 0) throw new Error(`No message ${at} in ${nativeId}`);
      const forkId = `d${++made}`;
      threads.set(forkId, {
        summary: {
          ...source.summary,
          id: threadIdOf(ID, forkId),
          nativeId: forkId,
          working: false,
          cursor: cut,
          updatedAt: now(),
        },
        items: source.items.slice(0, cut),
        queued: [],
        feed: new ThreadFeed(),
        timers: new Set(),
        turn: 0,
      });
      emit({ type: "threads" });
      return { nativeId: forkId };
    },
    async archive(nativeId, archived) {
      need(nativeId).summary.archived = archived;
      emit({ type: "threads" });
      return { moved: [nativeId] };
    },
    async remove(nativeId) {
      stop(need(nativeId));
      threads.delete(nativeId);
      emit({ type: "threads" });
    },
    async rename(nativeId, title) {
      const thread = need(nativeId);
      thread.summary.title = title;
      thread.feed.thread(thread.summary);
      emit({ type: "threads" });
    },
    async send(nativeId, input) {
      const thread = need(nativeId);
      if (!thread.summary.working) {
        void startTurn(thread, input.message);
        return { status: "accepted" };
      }
      if (input.queue) {
        thread.queued.push({ id: `q-${++row}`, text: input.message, createdAt: now() });
        thread.feed.state({ queued: [...thread.queued] });
        return { status: "queued" };
      }
      put(thread, { kind: "user", id: `u-${++row}`, text: input.message, attachments: [] });
      return { status: "accepted" };
    },
    async interrupt(nativeId) {
      const thread = need(nativeId);
      if (!thread.summary.working) return;
      stop(thread);
      put(thread, { kind: "notice", id: `n-${++row}`, level: "info", text: "Stopped." });
      setWorking(thread, false);
      emit({ type: "turn_ended", nativeId, outcome: outcomeOf(thread) });
    },
    async respond(nativeId, requestId, answer) {
      const thread = need(nativeId);
      if (thread.waiting?.id !== requestId) return;
      thread.waiting.resume("decision" in answer && answer.decision === "allow");
    },
    async recover(nativeId) {
      const thread = need(nativeId);
      const last = [...thread.items].reverse().find((item) => item.kind === "user");
      if (last?.kind === "user")
        void startTurn(thread, last.text.replace(/\bfail\b/gi, "").trim() || "retry");
    },
    async queued(nativeId, action, queuedId) {
      const thread = need(nativeId);
      const at = thread.queued.findIndex((message) => message.id === queuedId);
      if (at < 0) return;
      const [message] = thread.queued.splice(at, 1);
      thread.feed.state({ queued: [...thread.queued] });
      if (action === "send")
        put(thread, { kind: "user", id: `u-${++row}`, text: message.text, attachments: [] });
    },
    async models() {
      return [{ id: "demo", label: "Demo", isDefault: true, ready: true }];
    },
  };
}
