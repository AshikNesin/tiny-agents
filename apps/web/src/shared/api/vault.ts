/**
 * The Vault API's wire types (`server/api/vault`, issue #56); naming in
 * `./common.ts`. Metadata and policy only: a value crosses only in a reveal.
 */
import type { CredentialField, VaultApproval, VaultKind } from "@tiny-agents/agent";
import type { Jsonified } from "../json";

export type { VaultApproval, VaultKind };

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

export type VaultBackendName = "local";

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

/** One backend in the overview; an unconfigured one has only its read status. */
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

/** An item as the Vault UI shows it (`vault.admin.service.ts` `itemView`). */
export interface VaultItemData {
  id: string;
  handle: string;
  kind: VaultKind;
  backend: VaultBackendName;
  /** `app`: a secret the server uses itself (a model provider's key); never a bot's. */
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

/** A backend item no vault item links yet. */
export interface UnlinkedItem {
  backend: VaultBackendName;
  externalId: string;
  title: string;
  kind: VaultKind | "other";
  urls: string[];
  username: string | null;
  card: VaultCardMeta | null;
}

/** `GET /vault`. */
export interface VaultOverviewData {
  backends: VaultBackendView[];
  primaryBackend: VaultBackendName;
  items: VaultItemData[];
  unlinked: UnlinkedItem[];
  kindDefaults: Record<VaultKind, string[]>;
}

export type VaultOverview = Jsonified<VaultOverviewData>;

/** One audit row, as stored (`vault_audit_events`): never a value. */
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

/** `GET /vault/items/:handle`. */
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

/**
 * Who and what may use an item: never a value. The client always sends the
 * whole policy; the server defaults what is left out.
 */
export interface VaultPolicy {
  handle: string;
  label?: string;
  origins: string[];
  hosts: string[];
  inject?: VaultInject | null;
  tools: string[];
  /** null: every bot. */
  bots: string[] | null;
  approval: VaultApproval;
  allowUnattended: boolean;
  whenToUse?: string | null;
  disabled: boolean;
  /** api_key: which value field holds the key. */
  field?: ValueField | null;
}

/** `POST /vault/items` (step-up). */
export interface VaultItemCreateBody {
  kind: VaultKind;
  title: string;
  /** Websites; their origins become the item's allowed origins unless policy names others. */
  urls?: string[];
  values: Partial<Record<ValueField, string>>;
  policy: VaultPolicy;
}

/** `POST /vault/links` (step-up). */
export interface VaultLinkBody {
  backend: VaultBackendName;
  externalId: string;
  policy: VaultPolicy;
}

/** `PUT /vault/items/:handle` (step-up): "" clears a value. */
export interface VaultItemUpdateBody {
  title?: string;
  urls?: string[];
  values?: Partial<Record<ValueField, string>>;
  policy?: Partial<VaultPolicy>;
}

/** `POST /vault/items/:handle/reveal` (step-up). */
export interface VaultRevealBody {
  field: ValueField;
  purpose?: "reveal" | "copy";
}

/** `POST /vault/items/:handle/reveal`: one value, for the owner's browser. */
export interface VaultRevealed {
  field: ValueField;
  value: string;
}

/** `POST /vault/step-up`: the owner's password, or a passkey assertion. */
export type StepUpBody = { password: string } | { passkey: Record<string, unknown> };

/** `POST /vault/step-up`: a token for `X-Vault-Step-Up`, valid until `expiresAt` (ms). */
export interface StepUpToken {
  token: string;
  expiresAt: number;
}

/** `GET /vault/requests/:taskId`: a bot's credential request, metadata only. */
export interface CredentialRequestView {
  taskId: number;
  bot: { id: string; name: string } | null;
  origin: string;
  /** Another site's frame on that page that holds the fields (#302), named on the card. */
  frameOrigin: string | null;
  title: string;
  purpose: string;
  fields: Omit<CredentialField, "ref">[];
  savedHandle: string | null;
  expiresAt: number;
  liveOrigin: string | null;
}

/** `POST /vault/requests/:taskId/submit`. */
export interface CredentialSubmitBody {
  values: Record<string, string>;
  save?: boolean;
}

/** `POST /vault/requests/:taskId/submit`: the keys filled, and the item saved to, if any. */
export interface CredentialSubmitted {
  filled: string[];
  savedHandle: string | null;
  /** The fill worked but saving to the vault did not. */
  saveFailed: boolean;
}

/** `POST /vault/requests/:taskId/cancel`. */
export interface CredentialCancelled {
  cancelled: true;
}
