import { describe, expect, it } from "vite-plus/test";
import {
  SessionLog,
  resumeResultOf,
  type Sequenced,
} from "../../../../packages/claude-worker/src/index";

function filled(capacity: number, count: number): SessionLog<string> {
  const log = new SessionLog<string>("s1", capacity);
  for (let index = 1; index <= count; index += 1) log.append(`e${index}`);
  return log;
}

describe("session log", () => {
  it("numbers events from 1 and stamps the session id", () => {
    const log = new SessionLog<string>("s1", 10);
    expect(log.lastSeq).toBe(0);
    expect(log.firstSeq).toBe(1);
    expect(log.append("a")).toEqual({ sessionId: "s1", seq: 1, event: "a" });
    expect(log.append("b")).toEqual({ sessionId: "s1", seq: 2, event: "b" });
    expect(log.lastSeq).toBe(2);
    expect(log.firstSeq).toBe(1);
  });

  it("replays the events after a cursor, oldest first", () => {
    const log = filled(10, 4);
    expect(log.replay(0).map((event) => event.seq)).toEqual([1, 2, 3, 4]);
    expect(log.replay(2).map((event) => event.event)).toEqual(["e3", "e4"]);
    expect(log.replay(4)).toEqual([]);
  });

  it("keeps only the last `capacity` events, and seq keeps counting", () => {
    const log = filled(3, 5);
    expect(log.replay(0).map((event) => event.seq)).toEqual([3, 4, 5]);
    expect(log.firstSeq).toBe(3);
    expect(log.lastSeq).toBe(5);
  });

  it("answers a resume, with a gap once events after the cursor were dropped", () => {
    const log = filled(3, 5);
    expect(log.resume(2)).toEqual({ known: true, gap: false, firstSeq: 3, lastSeq: 5 });
    expect(log.resume(5)).toEqual({ known: true, gap: false, firstSeq: 3, lastSeq: 5 });
    expect(log.resume(1)).toEqual({ known: true, gap: true, firstSeq: 3, lastSeq: 5 });
    expect(new SessionLog("s2", 3).resume(0)).toEqual({
      known: true,
      gap: false,
      firstSeq: 1,
      lastSeq: 0,
    });
  });

  it("answers an unknown session for a log the worker does not hold", () => {
    expect(resumeResultOf(undefined, 4)).toEqual({
      known: false,
      gap: false,
      firstSeq: 1,
      lastSeq: 0,
    });
    expect(resumeResultOf(filled(10, 2), 0)).toMatchObject({ known: true, lastSeq: 2 });
  });

  it("hands every appended event to each subscriber until it unsubscribes", () => {
    const log = new SessionLog<string>("s1", 10);
    log.append("before");
    const first: Sequenced<string>[] = [];
    const second: Sequenced<string>[] = [];
    const listener = (event: Sequenced<string>) => first.push(event);
    log.subscribe(listener);
    log.subscribe(listener);
    const stop = log.subscribe((event) => second.push(event));
    log.append("a");
    stop();
    log.append("b");
    expect(first.map((event) => event.event)).toEqual(["a", "b"]);
    expect(second.map((event) => event.event)).toEqual(["a"]);
  });
});
