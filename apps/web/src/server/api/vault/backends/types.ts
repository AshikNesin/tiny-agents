import type { SecretValue, VaultKind } from "@tiny-agents/agent";
import type { AppDatabase } from "../../../db";
import type { PolicyColumns } from "../vault.policy";

import type { BackendStatus, ValueField, VaultBackendName } from "../../../../shared/api/vault";

export type { BackendStatus, ValueField };

export type BackendName = VaultBackendName;

export interface BackendItemSummary {
  externalId: string;
  title: string;
  kind: VaultKind | "other";
  urls: string[];
  username?: string;
  card?: { brand: string; last4: string; expiry: string };
  hasTotp: boolean;
  fields: ValueField[];
  updatedAt?: string;
}

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
  listCandidates(): Promise<CandidateListing>;
  describe(externalId: string): Promise<BackendItemSummary>;
  resolve(externalId: string, field: ValueField): Promise<SecretValue>;
  create?(draft: ItemDraft, policy?: string): Promise<CreatedItem>;
  update?(externalId: string, draft: Partial<ItemDraft>): Promise<void>;
  remove?(externalId: string): Promise<void>;
  rebind?<T extends PolicyColumns>(externalId: string, writeRow: (tx: DbTx) => T): Promise<T>;
}

interface CreatedItem {
  externalId: string;
  summary: BackendItemSummary;
}

export type DbTx = Pick<AppDatabase, "select" | "insert" | "update" | "delete">;

export interface CandidateListing {
  items: BackendItemSummary[];
  unreadable: { externalId: string; reason: string }[];
}

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
