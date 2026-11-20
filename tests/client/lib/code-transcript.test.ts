import { describe, expect, it } from "vite-plus/test";
import type { ThreadSnapshot, ToolItem, TranscriptItem } from "@/lib/code/api";
import { describeTools, foldTurns, groupTools, lastErrorId } from "@/lib/code/transcript";
import { applyThreadEvent } from "@/lib/code/use-thread";

const tool = (id: string, extra: Partial<ToolItem> = {}): ToolItem => ({
  kind: "tool",
  id,
  tool: "bash",
  name: "bash",
  input: {},
  summary: "",
  status: "done",
  images: [],
  ...extra,
});
const text = (id: string): TranscriptItem => ({ kind: "assistant", id, text: id });
const thinking = (id: string): TranscriptItem => ({ kind: "thinking", id, text: id });

describe("groupTools", () => {
  it("folds runs of finished tools (with the thinking between them) into one group", () => {
    const out = groupTools([
      text("a"),
      tool("t1"),
      thinking("th1"),
      tool("t2", { tool: "edit", name: "Edit" }),
      thinking("th2"),
      text("b"),
      tool("t3"),
      text("c"),
    ]);
    expect(out.map((i) => i.id)).toEqual(["a", "group:t1", "th2", "b", "t3", "c"]);
    const group = out[1]!;
    expect(group.kind === "tool-group" && group.items.map((i) => i.id)).toEqual([
      "t1",
      "th1",
      "t2",
    ]);
  });

  it("keeps running tools, subagents, plans and screenshots in view", () => {
    const out = groupTools([
      tool("t1"),
      tool("run", { status: "running" }),
      tool("t2"),
      tool("sub", { tool: "subagent", name: "Task" }),
      tool("plan", { tool: "todo", name: "TodoWrite" }),
      tool("shot", { tool: "browser", images: [{ ref: "img:x", name: "x", image: true }] }),
    ]);
    expect(out.map((i) => i.id)).toEqual(["t1", "run", "t2", "sub", "plan", "shot"]);
  });

  it("summarizes a group the way a developer reads it", () => {
    expect(
      describeTools([
        tool("a"),
        tool("b"),
        tool("c", { tool: "edit" }),
        tool("d", { tool: "read" }),
        tool("e", { tool: "other" }),
      ]),
    ).toBe("Ran 2 commands, edited 1 file, read 1 file, used 1 tool");
  });

  it("offers recovery only on an error nothing followed", () => {
    const error: TranscriptItem = { kind: "notice", id: "e", level: "error", text: "boom" };
    expect(lastErrorId([text("a"), error])).toBe("e");
    expect(lastErrorId([error, text("a")])).toBeNull();
  });
});

describe("foldTurns", () => {
  const user = (id: string): TranscriptItem => ({ kind: "user", id, text: id, attachments: [] });
  const turn = (id: string): TranscriptItem => ({
    kind: "turn",
    id,
    durationMs: 214_000,
    costUsd: 0.4,
  });

  it("folds a finished turn's work into one 'Worked for' row and keeps the answer in view", () => {
    const out = foldTurns([
      user("u1"),
      thinking("th1"),
      text("progress"),
      tool("t1"),
      tool("t2"),
      thinking("th2"),
      text("answer"),
      turn("end1"),
    ]);
    expect(out.map((i) => i.id)).toEqual(["u1", "work:th1", "answer"]);
    const work = out[1]!;
    expect(work.kind).toBe("work");
    if (work.kind !== "work") return;
    expect(work.durationMs).toBe(214_000);
    expect(work.costUsd).toBe(0.4);
    expect(work.items.map((i) => i.id)).toEqual(["th1", "progress", "group:t1", "th2"]);
  });

  it("leaves a running turn in view, and a turn with nothing to fold as it was", () => {
    const out = foldTurns([
      user("u1"),
      text("hi"),
      turn("end1"),
      user("u2"),
      thinking("th"),
      tool("t"),
    ]);
    expect(out.map((i) => i.id)).toEqual(["u1", "hi", "end1", "u2", "th", "t"]);
  });

  it("keeps a steer the user sent mid-turn inside its turn's fold", () => {
    const out = foldTurns([
      user("u1"),
      tool("t1"),
      user("steer"),
      tool("t2"),
      text("done"),
      turn("e"),
    ]);
    expect(out.map((i) => i.id)).toEqual(["u1", "work:t1", "done"]);
  });
});

describe("applyThreadEvent", () => {
  const snapshot: ThreadSnapshot = {
    thread: {
      id: "fake:t",
      instanceId: "fake",
      kind: "fake",
      nativeId: "t",
      title: "t",
      cwd: null,
      model: null,
      parentId: null,
      createdAt: "x",
      updatedAt: "x",
      working: true,
      archived: false,
      cursor: 1,
    },
    items: [text("a")],
    settings: { model: null, effort: null, permissionMode: "acceptEdits" },
    queued: [],
    jobs: [],
    children: [],
    context: { used: 10, max: 100 },
    costUsd: 0,
  };

  it("starts from the snapshot, upserts rows by id, and clears the streaming tail", () => {
    const empty = applyThreadEvent(
      {
        thread: null,
        order: [],
        byId: new Map(),
        settings: null,
        queued: [],
        jobs: [],
        children: [],
        working: false,
        context: { used: 0 },
        costUsd: 0,
        partialText: "",
        partialThinking: "",
        cursor: 0,
      },
      { type: "snapshot", snapshot },
    );
    expect(empty.order).toEqual(["a"]);
    const streaming = applyThreadEvent(empty, { type: "partial", text: "Run", thinking: "" });
    expect(streaming.partialText).toBe("Run");
    const added = applyThreadEvent(streaming, {
      type: "items",
      items: [tool("t1", { status: "running" })],
      cursor: 2,
    });
    expect(added.order).toEqual(["a", "t1"]);
    const updated = applyThreadEvent(added, {
      type: "items",
      items: [tool("t1", { status: "done", output: "ok" }), text("b")],
      cursor: 3,
    });
    expect(updated.order).toEqual(["a", "t1", "b"]);
    expect(updated.byId.get("t1")).toMatchObject({ status: "done", output: "ok" });
    expect(updated.partialText).toBe("");
    expect(updated.cursor).toBe(3);
    const idle = applyThreadEvent(updated, { type: "state", working: false, costUsd: 0.5 });
    expect(idle).toMatchObject({ working: false, costUsd: 0.5 });
    expect(idle.thread?.working).toBe(false);
  });
});
