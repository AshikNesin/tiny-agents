import { describe, expect, it } from "vite-plus/test";
import { CodeChanges, type ChangeEvent } from "../../../apps/web/src/server/api/code/code.changes";
import { until } from "../fixtures/until";

const intervals = { activeMs: 5, idleMs: 5, quietAfterMs: 1_000 };

function stamps() {
  let value = "a";
  let failing = false;
  let calls = 0;
  let running = 0;
  let overlapped = false;
  return {
    set: (next: string) => (value = next),
    fail: (on: boolean) => (failing = on),
    calls: () => calls,
    overlapped: () => overlapped,
    read: async () => {
      calls += 1;
      running += 1;
      if (running > 1) overlapped = true;
      await new Promise((resolve) => setTimeout(resolve, 3));
      running -= 1;
      if (failing) throw new Error("Cannot reach the sandbox");
      return value;
    },
  };
}

const last = (events: ChangeEvent[]) => events.at(-1);

describe("the change monitor", () => {
  it("tells every panel on a directory once per change, from one poll that never overlaps", async () => {
    const changes = new CodeChanges(intervals);
    const stamp = stamps();
    const a: ChangeEvent[] = [];
    const b: ChangeEvent[] = [];
    const stopA = changes.watch("/w", stamp.read, (e) => a.push(e));
    const stopB = changes.watch("/w", stamp.read, (e) => b.push(e));
    await until(() => a.length > 0 && b.length > 0, "the first version");
    expect(last(a)).toEqual({ type: "changes", version: 0 });
    expect(last(b)).toEqual({ type: "changes", version: 0 });

    const before = stamp.calls();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(a).toHaveLength(1);
    expect(stamp.calls() - before).toBeLessThan(60 / intervals.activeMs + 2);

    stamp.set("b");
    await until(() => last(a)?.type === "changes" && b.length === 2, "the change");
    expect(last(a)).toEqual({ type: "changes", version: 1 });
    expect(last(b)).toEqual({ type: "changes", version: 1 });
    expect(stamp.overlapped()).toBe(false);
    stopA();
    stopB();
  });

  it("stops reading when the last panel closes", async () => {
    const changes = new CodeChanges(intervals);
    const stamp = stamps();
    const stop = changes.watch("/w", stamp.read, () => {});
    await until(() => stamp.calls() >= 2, "a few reads");
    stop();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const after = stamp.calls();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(stamp.calls()).toBe(after);
  });

  it("says when it cannot read, then catches up with a new version", async () => {
    const changes = new CodeChanges(intervals);
    const stamp = stamps();
    const events: ChangeEvent[] = [];
    const stop = changes.watch("/w", stamp.read, (e) => events.push(e));
    await until(() => events.length > 0, "the first version");

    stamp.fail(true);
    await until(() => last(events)?.type === "unavailable", "unavailable");
    expect(last(events)).toEqual({ type: "unavailable", message: "Cannot reach the sandbox" });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(events.filter((e) => e.type === "unavailable")).toHaveLength(1);

    stamp.fail(false);
    await until(() => last(events)?.type === "changes", "the catch-up");
    expect(last(events)).toEqual({ type: "changes", version: 1 });
    stop();
  });

  it("gives a panel that opens later the current version at once", async () => {
    const changes = new CodeChanges(intervals);
    const stamp = stamps();
    const first: ChangeEvent[] = [];
    const stop = changes.watch("/w", stamp.read, (e) => first.push(e));
    await until(() => first.length > 0, "the first version");
    stamp.set("b");
    await until(async () => {
      const seen: ChangeEvent[] = [];
      changes.watch("/w", stamp.read, (e) => seen.push(e))();
      return seen[0]?.type === "changes" && seen[0].version === 1;
    }, "version 1");
    stop();
  });
});
