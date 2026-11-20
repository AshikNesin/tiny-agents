import type { CredentialField, VaultApproval, VaultKind } from "@tiny-agents/agent";
import type { Jsonified } from "../json";

export type { VaultApproval, VaultKind };

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

export type VaultBackendName = "onepassword-connect" | "local";

export interface BackendStatus {
  state: "ready" | "unconfigured" | "error";
  code?: string;
  detail?: string;
}

interface BackendCapabilities {
  create: boolean;
  update: boolean;
  delete: boolean;
  reveal: boolean;
}

export interface VaultBackendView {
  name: VaultBackendName;
  configured: boolean;
  read: BackendStatus;
  write?: BackendStatus;
  capabilities?: BackendCapabilities;
}

interface VaultCardMeta {
  brand: string;
  last4: string;
  expiry: string;
}

interface VaultInject {
  as: "header";
  name: string;
  format: string;
}

export interface VaultItemData {
  id: string;
  handle: string;
  kind: VaultKind;
  backend: VaultBackendName;
  audience: "bots" | "app";
  label: string;
  username: string | null;
  origins: string[];
  hosts: string[];
  inject: VaultInject | null;
  tools: string[];
  effectiveTools: string[];
  bots: string[] | null;
  approval: VaultApproval;
  effectiveApproval: VaultApproval;
  allowUnattended: boolean;
  whenToUse: string | null;
  card: VaultCardMeta | null;
  hasTotp: boolean;
  disabled: boolean;
  field: ValueField | null;
  lastUsedAt: Date | null;
  lastUsedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type VaultItem = Jsonified<VaultItemData>;

export interface UnlinkedItem {
  backend: VaultBackendName;
  externalId: string;
  title: string;
  kind: VaultKind | "other";
  urls: string[];
  username: string | null;
  card: VaultCardMeta | null;
}

export interface VaultOverviewData {
  backends: VaultBackendView[];
  primaryBackend: VaultBackendName;
  items: VaultItemData[];
  unlinked: UnlinkedItem[];
  kindDefaults: Record<VaultKind, string[]>;
}

export type VaultOverview = Jsonified<VaultOverviewData>;

export interface VaultAuditEventData {
  id: string;
  at: Date;
  itemId: string | null;
  handle: string;
  botId: string | null;
  conversationId: number | null;
  taskId: number | null;
  tool: string;
  target: string;
  outcome: string;
  reason: string | null;
  unattended: boolean;
}

export interface VaultItemDetailData {
  item: VaultItemData;
  title: string;
  urls: string[];
  fields: ValueField[];
  stale: boolean;
  backendError?: string;
  capabilities: BackendCapabilities;
  events: VaultAuditEventData[];
}

export type VaultItemDetail = Jsonified<VaultItemDetailData>;

export interface VaultPolicy {
  handle: string;
  label?: string;
  origins: string[];
  hosts: string[];
  inject?: VaultInject | null;
  tools: string[];
  bots: string[] | null;
  approval: VaultApproval;
  allowUnattended: boolean;
  whenToUse?: string | null;
  disabled: boolean;
  field?: ValueField | null;
}

export interface VaultItemCreateBody {
  kind: VaultKind;
  title: string;
  urls?: string[];
  values: Partial<Record<ValueField, string>>;
  policy: VaultPolicy;
}

export interface VaultLinkBody {
  backend: VaultBackendName;
  externalId: string;
  policy: VaultPolicy;
}

export interface VaultItemUpdateBody {
  title?: string;
  urls?: string[];
  values?: Partial<Record<ValueField, string>>;
  policy?: Partial<VaultPolicy>;
}

export interface VaultRevealBody {
  field: ValueField;
  purpose?: "reveal" | "copy";
}

export interface VaultRevealed {
  field: ValueField;
  value: string;
}

export type StepUpBody = { password: string } | { passkey: Record<string, unknown> };

export interface StepUpToken {
  token: string;
  expiresAt: number;
}

export interface CredentialRequestView {
  taskId: number;
  bot: { id: string; name: string } | null;
  origin: string;
  frameOrigin: string | null;
  title: string;
  purpose: string;
  fields: Omit<CredentialField, "ref">[];
  savedHandle: string | null;
  expiresAt: number;
  liveOrigin: string | null;
}

export interface CredentialSubmitBody {
  values: Record<string, string>;
  save?: boolean;
}

export interface CredentialSubmitted {
  filled: string[];
  savedHandle: string | null;
  saveFailed: boolean;
}

export interface CredentialCancelled {
  cancelled: true;
}
