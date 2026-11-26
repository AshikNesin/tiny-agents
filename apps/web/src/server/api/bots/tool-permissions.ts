import { createNamespaceKv } from "@groot/core/kv";
import type { ToolPermission } from "@tiny-agents/agent";

type Permissions = Record<string, ToolPermission>;

const store = () => createNamespaceKv("TOOLS");

export async function ownerToolPermissions(): Promise<Permissions> {
  return (await store().get<Permissions>("permissions")) ?? {};
}

export async function setOwnerToolPermissions(permissions: Permissions): Promise<Permissions> {
  await store().set("permissions", permissions);
  return permissions;
}

export function botPermissions(owner: Permissions, bot: Permissions): Permissions {
  return { ...owner, ...bot };
}
