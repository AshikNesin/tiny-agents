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

/**
 * YOLO mode (issue #151): the owner let every tool call in this chat run
 * without asking, except vault uses. Its own document, not a field of
 * `PermissionsDoc`, because that one is recompiled from the bot on every
 * send; this one is the chat's and only the owner's toggle writes it.
 * `by` is the owner's user id: in a shared chat only their messages are
 * trusted. A fork (a new chat) starts with it off.
 */
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

/** Whether the conversation's YOLO mode is on, and whose messages it trusts. */
export async function yoloOf(
  api: ToolExecutionApi,
  context: Context,
): Promise<{ on: boolean; by?: number }> {
  const yolo = await api.snapshot(YoloDoc, api.conversationId, context);
  return yolo?.on === true
    ? { on: true, ...(yolo.by !== undefined ? { by: yolo.by } : {}) }
    : { on: false };
}

/**
 * A user message as the Tool gate reads it, whichever engine keeps the
 * transcript: what it said, whether another bot put it there, and who sent
 * it in a shared chat.
 */
export interface GateUserMessage {
  text: string;
  /** A peer delivery: another bot's message, a relayed reply or a mention. */
  peer: boolean;
  /** The sender's user id in a shared chat; undefined in the owner's own chat. */
  author?: number;
}

/**
 * Whether the owner sent this message: it is not a peer delivery (another
 * bot, a relayed reply or a mention) and, in a shared chat, its author is
 * the owner (`by`). A guest's message is not the owner's.
 */
export function fromOwner(message: GateUserMessage, by: number | undefined): boolean {
  if (message.peer) return false;
  return message.author === undefined || message.author === by;
}

/**
 * Whether the turn is the owner's: the newest user message (newest first)
 * is `fromOwner`. YOLO and auto-review trust only that.
 */
export function ownerTurn(
  newestFirst: readonly GateUserMessage[],
  by: number | undefined,
): boolean {
  const last = newestFirst[0];
  return last !== undefined && fromOwner(last, by);
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
