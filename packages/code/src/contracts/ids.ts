/**
 * Thread identity across harnesses. A harness *instance* (`shelley`,
 * `claude-code`) owns native thread ids; the app addresses a thread as
 * `<instanceId>:<nativeId>`, so the merged list never collides and every
 * route can pick its adapter from the id alone.
 */

/** One configured harness: `shelley`, `claude-code` (later `shelley-vm2`, …). */
export type InstanceId = string;

/** The integration an instance runs: which driver built it. */
export type HarnessKind = "shelley" | "claude-code" | (string & {});

/** `<instanceId>:<nativeId>`. */
export type ThreadId = string;

const INSTANCE_ID = /^[a-z][a-z0-9-]{0,39}$/;
const NATIVE_ID = /^[A-Za-z0-9_.-]{1,128}$/;

export function isInstanceId(value: string): boolean {
  return INSTANCE_ID.test(value);
}

export function isNativeId(value: string): boolean {
  return NATIVE_ID.test(value);
}

export function threadIdOf(instanceId: InstanceId, nativeId: string): ThreadId {
  return `${instanceId}:${nativeId}`;
}

/**
 * The instance bare thread ids belong to: links, cards and pushes written
 * before ADR 0011 named a Shelley conversation alone.
 */
export const LEGACY_INSTANCE_ID: InstanceId = "shelley";

/**
 * Split a thread id; undefined when it is not `<instance>:<native>` with
 * valid parts. With `legacyInstanceId`, a bare native id (no `:`) belongs to
 * that instance. The one parser of thread ids: nothing else splits them.
 */
export function parseThreadId(
  id: string,
  legacyInstanceId?: InstanceId,
): { instanceId: InstanceId; nativeId: string } | undefined {
  const at = id.indexOf(":");
  if (at < 0) {
    return legacyInstanceId !== undefined && isNativeId(id)
      ? { instanceId: legacyInstanceId, nativeId: id }
      : undefined;
  }
  if (at === 0) return undefined;
  const instanceId = id.slice(0, at);
  const nativeId = id.slice(at + 1);
  if (!isInstanceId(instanceId) || !isNativeId(nativeId)) return undefined;
  return { instanceId, nativeId };
}
