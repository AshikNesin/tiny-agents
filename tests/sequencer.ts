/**
 * The test sequencer for both suites: files run in a random order picked by
 * the run's seed (`sequence.shuffle`), and `--shard=i/n` splits files by how
 * long each took on a real run (tests/durations.json), not by count, so every
 * CI shard finishes at about the same time. Vitest still finds the files: a
 * shard is always a subset of what the config includes, and the shards of a
 * run together hold every file exactly once.
 *
 * Refresh the durations with `pnpm test:durations` when a suite's shape
 * changes; a file missing from them counts as the median.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BaseSequencer, type TestSpecification } from "vite-plus/test/node";

/** Durations are keyed from the repo root; the client config's root is apps/web. */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DURATIONS_FILE = path.join(REPO_ROOT, "tests/durations.json");

/** File (repo-relative, POSIX) → milliseconds it took on the recorded run. */
export type Durations = Record<string, number>;

function readDurations(file = DURATIONS_FILE): Durations {
  return JSON.parse(readFileSync(file, "utf8")) as Durations;
}

/**
 * Split `files` into `count` shards of about equal recorded time: longest
 * file first, each onto the shard with the least so far (ties to the lower
 * shard, then by path, so every shard computes the same split). Returns the
 * files of shard `index` (1-based).
 */
export function shardByDuration(
  files: readonly string[],
  durations: Durations,
  index: number,
  count: number,
): string[] {
  const known = files.map((file) => durations[file]).filter((ms) => ms !== undefined);
  const sorted = [...known].sort((a, b) => a - b);
  const median = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)]! : 1;
  const weighted = files
    .map((file) => ({ file, ms: durations[file] ?? median }))
    .sort((a, b) => b.ms - a.ms || a.file.localeCompare(b.file));
  const loads = Array.from({ length: count }, () => 0);
  const shards: string[][] = Array.from({ length: count }, () => []);
  for (const { file, ms } of weighted) {
    let least = 0;
    for (let i = 1; i < count; i++) if (loads[i]! < loads[least]!) least = i;
    loads[least]! += ms;
    shards[least]!.push(file);
  }
  return shards[index - 1] ?? [];
}

/** A seeded Fisher-Yates shuffle (mulberry32), so a seed replays an order. */
export function shuffled<T>(list: readonly T[], seed: number): T[] {
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export class DurationSequencer extends BaseSequencer {
  #relative(spec: TestSpecification): string {
    return path.relative(REPO_ROOT, spec.moduleId).split(path.sep).join("/");
  }

  override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const { index, count } = this.ctx.config.shard!;
    const durations = readDurations();
    const byFile = new Map(files.map((spec) => [this.#relative(spec), spec]));
    const mine = new Set(shardByDuration([...byFile.keys()], durations, index, count));
    return files.filter((spec) => mine.has(this.#relative(spec)));
  }

  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    const ordered = [...files].sort((a, b) => this.#relative(a).localeCompare(this.#relative(b)));
    return shuffled(ordered, this.ctx.config.sequence.seed);
  }
}
