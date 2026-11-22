import { describe, expect, it } from "vite-plus/test";
import { threadStatus, type ThreadFacts } from "../../../apps/web/src/shared/code-status";

const idle: ThreadFacts = {
  working: false,
  attention: null,
  unread: false,
  lastRun: null,
  pull: null,
};

describe("a thread's status", () => {
  it("is done when nothing is open and everything was read", () => {
    expect(threadStatus(idle)).toEqual({ group: "done", reason: null });
  });

  it("needs you while the agent waits on an approval, even though it is still working", () => {
    expect(threadStatus({ ...idle, working: true, attention: "Wants to run pnpm test" })).toEqual({
      group: "needs-you",
      reason: "asks you",
    });
  });

  it("is working, and names the workflow that started the run", () => {
    expect(threadStatus({ ...idle, working: true })).toEqual({ group: "working", reason: null });
    expect(
      threadStatus({ ...idle, working: true, lastRun: { status: "running", workflow: "fix_ci" } }),
    ).toEqual({ group: "working", reason: "Fix CI" });
  });

  it("needs you after a failed run, read or not", () => {
    expect(threadStatus({ ...idle, lastRun: { status: "failed", workflow: null } })).toEqual({
      group: "needs-you",
      reason: "failed",
    });
  });

  it("needs you when a turn finished or was stopped and nobody has read it", () => {
    expect(threadStatus({ ...idle, unread: true })).toEqual({
      group: "needs-you",
      reason: "finished",
    });
    expect(
      threadStatus({ ...idle, unread: true, lastRun: { status: "stopped", workflow: null } }),
    ).toEqual({ group: "needs-you", reason: "stopped" });
  });

  it("needs you when its pull request loop stopped for the owner", () => {
    expect(threadStatus({ ...idle, pull: { loop: "needs_input", number: 12 } })).toEqual({
      group: "needs-you",
      reason: "pull request",
    });
  });

  it("is in review with an open pull request, and done once it merged", () => {
    expect(threadStatus({ ...idle, pull: { loop: "watching", number: 12 } })).toEqual({
      group: "review",
      reason: null,
    });
    expect(threadStatus({ ...idle, pull: { loop: "green", number: 12 } })).toEqual({
      group: "review",
      reason: "checks pass",
    });
    expect(threadStatus({ ...idle, pull: { loop: "merged", number: 12 } })).toEqual({
      group: "done",
      reason: "merged",
    });
  });
});
