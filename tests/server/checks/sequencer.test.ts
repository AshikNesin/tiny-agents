import { describe, expect, it } from "vite-plus/test";
import { shardByDuration, shuffled } from "../../sequencer";

const durations = { a: 50, b: 40, c: 30, d: 20, e: 10 };

describe("shardByDuration", () => {
  it("puts every file in exactly one shard, longest first onto the lightest shard", () => {
    const files = ["a", "b", "c", "d", "e"];
    const shards = [1, 2].map((i) => shardByDuration(files, durations, i, 2));
    expect(shards).toEqual([
      ["a", "d", "e"],
      ["b", "c"],
    ]);
  });

  it("counts a file without a recorded duration as the median", () => {
    expect(shardByDuration(["x", "y", "z", "new"], { x: 50, y: 30, z: 10 }, 2, 2)).toEqual([
      "new",
      "y",
    ]);
    expect(shardByDuration(["x", "y", "z", "new"], { x: 50, y: 30, z: 10 }, 1, 2)).toEqual([
      "x",
      "z",
    ]);
  });

  it("splits by time, not count: one long file gets a shard to itself", () => {
    const files = ["long", "s1", "s2", "s3"];
    const times = { long: 100, s1: 10, s2: 10, s3: 10 };
    expect(shardByDuration(files, times, 1, 2)).toEqual(["long"]);
    expect(shardByDuration(files, times, 2, 2)).toEqual(["s1", "s2", "s3"]);
  });
});

describe("shuffled", () => {
  it("replays one order per seed and keeps every item", () => {
    const list = Array.from({ length: 20 }, (_, i) => i);
    expect(shuffled(list, 7)).toEqual(shuffled(list, 7));
    expect(shuffled(list, 7)).not.toEqual(shuffled(list, 8));
    expect([...shuffled(list, 7)].sort((a, b) => a - b)).toEqual(list);
  });
});
