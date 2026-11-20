import type { Extension, Registry, ToolRegistration } from "@earendil-works/pi-durable";
import { defineDoc, UsageDoc, type UsageState } from "@earendil-works/pi-durable";
import type { Context } from "@earendil-works/chord";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import { TOOL_SEARCH_TOOL_NAME } from "@earendil-works/pi-durable/tool-search";
import {
  effectivePermission,
  hiddenWhere,
  TOOL_SEARCH_CAPABILITY,
  type Capability,
  type CapabilitySelection,
} from "./capabilities";
import { CONTEXT_TRIM } from "./context-trim";

export const PermissionsDoc = defineDoc<{
  allow: string[];
  review?: string[];
  unattended?: boolean;
  budgetTokens?: number;
}>({
  kind: "tiny.permissions",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "current",
  initial: () => ({ allow: [] }),
  checkpointWhen: () => false,
});

export const YoloDoc = defineDoc<{ on: boolean; since?: number; by?: number }>({
  kind: "tiny.yolo",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ on: false }),
  checkpointWhen: () => false,
});

export interface Permissions {
  allow: string[];
  review?: string[];
  unattended?: boolean;
  budgetTokens?: number;
}

export interface CompiledPolicy {
  extensions: Extension[];
  remove: ToolRegistration[];
  permissions: Permissions;
}

export type InstalledExtensions = Pick<ReturnType<Registry["snapshot"]>, "extension">;

export function compilePolicy(
  catalog: ReadonlyMap<string, Capability>,
  selection: CapabilitySelection,
  installed: InstalledExtensions,
): CompiledPolicy {
  const selected = selection.enabled
    .map((id) => catalog.get(id))
    .filter((capability): capability is Capability => capability !== undefined);
  const extensions: Extension[] = [];
  const remove: ToolRegistration[] = [];
  const allow: string[] = [];
  const review: string[] = [];
  const trim = installed.extension(CONTEXT_TRIM);
  if (trim) extensions.push(trim);
  for (const capability of selected) {
    const extension = installed.extension(capability.id);
    if (extension) extensions.push(extension);
    for (const tool of capability.tools) {
      const permission = effectivePermission(tool, selection.permissions);
      const hiddenHere = hiddenWhere(tool, selection);
      if (hiddenHere || permission === "off") {
        const registration = extension?.tools?.find((candidate) => candidate.name === tool.name);
        if (registration) remove.push(registration);
        continue;
      }
      if (permission === "allow") allow.push(tool.name);
      else if (selection.autoReview && !selection.unattended && !tool.askOnly) {
        review.push(tool.name);
      }
    }
  }
  const searchable = extensions.some((extension) =>
    extension.tools?.some(
      (tool) => tool.deferred === true && !remove.some((gone) => gone.name === tool.name),
    ),
  );
  if (!searchable) {
    const search = installed
      .extension(TOOL_SEARCH_CAPABILITY)
      ?.tools?.find((tool) => tool.name === TOOL_SEARCH_TOOL_NAME);
    if (search && extensions.some((extension) => extension.name === TOOL_SEARCH_CAPABILITY))
      remove.push(search);
  }
  return {
    extensions,
    remove,
    permissions: {
      allow,
      ...(review.length > 0 ? { review } : {}),
      ...(selection.unattended ? { unattended: true } : {}),
      ...(selection.budgetTokens !== undefined && selection.budgetTokens > 0
        ? { budgetTokens: selection.budgetTokens }
        : {}),
    },
  };
}

export function applyPermissions(doc: Permissions, permissions: Permissions): void {
  doc.allow = permissions.allow;
  if (permissions.review) doc.review = permissions.review;
  else delete doc.review;
  if (permissions.unattended) doc.unattended = true;
  else delete doc.unattended;
  if (permissions.budgetTokens !== undefined) doc.budgetTokens = permissions.budgetTokens;
  else delete doc.budgetTokens;
}

export function usedTokens(usage: Readonly<UsageState> | undefined): number {
  if (!usage) return 0;
  let total = 0;
  for (const bucket of [usage.models, usage.tools]) {
    for (const entry of Object.values(bucket ?? {})) {
      const tokens = (entry as { totalTokens?: unknown }).totalTokens;
      if (typeof tokens === "number" && Number.isFinite(tokens)) total += tokens;
    }
  }
  return total;
}

export async function tokenBudget(
  api: ToolExecutionApi,
  context: Context,
): Promise<{ budget: number; used: number } | undefined> {
  const permissions = await api.snapshot(PermissionsDoc, api.conversationId, context);
  const budget = permissions?.budgetTokens;
  if (budget === undefined || budget <= 0) return undefined;
  let usage: UsageState | undefined;
  try {
    usage = await api.snapshot(UsageDoc, api.conversationId, context);
  } catch {
    usage = undefined;
  }
  return { budget, used: usedTokens(usage) };
}

export async function isUnattendedConversation(
  api: ToolExecutionApi,
  context: Context,
): Promise<boolean> {
  const permissions = await api.snapshot(PermissionsDoc, api.conversationId, context);
  return permissions?.unattended === true;
}

export async function mustAsk(
  name: string,
  api: ToolExecutionApi,
  context: Context,
): Promise<boolean> {
  const permissions = await api.snapshot(PermissionsDoc, api.conversationId, context);
  return permissions !== undefined && !permissions.allow.includes(name);
}

export async function yoloOf(
  api: ToolExecutionApi,
  context: Context,
): Promise<{ on: boolean; by?: number }> {
  const yolo = await api.snapshot(YoloDoc, api.conversationId, context);
  return yolo?.on === true
    ? { on: true, ...(yolo.by !== undefined ? { by: yolo.by } : {}) }
    : { on: false };
}

export interface GateUserMessage {
  text: string;
  peer: boolean;
  author?: number;
}

export function fromOwner(message: GateUserMessage, by: number | undefined): boolean {
  if (message.peer) return false;
  return message.author === undefined || message.author === by;
}

export function ownerTurn(
  newestFirst: readonly GateUserMessage[],
  by: number | undefined,
): boolean {
  const last = newestFirst[0];
  return last !== undefined && fromOwner(last, by);
}

export async function mayAutoReview(
  name: string,
  api: ToolExecutionApi,
  context: Context,
): Promise<boolean> {
  const permissions = await api.snapshot(PermissionsDoc, api.conversationId, context);
  return permissions?.review?.includes(name) === true;
}
