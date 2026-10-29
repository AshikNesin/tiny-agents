/**
 * The vault port (issue #56): how toolkits use the owner's secrets without
 * the model ever seeing them.
 *
 * The model names items by opaque, owner-chosen handles ("github", "amex").
 * A sink tool resolves a value only at the tool boundary, after policy and
 * approval, through `VaultBroker.use`, which hands the values to a sink
 * callback (a browser field, an HTTP header) and never back to the caller.
 * The app implements the broker (apps/web/src/server/api/vault); this package
 * only defines the port, so packages never import from apps.
 */
import type { Context } from "@earendil-works/chord";
import { defineDoc, type ToolExecutionApi } from "@earendil-works/pi-durable";

export type VaultKind = "login" | "card" | "identity" | "api_key";

export type VaultApproval = "every_use" | "per_conversation" | "allowed";

/** One resolvable part of an item. */
export type SecretField =
  | "username"
  | "password"
  | "totp"
  | "card_number"
  | "card_expiry"
  | "card_cvc"
  | "card_holder"
  | "value";

/** What the model and the approval card may see about an item. Never a value. */
export interface VaultItemMeta {
  handle: string;
  kind: VaultKind;
  label: string;
  /** Login identifier: not secret, the bot types it itself. */
  username?: string;
  /** Exact origins a login or card fills on ("https://github.com"). */
  origins: string[];
  /** api_key: hosts its header may go to. */
  allowedHosts: string[];
  /** api_key: how `http_request` sends it. */
  inject?: { as: "header"; name: string; format: string };
  hasTotp: boolean;
  /** Display only. */
  card?: { brand: string; last4: string; expiry: string };
  /** The owner's hint for when to use it. */
  whenToUse?: string;
  approval: VaultApproval;
  /** Tools that may use it. */
  tools: string[];
}

/** One intended use of an item: what policy, the approval card and the audit see. */
export interface VaultUse {
  handle: string;
  /** The sink tool ("browser_fill_secret", "http_request", …). */
  tool: string;
  /** Origin, host or command the value goes to. */
  target: string;
  conversation: number;
  /** The owner granted this handle for the whole conversation. */
  granted: boolean;
}

/** Shown on the approval card; never a value. */
export interface VaultCard {
  handle: string;
  label: string;
  kind: VaultKind;
  tool: string;
  target: string;
  /** The requesting bot's name. */
  bot?: string;
  card?: { brand: string; last4: string };
  username?: string;
}

export type VaultRefusal =
  | "unknown_handle"
  | "disabled"
  | "refused_policy"
  | "refused_origin"
  | "refused_unattended"
  | "vault_locked";

/** The broker's decision for a use, before any value is resolved. */
export type VaultPlan =
  | { refused: VaultRefusal; message: string }
  | {
      refused?: undefined;
      /** The owner must approve this use. */
      approve: boolean;
      /** "Approve for this conversation" may be offered (never for cards). */
      grantable: boolean;
      /** The run has no owner watching (a routine or a peer bot's turn). */
      unattended: boolean;
      card: VaultCard;
    };

export type VaultOutcome =
  | "used"
  | "approved_used"
  | "denied"
  | "expired"
  | VaultRefusal
  | "backend_error";

/** Implemented in apps/web; injected into toolkits. */
export interface VaultBroker {
  /** Items this conversation's bot may use, optionally narrowed to a tool or origin. */
  list(scope: { conversation: number; tool?: string; origin?: string }): Promise<VaultItemMeta[]>;
  /** Policy check for a use; resolves nothing. */
  plan(use: VaultUse): Promise<VaultPlan>;
  /**
   * Re-check policy, resolve `fields` and call `sink` with them; audited, and
   * every value is registered with the redactor first. Never returns a value.
   * Fields the item has no value for are left out of `values` (a card without
   * a saved security code); none at all is a `missing_field` error.
   * Throws `VaultError` (with a model-safe message) when refused or the
   * backend fails.
   */
  use<T>(
    use: VaultUse & { approved: boolean },
    /** Fields to resolve, or chosen once the item is known (its kind). */
    fields: readonly SecretField[] | ((item: VaultItemMeta) => readonly SecretField[]),
    sink: (values: SecretValues, item: VaultItemMeta) => Promise<T>,
  ): Promise<T>;
  /** Audit an outcome the toolkit decided (a denial, an expired approval). */
  record(use: VaultUse, outcome: VaultOutcome, reason?: string): Promise<void>;
  /**
   * A credential request opened (the owner is notified). Returns the handle
   * of a saved login for its origin, which the sheet offers to update.
   */
  requested(request: {
    conversation: number;
    taskId: number;
    origin: string;
    title: string;
  }): Promise<{ savedHandle?: string }>;
}

export type SecretValues = Partial<Record<SecretField, SecretValue>>;

/** A refused or failed vault use. `message` is fixed text, safe for the model. */
export class VaultError extends Error {
  constructor(
    readonly code: VaultRefusal | "backend_error" | "missing_field",
    message: string,
  ) {
    super(message);
    this.name = "VaultError";
  }
}

const HIDDEN = "[vault]";

/** A value that can't be serialized or logged by accident. */
export class SecretValue {
  readonly #value: string;
  constructor(value: string) {
    this.#value = value;
  }
  /** Only sinks call this. */
  reveal(): string {
    return this.#value;
  }
  toJSON(): string {
    return HIDDEN;
  }
  toString(): string {
    return HIDDEN;
  }
  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return HIDDEN;
  }
}

/**
 * Standing grants of the conversation: `vault:<handle>` once the owner chose
 * "Approve for this conversation". A new chat is a new conversation, so
 * grants never outlive it.
 */
export const GrantsDoc = defineDoc<{ grants: string[] }>({
  kind: "tiny.grants",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ grants: [] }),
  checkpointWhen: () => false,
});

export const vaultGrant = (handle: string) => `vault:${handle}`;

export async function hasGrant(
  api: Pick<ToolExecutionApi, "snapshot" | "conversationId">,
  grant: string,
  context: Context,
): Promise<boolean> {
  const doc = await api.snapshot(GrantsDoc, api.conversationId, context);
  return doc?.grants.includes(grant) ?? false;
}

/** Model-facing tool text shared by every vault-aware tool. */
export const VAULT_RULE =
  "Never type, ask for or repeat a password, card number, security code or one-time code yourself.";
