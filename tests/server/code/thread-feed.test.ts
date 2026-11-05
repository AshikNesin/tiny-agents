/**
 * The watch-thread protocol in one place: what each watcher of a
 * `ThreadFeed` is sent, and in what order, for whatever a driver reports.
 * Every scenario's output also passes the test kit's `threadEventProblems`,
 * the check any driver's watch can be run through.
 */
import { describe, expect, it } from "vite-plus/test";
import type { ThreadEvent, ThreadSnapshot, TranscriptItem } from "@tiny-agents/code/contracts";
import { NO_PARTIAL, ThreadFeed } from "@tiny-agents/code/server";
import { collect, threadEventProblems } from "@tiny-agents/code/testing";

const user = (id: string, text: string): TranscriptItem => ({ kind: "user", id, text });
const answer = (id: string, text: string): TranscriptItem => ({ kind: "assistant", id, text });

function snapshot(items: TranscriptItem[], working = false): ThreadSnapshot {
  return {
    thread: {
      id: "fake:t1",
      instanceId: "fake",
      kind: "fake",
      nativeId: "t1",
      title: "t1",
      cwd: "/repo",
      model: null,
      parentId: null,
      createdAt: "2026-11-05T00:00:00Z",
      updatedAt: "2026-11-05T00:00:00Z",
      working,
      archived: false,
      cursor: items.length,
    },
    items,
    settings: { model: null, effort: null, permissionMode: null },
    queued: [],
    jobs: [],
    children: [],
    context: { used: 0 },
    costUsd: 0,
  };
}

const types = (events: ThreadEvent[]) => events.map((event) => event.type);

function watched(feed: ThreadFeed) {
  const watcher = collect();
  feed.subscribe(watcher.listener);
  return watcher.events;
}

