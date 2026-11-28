import { describe, expect, it } from "vite-plus/test";
import {
  parseThreadId,
  type ThreadSummary,
  type TranscriptItem,
  type TurnOutcome,
} from "../../../packages/code/src/contracts";
import { turnAnswer, turnOutcome } from "../../../packages/code/src/server/index";
import { turnOutcomeProblems } from "../../../packages/code/src/testing";

let n = 0;
const id = () => `r${++n}`;
const user = (text: string): TranscriptItem => ({ kind: "user", id: id(), text, attachments: [] });
const said = (text: string): TranscriptItem => ({ kind: "assistant", id: id(), text });
const thought = (text: string): TranscriptItem => ({ kind: "thinking", id: id(), text });
const tool = (): TranscriptItem => ({
  kind: "tool",
  id: id(),
  tool: "bash",
  name: "bash",
  input: {},
  summary: "ls",
  status: "done",
  images: [],
});
const notice = (level: "error" | "info", text: string): TranscriptItem => ({
  kind: "notice",
  id: id(),
  level,
  text,
});
const turn = (): TranscriptItem => ({ kind: "turn", id: id() });

const thread: ThreadSummary = {
  id: "fake:t1",
  instanceId: "fake",
  kind: "fake",
  nativeId: "t1",
  title: "fix",
  cwd: "/repo",
  model: null,
  parentId: null,
  createdAt: "2026-11-05T00:00:00Z",
  updatedAt: "2026-11-05T00:00:00Z",
  working: false,
  archived: false,
  cursor: 3,
};

describe("turnAnswer", () => {
  it("is the newest turn's last assistant text", () => {
    expect(turnAnswer([user("go"), said("Looking."), tool(), said("Done."), turn()])).toEqual({
      text: "Done.",
      failed: false,
    });
  });

  it("reads consecutive text rows (one message split in blocks) as one answer", () => {
    expect(
      turnAnswer([user("go"), tool(), said("Done:"), thought("hm"), said("3 files."), turn()]),
    ).toEqual({ text: "Done:\n3 files.", failed: false });
  });

  it("is the error when the turn ended in one", () => {
    expect(
      turnAnswer([user("go"), said("Trying."), notice("error", "rate limited"), turn()]),
    ).toEqual({ text: "rate limited", failed: true });
    expect(turnAnswer([user("go"), notice("error", "boom")])).toEqual({
      text: "boom",
      failed: true,
    });
  });

  it("keeps the turn's answer before a steer the turn ended without answering", () => {
    expect(
      turnAnswer([
        user("task"),
        said("Halfway."),
        user("also docs"),
        notice("info", "Stopped."),
        turn(),
      ]),
    ).toEqual({ text: "Halfway.", failed: false });
  });

  it("is empty for a turn opened after the last turn end, never an earlier turn's answer", () => {
    expect(turnAnswer([user("one"), said("First done."), turn(), user("two")])).toEqual({
      text: "",
      failed: false,
    });
    expect(
      turnAnswer([
        user("one"),
        said("First done."),
        turn(),
        user("two"),
        notice("info", "Stopped."),
        turn(),
      ]),
    ).toEqual({ text: "", failed: false });
    expect(turnAnswer([user("one"), notice("error", "boom"), user("two")])).toEqual({
      text: "",
      failed: false,
    });
    expect(turnAnswer([])).toEqual({ text: "", failed: false });
  });

  it("is chat-sized: trimmed and cut to an excerpt", () => {
    const { text } = turnAnswer([user("go"), said(`  ${"x".repeat(2000)}  `), turn()]);
    expect(text).toHaveLength(1500);
    expect(text.endsWith("…")).toBe(true);
    expect(turnAnswer([user("go"), said("  Done.\n")]).text).toBe("Done.");
  });
});

describe("turnOutcome", () => {
  it("is the thread's state with the rule's answer", () => {
    expect(
      turnOutcome({ thread, items: [user("go"), said("Done."), turn()], endedAt: 42 }),
    ).toEqual({
      working: false,
      title: "fix",
      cwd: "/repo",
      text: "Done.",
      failed: false,
      endedAt: 42,
      cursor: 3,
    });
  });

  it("drops endedAt while the thread works, or when it is not a time", () => {
    const working = turnOutcome({ thread: { ...thread, working: true }, items: [], endedAt: 42 });
    expect(working).not.toHaveProperty("endedAt");
    expect(turnOutcome({ thread, items: [], endedAt: Number.NaN })).not.toHaveProperty("endedAt");
    expect(turnOutcome({ thread, items: [] })).not.toHaveProperty("endedAt");
  });
});

describe("turnOutcomeProblems", () => {
  const items = [user("go"), said("Done."), turn()];
  const snapshot = { thread, items };
  const good: TurnOutcome = turnOutcome({ thread, items, endedAt: 42 });

  it("is empty for an outcome built by the rule over the thread it shows", () => {
    expect(turnOutcomeProblems(snapshot, good, good)).toEqual([]);
  });

  it("names every way a driver departs from the rule", () => {
    expect(
      turnOutcomeProblems(snapshot, { ...good, text: "Done. (final)", failed: true, cursor: 2 }),
    ).toEqual([
      "cursor is 2, the thread's is 3",
      'text is "Done. (final)", the rule answers "Done."',
      "failed is true, the rule answers false",
    ]);
    const { endedAt: _, ...noTime } = good;
    expect(turnOutcomeProblems(snapshot, noTime)).toEqual([
      "endedAt is missing for an answered turn",
    ]);
    expect(
      turnOutcomeProblems(
        { thread: { ...thread, working: true }, items },
        { ...good, working: true },
      ),
    ).toEqual(["endedAt is set while the thread works"]);
    expect(turnOutcomeProblems(snapshot, good, { ...good, text: "other" })).toEqual([
      'turn_ended said text "other" but outcome() answers "Done."',
    ]);
  });

  it("names fields the rule does not answer, such as a thread spread into the outcome", () => {
    const spread = { ...thread, ...good };
    expect(turnOutcomeProblems(snapshot, spread, spread)).toEqual([
      "outcome has fields the rule does not answer: id, instanceId, kind, nativeId, model, parentId, createdAt, updatedAt, archived",
    ]);
  });
});

describe("parseThreadId", () => {
  it("splits `<instance>:<native>` and refuses an id with no instance", () => {
    expect(parseThreadId("claude-code:abc")).toEqual({
      instanceId: "claude-code",
      nativeId: "abc",
    });
    expect(parseThreadId("cA")).toBeUndefined();
    expect(parseThreadId(":cA")).toBeUndefined();
    expect(parseThreadId("Bad:cA")).toBeUndefined();
    expect(parseThreadId("shelley:a b")).toBeUndefined();
  });
});
