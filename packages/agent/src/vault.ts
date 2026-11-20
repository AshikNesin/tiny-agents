import type { Context } from "@earendil-works/chord";
import { defineDoc, type ToolExecutionApi } from "@earendil-works/pi-durable";
import type { SecretValue } from "@tiny-agents/sandbox";

export { SecretValue, VaultTargetMovedError } from "@tiny-agents/sandbox";

export const VAULT_KINDS = ["login", "card", "identity", "api_key"] as const;
export type VaultKind = (typeof VAULT_KINDS)[number];

export type VaultApproval = "every_use" | "per_conversation" | "allowed";

export type SecretField =
  | "username"
  | "password"
  | "totp"
  | "card_number"
  | "card_expiry"
  | "card_cvc"
  | "card_holder"
  | "value";

export interface VaultItemMeta {
  handle: string;
  kind: VaultKind;
  label: string;
  username?: string;
  origins: string[];
  allowedHosts: string[];
  inject?: { as: "header"; name: string; format: string };
  hasTotp: boolean;
  card?: { brand: string; last4: string; expiry: string };
  whenToUse?: string;
  approval: VaultApproval;
  tools: string[];
}

export const VAULT_TARGET_KINDS = [
  "origin",
  "host",
  "command",
  "connection",
  "window",
  "provider",
  "github",
] as const;
export type VaultTargetKind = (typeof VAULT_TARGET_KINDS)[number];

export interface VaultUse {
  handle: string;
  tool: string;
  targetKind: VaultTargetKind;
  target: string;
  conversation: number;
  granted: boolean;
}

export interface VaultCard {
  handle: string;
  label: string;
  kind: VaultKind;
  tool: string;
  target: string;
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

export type VaultPlan =
  | { refused: VaultRefusal; message: string }
  | {
      refused?: undefined;
      approve: boolean;
      grantable: boolean;
      unattended: boolean;
      card: VaultCard;
    };

export type VaultOutcome =
  | "used"
  | "approved_used"
  | "denied"
  | "expired"
  | VaultRefusal
  | "backend_error"
  | "sink_error";

export interface VaultBroker {
  list(scope: { conversation: number; tool?: string; origin?: string }): Promise<VaultItemMeta[]>;
  plan(use: VaultUse): Promise<VaultPlan>;
  use<T>(
    use: VaultUse & { approved: boolean },
    fields: readonly SecretField[] | ((item: VaultItemMeta) => readonly SecretField[]),
    sink: (values: SecretValues, item: VaultItemMeta) => Promise<T>,
  ): Promise<T>;
  record(use: VaultUse, outcome: VaultOutcome, reason?: string): Promise<void>;
  requested(request: {
    conversation: number;
    taskId: number;
    origin: string;
    title: string;
  }): Promise<{ savedHandle?: string }>;
}

export type SecretValues = Partial<Record<SecretField, SecretValue>>;

export class VaultError extends Error {
  constructor(
    readonly code: VaultRefusal | "backend_error" | "missing_field",
    message: string,
  ) {
    super(message);
    this.name = "VaultError";
  }
}

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

export const VAULT_RULE =
  "Never type, ask for or repeat a password, card number, security code or one-time code yourself.";
