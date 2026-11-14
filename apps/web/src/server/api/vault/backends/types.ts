/**
 * The vault backend port (issue #56): where secret values live. tiny-agents
 * stores only references (`VaultItem`); a backend lists items (metadata, no
 * values), resolves one value at use time and, when writable, round-trips
 * the owner's edits from the Vault UI.
 */
import type { SecretValue, VaultKind } from "@tiny-agents/agent";
import type { AppDatabase } from "../../../db";

import type { BackendStatus, ValueField, VaultBackendName } from "../../../../shared/api/vault";

export type { BackendStatus, ValueField };

export type BackendName = VaultBackendName;

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
  /** Every item, linked or not; one that can't be read is named, never fatal (C11). */
  listCandidates(): Promise<CandidateListing>;
  /**
   * A backend that seals values itself (local) opens every item under the
   * policy of the row that links it (S11, `vaultPolicyDigest`), on every
   * read: listing, describe and resolve alike. A value whose row's policy
   * changed behind the service's back doesn't open.
   */
  describe(externalId: string): Promise<BackendItemSummary>;
  /** One value; called only after policy passed (or by the owner's reveal). */
  resolve(externalId: string, field: ValueField): Promise<SecretValue>;
  /** `policy`: the digest of the row about to link the new item. */
  create?(draft: ItemDraft, policy?: string): Promise<string>;
  /** Set the given values (and title/urls); fields not named are left as they are. */
  update?(externalId: string, draft: Partial<ItemDraft>): Promise<void>;
  remove?(externalId: string): Promise<void>;
  /**
   * Re-seal an item under the digest its row is about to have (the owner
   * changed its policy, or links it), and write that row with `writeRow` in
   * the same transaction: the value and its row never disagree, and a row
   * write that fails leaves the value as it was.
   */
  rebind?<T>(externalId: string, policy: string, writeRow: (tx: DbTx) => T): Promise<T>;
}

/** `db`, or a synchronous transaction on it (R7). */
export type DbTx = Pick<AppDatabase, "select" | "insert" | "update" | "delete">;

/** `listCandidates`: the items, and those that can't be read with why. */
export interface CandidateListing {
  items: BackendItemSummary[];
  unreadable: { externalId: string; reason: string }[];
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
