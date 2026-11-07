/**
 * The vault backend port (issue #56): where secret values live. tiny-agents
 * stores only references (`VaultItem`); a backend lists items (metadata, no
 * values), resolves one value at use time and, when writable, round-trips
 * the owner's edits from the Vault UI.
 */
import type { SecretValue, VaultKind } from "@tiny-agents/agent";

export type BackendName = "onepassword-connect" | "local";

/** Value fields an item can carry, across kinds. */
export type ValueField =
  | "username"
  | "password"
  | "totp"
  | "notes"
  | "card_number"
  | "card_expiry"
  | "card_cvc"
  | "card_holder"
  | "card_billing_address"
  | "identity_name"
  | "identity_email"
  | "identity_phone"
  | "identity_address"
  | "value";

export interface BackendStatus {
  state: "ready" | "unconfigured" | "error";
  /** `token_overscoped`, `unauthorized`, `unreachable`, … */
  code?: string;
  detail?: string;
  /** Vault titles the token can see that it must not (the guard's finding). */
  extraVaults?: string[];
}

/** What a backend says about an item without any value. */
export interface BackendItemSummary {
  externalId: string;
  title: string;
  /** "other" for categories the vault doesn't model. */
  kind: VaultKind | "other";
  urls: string[];
  username?: string;
  card?: { brand: string; last4: string; expiry: string };
  hasTotp: boolean;
  /** Fields that hold a value (for the UI's masked rows). */
  fields: ValueField[];
  updatedAt?: string;
}

/** A new or replaced item, as the owner typed it in the Vault UI. */
export interface ItemDraft {
  kind: VaultKind;
  title: string;
  urls?: string[];
  values: Partial<Record<ValueField, string>>;
}

export interface VaultBackend {
  readonly name: BackendName;
  readonly capabilities: {
    create: boolean;
    update: boolean;
    delete: boolean;
    reveal: boolean;
  };
  status(): Promise<BackendStatus>;
  listCandidates(): Promise<BackendItemSummary[]>;
  /**
   * `policy` is the digest of the linked row's policy (`vaultPolicyDigest`).
   * A backend that seals values itself (local) binds them to it, so a value
   * whose row's policy changed behind the service's back doesn't open;
   * others ignore it. Omitted for an item no row links yet.
   */
  describe(externalId: string, policy?: string): Promise<BackendItemSummary>;
  /** One value; called only after policy passed (or by the owner's reveal). */
  resolve(externalId: string, field: ValueField, policy?: string): Promise<SecretValue>;
  create?(draft: ItemDraft, policy?: string): Promise<string>;
  /** Set the given values (and title/urls); fields not named are left as they are. */
  update?(externalId: string, draft: Partial<ItemDraft>, policy?: string): Promise<void>;
  remove?(externalId: string): Promise<void>;
  /** Re-seal an item from one policy digest to another (the owner changed its policy). */
  rebind?(externalId: string, from: string | undefined, to: string): Promise<void>;
}

/** A backend failure with a code the owner sees and a fixed message bots see. */
export class BackendError extends Error {
  constructor(
    readonly code:
      | "unconfigured"
      | "unauthorized"
      | "unreachable"
      | "not_found"
      | "token_overscoped"
      | "missing_field"
      | "invalid"
      | "failed",
    message: string,
  ) {
    super(message);
    this.name = "BackendError";
  }
}
