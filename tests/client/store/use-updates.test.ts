/**
 * Settings → Updates polling (docs/guides/local-updates.md): after "Update &
 * restart" the page reloads only once a different release is up and idle,
 * and stops waiting when the update failed.
 */
import { describe, expect, it } from "vite-plus/test";
import { isBusy, pollOutcome } from "@/store/use-updates";
import type { UpdateStatus } from "../../../apps/web/src/shared/local-updates";

const OLD = "1".repeat(40);
const NEW = "2".repeat(40);

function status(overrides: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    track: "origin/main",
    current: { sha: OLD, version: "1.0.0", subject: "old", committedAt: 0 },
    latest: null,
    commits: [],
    sandboxChanged: false,
    phase: "idle",
    error: null,
    log: [],
    auto: false,
    lastCheckedAt: null,
    ...overrides,
  };
}
const running = (sha: string) => ({ sha, version: "1.0.0", subject: "", committedAt: 0 });

describe("pollOutcome", () => {
  it("reloads once a different release is up and idle", () => {
    expect(pollOutcome(status({ current: running(NEW) }), OLD)).toBe("reload");
  });

  it("keeps polling while restarting, while the server is down, and on the same release", () => {
    expect(pollOutcome(status({ phase: "restarting", current: running(NEW) }), OLD)).toBe(
      "keep-polling",
    );
    expect(pollOutcome(null, OLD)).toBe("keep-polling");
    expect(pollOutcome(status({ phase: "building" }), OLD)).toBe("keep-polling");
  });

  it("stops waiting when the update failed", () => {
    expect(pollOutcome(status({ phase: "failed" }), OLD)).toBe("update-failed");
  });

  it("never reloads when no update was started", () => {
    expect(pollOutcome(status({ current: running(NEW) }), null)).toBe("keep-polling");
  });
});

describe("isBusy", () => {
  it("is busy while the supervisor works or an update was started", () => {
    expect(isBusy(status({ phase: "building" }), null)).toBe(true);
    expect(isBusy(status(), OLD)).toBe(true);
    expect(isBusy(status(), null)).toBe(false);
    expect(isBusy(status({ phase: "failed" }), null)).toBe(false);
  });
});
