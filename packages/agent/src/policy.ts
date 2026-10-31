/**
 * A conversation's tool policy, compiled once from the bot's selection.
 *
 * "Will tool X run, ask, be reviewed or be hidden?" depends only on the
 * capability catalog, the bot's selection (enabled capabilities, per-tool
 * permissions, auto-review, unattended) and what is installed right now, so
 * it is a pure function here. The runtime applies the result: the agent
 * change pi-durable stores (extensions, hidden tools) and the conversation's
 * `tiny.permissions` document the approval gate reads.
 */
import type { Extension, Registry, ToolRegistration } from "@earendil-works/pi-durable";
import { defineDoc } from "@earendil-works/pi-durable";
import type { Context } from "@earendil-works/chord";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import { effectivePermission, type Capability, type CapabilitySelection } from "./capabilities";

/**
 * Which tools of the conversation run without asking (`allow`), which of the
 * asking ones auto-review may approve (`review`, absent when it is off), and
 * whether nobody is there to ask (`unattended`, absent when someone is).
 * A conversation without the document predates permissions and runs
 * everything.
 */
export const PermissionsDoc = defineDoc<{
  allow: string[];
  review?: string[];
  unattended?: boolean;
}>({
  kind: "tiny.permissions",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "current",
  initial: () => ({ allow: [] }),
  checkpointWhen: () => false,
});

export interface Permissions {
  allow: string[];
  review?: string[];
  unattended?: boolean;
}

/** What a selection compiles to: what the model sees, and what the gate lets through. */
export interface CompiledPolicy {
  /** Installed extensions of the enabled capabilities (by identity; pi-durable stores names). */
  extensions: Extension[];
  /** Installed tools removed from the model: `off`, and unattended-only ones in a chat. */
  remove: ToolRegistration[];
  permissions: Permissions;
}

/** The slice of a registry snapshot the compiler reads. */
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
  for (const capability of selected) {
    const extension = installed.extension(capability.id);
    if (extension) extensions.push(extension);
    for (const tool of capability.tools) {
      const permission = effectivePermission(tool, selection.permissions);
      const hiddenHere = tool.unattendedOnly === true && !selection.unattended;
      if (hiddenHere || permission === "off") {
        const registration = extension?.tools?.find((candidate) => candidate.name === tool.name);
        if (registration) remove.push(registration);
        continue;
      }
      if (permission === "allow") allow.push(tool.name);
      // Auto-review judges tools that would ask, never askOnly ones, never unattended.
      else if (selection.autoReview && !selection.unattended && !tool.askOnly) {
        review.push(tool.name);
      }
    }
  }
  return {
    extensions,
    remove,
    permissions: {
      allow,
      ...(review.length > 0 ? { review } : {}),
      ...(selection.unattended ? { unattended: true } : {}),
    },
  };
}

/** Write compiled permissions onto the conversation's document (a draft or a plain object). */
export function applyPermissions(doc: Permissions, permissions: Permissions): void {
  doc.allow = permissions.allow;
  if (permissions.review) doc.review = permissions.review;
  else delete doc.review;
  if (permissions.unattended) doc.unattended = true;
  else delete doc.unattended;
}

/**
 * Resolve a bot's model id to (provider, model). Catalog ids are plain;
 * gateway custom providers use "custom:<provider>/<model>" (the slash inside
 * the provider segment is forbidden by registration, so the first "/"
 * splits). `has` says whether the registry knows the pair.
 */
export function resolveModelId(
  modelId: string,
  provider: string,
  has: (provider: string, model: string) => boolean,
): { provider: string; model: string } | undefined {
  if (modelId.startsWith("custom:")) {
    const rest = modelId.slice("custom:".length);
    const slash = rest.indexOf("/");
    if (slash <= 0) return undefined;
    const providerId = rest.slice(0, slash);
    const model = rest.slice(slash + 1);
    return has(providerId, model) ? { provider: providerId, model } : undefined;
  }
  return has(provider, modelId) ? { provider, model: modelId } : undefined;
}

// ── What a running tool call reads ──────────────────────────────────────

/** The conversation's permissions say nobody is there to answer (a routine's, issue #63). */
export async function isUnattendedConversation(
  api: ToolExecutionApi,
  context: Context,
): Promise<boolean> {
  const permissions = await api.snapshot(PermissionsDoc, api.conversationId, context);
  return permissions?.unattended === true;
}

/** Whether the tool's permission would ask the owner before it runs. */
export async function mustAsk(
  name: string,
  api: ToolExecutionApi,
  context: Context,
): Promise<boolean> {
  const permissions = await api.snapshot(PermissionsDoc, api.conversationId, context);
  return permissions !== undefined && !permissions.allow.includes(name);
}

/** Whether auto-review may approve this tool's calls in the conversation. */
export async function mayAutoReview(
  name: string,
  api: ToolExecutionApi,
  context: Context,
): Promise<boolean> {
  const permissions = await api.snapshot(PermissionsDoc, api.conversationId, context);
  return permissions?.review?.includes(name) === true;
}