describe("ThreadFeed", () => {
  it("sends a watcher nothing but errors until its snapshot, then the snapshot first", () => {
    const feed = new ThreadFeed();
    const events = watched(feed);
    feed.items([user("u1", "hi")], 1);
    feed.partial({ text: "Wor", thinking: "" });
    feed.state({ working: true });
    feed.thread(snapshot([]).thread);
    feed.error("Shelley is down");
    expect(events).toEqual([{ type: "error", message: "Shelley is down" }]);
    expect(feed.live).toBe(false);
    expect(feed.waiting).toBe(true);

    feed.snapshot(snapshot([user("u1", "hi")], true));
    expect(types(events)).toEqual(["error", "snapshot", "partial"]);
    expect(events.at(-1)).toEqual({ type: "partial", text: "Wor", thinking: "" });
    expect(feed.live).toBe(true);
    expect(threadEventProblems(events)).toEqual([]);
  });

  it("sends each live watcher only the rows that are new or changed, whole and in order", () => {
    const feed = new ThreadFeed();
    const events = watched(feed);
    feed.snapshot(snapshot([user("u1", "hi")], true));

    feed.items([user("u1", "hi")], 1);
    expect(types(events)).toEqual(["snapshot"]);

    feed.items([user("u1", "hi"), answer("a1", "Hel"), answer("a2", "x")], 2);
    feed.items([user("u1", "hi"), answer("a1", "Hello"), answer("a2", "x")], 3);
    expect(events.slice(1)).toEqual([
      { type: "items", items: [answer("a1", "Hel"), answer("a2", "x")], cursor: 2 },
      { type: "items", items: [answer("a1", "Hello")], cursor: 3 },
    ]);
    expect(threadEventProblems(events)).toEqual([]);
  });

  it("starts every watcher over on a snapshot: its rows are the new baseline", () => {
    const feed = new ThreadFeed();
    const events = watched(feed);
    feed.snapshot(snapshot([user("u1", "hi")]));
    feed.items([user("u1", "hi"), answer("a1", "one")], 1);
    // A reconnect: the harness's history is read again.
    feed.snapshot(snapshot([user("u1", "hi"), answer("a1", "one"), answer("a2", "two")]));
    feed.items([user("u1", "hi"), answer("a1", "one"), answer("a2", "two")], 2);
    expect(types(events)).toEqual(["snapshot", "items", "snapshot"]);
    feed.items([user("u1", "hi"), answer("a1", "one!"), answer("a2", "two")], 2);
    expect(events.at(-1)).toEqual({ type: "items", items: [answer("a1", "one!")], cursor: 2 });
    expect(threadEventProblems(events)).toEqual([]);
  });

  it("brings a viewer who joins up to date without restarting the others", () => {
    const feed = new ThreadFeed();
    const first = watched(feed);
    feed.snapshot(snapshot([user("u1", "hi")], true));
    feed.items([user("u1", "hi"), answer("a1", "Hel")], 1);

    const second = watched(feed);
    feed.snapshot(snapshot([user("u1", "hi"), answer("a1", "Hel")], true), "waiting");
    expect(types(first)).toEqual(["snapshot", "items"]);
    expect(types(second)).toEqual(["snapshot"]);

    feed.items([user("u1", "hi"), answer("a1", "Hello")], 1);
    expect(first.at(-1)).toEqual({ type: "items", items: [answer("a1", "Hello")], cursor: 1 });
    expect(second.at(-1)).toEqual(first.at(-1));
    expect(threadEventProblems(first)).toEqual([]);
    expect(threadEventProblems(second)).toEqual([]);
  });

  it("sends the streaming text when it changes, and re-sends it after a snapshot while working", () => {
    const feed = new ThreadFeed();
    const events = watched(feed);
    feed.snapshot(snapshot([], true));
    feed.partial({ text: "It", thinking: "hm" });
    feed.partial({ ...feed.partialNow });
    feed.partial({ text: "It works", thinking: "hm" });
    feed.snapshot(snapshot([user("u1", "go")], true));
    expect(events.slice(1)).toEqual([
      { type: "partial", text: "It", thinking: "hm" },
      { type: "partial", text: "It works", thinking: "hm" },
      expect.objectContaining({ type: "snapshot" }),
      { type: "partial", text: "It works", thinking: "hm" },
    ]);
    feed.partial(NO_PARTIAL);
    feed.snapshot(snapshot([user("u1", "go")], true));
    expect(types(events).slice(-2)).toEqual(["partial", "snapshot"]);
    expect(threadEventProblems(events)).toEqual([]);
  });

  it("keeps working across state patches, and ends the streaming text when the turn ends", () => {
    const feed = new ThreadFeed();
    const events = watched(feed);
    feed.snapshot(snapshot([], true));
    feed.partial({ text: "Almost", thinking: "" });
    feed.state({ queued: [] });
    feed.state({ working: false, costUsd: 0.02 });
    expect(events.slice(2)).toEqual([
      { type: "state", working: true, queued: [] },
      { type: "state", working: false, costUsd: 0.02 },
    ]);
    expect(feed.partialNow).toEqual(NO_PARTIAL);
    // A turn that ended is not streaming: the next snapshot has no tail.
    feed.snapshot(snapshot([], true));
    expect(events.at(-1)?.type).toBe("snapshot");
    expect(threadEventProblems(events)).toEqual([]);
  });

  it("drops the streaming text when a snapshot shows the thread idle", () => {
    const feed = new ThreadFeed();
    feed.partial({ text: "stale", thinking: "" });
    const events = watched(feed);
    feed.snapshot(snapshot([answer("a1", "done")], false));
    expect(types(events)).toEqual(["snapshot"]);
    expect(feed.partialNow).toEqual(NO_PARTIAL);
  });

  it("isolates a failing listener and stops sending to one that left", () => {
    const failures: unknown[] = [];
    const feed = new ThreadFeed((error) => failures.push(error));
    feed.subscribe(() => {
      throw new Error("boom");
    });
    const events: ThreadEvent[] = [];
    const leave = feed.subscribe((event) => events.push(event));
    const other = watched(feed);
    feed.snapshot(snapshot([]));
    feed.items([user("u1", "hi")], 1);
    expect(types(events)).toEqual(["snapshot", "items"]);
    expect(failures).toHaveLength(2);

    leave();
    feed.items([user("u1", "hi"), answer("a1", "yo")], 2);
    expect(types(events)).toEqual(["snapshot", "items"]);
    expect(types(other)).toEqual(["snapshot", "items", "items"]);
    expect(feed.size).toBe(2);
  });
});

describe("threadEventProblems", () => {
  const snap = (items: TranscriptItem[], working = false): ThreadEvent => ({
    type: "snapshot",
    snapshot: snapshot(items, working),
  });

  it("flags events before the first snapshot (errors may come first)", () => {
    expect(
      threadEventProblems([
        { type: "error", message: "down" },
        { type: "state", working: true },
        snap([]),
      ]),
    ).toEqual(["event 1 (state) came before the first snapshot"]);
  });

  it("flags rows sent unchanged, twice, or an empty items event", () => {
    expect(
      threadEventProblems([
        snap([user("u1", "hi")]),
        { type: "items", items: [user("u1", "hi")], cursor: 1 },
        { type: "items", items: [answer("a1", "x"), answer("a1", "y")], cursor: 1 },
        { type: "items", items: [], cursor: 1 },
      ]),
    ).toEqual([
      "event 1 (items) re-sent row u1 unchanged",
      "event 2 (items) has row a1 twice",
      "event 3 (items) is empty",
    ]);
  });

  it("flags a snapshot that drops streaming text nothing has ended", () => {
    const streaming: ThreadEvent = { type: "partial", text: "Wor", thinking: "" };
    expect(threadEventProblems([snap([], true), streaming, snap([], true)])).toEqual([
      "event 2 (snapshot) dropped the streaming text without re-sending it",
    ]);
    expect(
      threadEventProblems([
        snap([], true),
        streaming,
        { type: "items", items: [answer("a1", "Words")], cursor: 1 },
        snap([answer("a1", "Words")], true),
      ]),
    ).toEqual([]);
    expect(threadEventProblems([snap([], true), streaming, snap([], false)])).toEqual([]);
  });
});
