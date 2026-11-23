import type { MergeMethod, PullSnapshot } from "@tiny-agents/github";

const names = (checks: PullSnapshot["checks"]) => checks.map((check) => check.name).join(", ");

export function yoloWaiting(snapshot: PullSnapshot, method: MergeMethod): string | null {
  if (snapshot.mergeable === "conflicting")
    return "Waiting for the conflict with the base to be resolved.";
  const failing = snapshot.checks.filter((check) => check.state === "failure");
  if (failing.length) return `Waiting for ${names(failing)} to pass.`;
  const pending = snapshot.checks.filter((check) => check.state === "pending");
  if (pending.length) return `Waiting for ${names(pending)} to finish.`;
  if (snapshot.mergeable === "unknown") return "Waiting for GitHub to say the branch can merge.";
  if (snapshot.inMergeQueue) return "Waiting in the merge queue.";
  if (!snapshot.mergeMethods.includes(method))
    return `Waiting: the repository no longer allows ${method} merges.`;
  return null;
}
