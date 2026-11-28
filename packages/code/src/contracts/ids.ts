export type InstanceId = string;

export type HarnessKind = "shelley" | "claude-code" | (string & {});

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

export function parseThreadId(
  id: string,
): { instanceId: InstanceId; nativeId: string } | undefined {
  const at = id.indexOf(":");
  if (at <= 0) return undefined;
  const instanceId = id.slice(0, at);
  const nativeId = id.slice(at + 1);
  if (!isInstanceId(instanceId) || !isNativeId(nativeId)) return undefined;
  return { instanceId, nativeId };
}
