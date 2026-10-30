/**
 * Typed client for the Vault routes (issue #56). Writes, reveals and copies
 * carry a step-up token: the owner confirms it's them (password or passkey)
 * and the token lives in this module's memory only — never storage — for
 * its five minutes.
 */
import { startAuthentication } from "@simplewebauthn/browser";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { ApiError, apiClient, type ApiResponse } from "@groot/shell/lib/api";
import { useAuthStore } from "@groot/shell/store/auth";
import { errorMessage } from "./errors";

export type VaultKind = "login" | "card" | "identity" | "api_key";
export type VaultApproval = "every_use" | "per_conversation" | "allowed";
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
  code?: string;
  detail?: string;
  extraVaults?: string[];
}

export interface VaultBackendView {
  name: "onepassword-connect" | "local";
  configured: boolean;
  read: BackendStatus;
  write?: BackendStatus;
  capabilities?: { create: boolean; update: boolean; delete: boolean; reveal: boolean };
  host?: string;
  vaultId?: string;
  readTokenExpiresAt?: string | null;
  writeTokenExpiresAt?: string | null;
}

export interface VaultItem {
  id: string;
  handle: string;
  kind: VaultKind;
  backend: VaultBackendView["name"];
  label: string;
  username: string | null;
  origins: string[];
  hosts: string[];
  inject: { as: "header"; name: string; format: string } | null;
  tools: string[];
  effectiveTools: string[];
  bots: string[] | null;
  approval: VaultApproval;
  effectiveApproval: VaultApproval;
  allowUnattended: boolean;
  whenToUse: string | null;
  card: { brand: string; last4: string; expiry: string } | null;
  hasTotp: boolean;
  disabled: boolean;
  field: ValueField | null;
  lastUsedAt: string | null;
  lastUsedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UnlinkedItem {
  backend: VaultBackendView["name"];
  externalId: string;
  title: string;
  kind: VaultKind | "other";
  urls: string[];
  username: string | null;
  card: { brand: string; last4: string; expiry: string } | null;
}

export interface VaultOverview {
  backends: VaultBackendView[];
  primaryBackend: VaultBackendView["name"];
  items: VaultItem[];
  unlinked: UnlinkedItem[];
  kindDefaults: Record<VaultKind, string[]>;
}

export interface VaultAuditEvent {
  id: string;
  at: string;
  handle: string;
  botId: string | null;
  conversationId: number | null;
  tool: string;
  target: string;
  outcome: string;
  reason: string | null;
  unattended: boolean;
}

export interface VaultItemDetail {
  item: VaultItem;
  title: string;
  urls: string[];
  fields: ValueField[];
  stale: boolean;
  backendError?: string;
  capabilities: { create: boolean; update: boolean; delete: boolean; reveal: boolean };
  events: VaultAuditEvent[];
}

export interface VaultPolicy {
  handle: string;
  label?: string;
  origins: string[];
  hosts: string[];
  inject?: { as: "header"; name: string; format: string } | null;
  tools: string[];
  bots: string[] | null;
  approval: VaultApproval;
  allowUnattended: boolean;
  whenToUse?: string | null;
  disabled: boolean;
  field?: ValueField | null;
}

export interface CredentialRequestView {
  taskId: number;
  bot: { id: string; name: string } | null;
  origin: string;
  title: string;
  purpose: string;
  fields: {
    key: string;
    label: string;
    type: "text" | "email" | "password" | "otp" | "card_number" | "expiry" | "cvc" | "select";
    required: boolean;
    autocomplete: string;
    options?: string[];
  }[];
  savedHandle: string | null;
  expiresAt: number;
  liveOrigin: string | null;
}

// ── Step-up ─────────────────────────────────────────────────────────────

let stepUp: { token: string; expiresAt: number } | undefined;
const listeners = new Set<() => void>();

export function hasStepUp(): boolean {
  return stepUp !== undefined && stepUp.expiresAt > Date.now() + 5_000;
}

export function onStepUpChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setStepUp(next: typeof stepUp) {
  stepUp = next;
  for (const listener of listeners) listener();
}

export class StepUpRequiredError extends Error {
  constructor() {
    super("Confirm it's you first");
    this.name = "StepUpRequiredError";
  }
}

async function confirmWithPassword(password: string) {
  setStepUp(
    await apiClient.post<{ token: string; expiresAt: number }>("/vault/step-up", { password }),
  );
}

async function confirmWithPasskey() {
  const options =
    await apiClient.post<PublicKeyCredentialRequestOptionsJSON>("/vault/step-up/options");
  const response = await startAuthentication({ optionsJSON: options });
  setStepUp(
    await apiClient.post<{ token: string; expiresAt: number }>("/vault/step-up", {
      passkey: response,
    }),
  );
}

/**
 * `apiClient` takes no per-request headers, so step-up calls go out on
 * `fetch` the way it sends them: same base path, cookie and JSON body, a
 * real mid-session 401 signs the owner out, and a non-2xx response throws
 * the same `ApiError`. Like a DELETE through `apiClient`, a missing `data`
 * comes back as `undefined` instead of throwing.
 */
async function requestWithStepUp<T>(
  method: "post" | "put" | "patch" | "delete",
  url: string,
  data: unknown,
  token: string,
): Promise<T> {
  // A 401 from before a logout / re-login must not clear the new session.
  const generation = useAuthStore.getState().generation;
  const headers = new Headers({ accept: "application/json", "X-Vault-Step-Up": token });
  if (data !== undefined) headers.set("content-type", "application/json");
  const response = await fetch(`/api/v1${url.startsWith("/") ? "" : "/"}${url}`, {
    method: method.toUpperCase(),
    headers,
    body: data !== undefined ? JSON.stringify(data) : undefined,
    credentials: "include",
  });
  if (
    response.status === 401 &&
    window.location.pathname !== "/login" &&
    generation === useAuthStore.getState().generation
  ) {
    useAuthStore.getState().clearAuth();
  }
  const text = await response.text();
  let envelope: ApiResponse<T> | undefined;
  try {
    envelope = text ? (JSON.parse(text) as ApiResponse<T>) : undefined;
  } catch {
    envelope = undefined;
  }
  if (!response.ok) {
    throw new ApiError({
      status: response.status,
      code: envelope?.error?.code ?? `HTTP_${response.status}`,
      message:
        envelope?.error?.message ??
        (response.statusText || `Request failed with status ${response.status}`),
      details: envelope?.error?.details,
      url,
      fromServer: typeof envelope?.error?.message === "string",
    });
  }
  return envelope?.data as T;
}

/** A request that needs a fresh step-up token. */
async function stepped<T>(
  method: "post" | "put" | "patch" | "delete",
  url: string,
  data?: unknown,
): Promise<T> {
  if (!hasStepUp()) throw new StepUpRequiredError();
  try {
    return await requestWithStepUp<T>(method, url, data, stepUp!.token);
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      setStepUp(undefined);
      throw new StepUpRequiredError();
    }
    throw error;
  }
}

export const vaultApi = {
  overview: (refresh = false) =>
    apiClient.get<VaultOverview>("/vault", refresh ? { refresh: "1" } : undefined),
  detail: (handle: string) =>
    apiClient.get<VaultItemDetail>(`/vault/items/${encodeURIComponent(handle)}`),
  confirmWithPassword,
  confirmWithPasskey,
  forgetStepUp: () => setStepUp(undefined),
  create: (input: {
    kind: VaultKind;
    title: string;
    urls: string[];
    values: Partial<Record<ValueField, string>>;
    policy: VaultPolicy;
  }) => stepped<VaultItem>("post", "/vault/items", input),
  link: (input: { backend: VaultBackendView["name"]; externalId: string; policy: VaultPolicy }) =>
    stepped<VaultItem>("post", "/vault/links", input),
  update: (
    handle: string,
    input: {
      title?: string;
      urls?: string[];
      values?: Partial<Record<ValueField, string>>;
      policy?: Partial<VaultPolicy>;
    },
  ) => stepped<VaultItem>("put", `/vault/items/${encodeURIComponent(handle)}`, input),
  remove: (handle: string, purge: boolean) =>
    stepped<{ deleted: boolean }>(
      "delete",
      `/vault/items/${encodeURIComponent(handle)}?purge=${purge}`,
    ),
  reveal: (handle: string, field: ValueField, purpose: "reveal" | "copy") =>
    stepped<{ field: ValueField; value: string }>(
      "post",
      `/vault/items/${encodeURIComponent(handle)}/reveal`,
      { field, purpose },
    ),
  request: (taskId: number) => apiClient.get<CredentialRequestView>(`/vault/requests/${taskId}`),
  submitRequest: (taskId: number, values: Record<string, string>, save: boolean) =>
    apiClient.post<{ filled: string[]; savedHandle: string | null }>(
      `/vault/requests/${taskId}/submit`,
      { values, save },
    ),
  cancelRequest: (taskId: number) =>
    apiClient.post<{ cancelled: boolean }>(`/vault/requests/${taskId}/cancel`),
};

export const KIND_LABEL: Record<VaultKind, string> = {
  login: "Login",
  card: "Card",
  identity: "Contact",
  api_key: "API key",
};

export const FIELD_LABEL: Record<ValueField, string> = {
  username: "Username",
  password: "Password",
  totp: "One-time password",
  notes: "Notes",
  card_number: "Card number",
  card_expiry: "Expiry",
  card_cvc: "Security code",
  card_holder: "Name on card",
  card_billing_address: "Billing address",
  identity_name: "Name",
  identity_email: "Email",
  identity_phone: "Phone",
  identity_address: "Address",
  value: "Key",
};

/** Fields shown masked until revealed. */
export const SECRET_FIELDS: ReadonlySet<ValueField> = new Set([
  "password",
  "totp",
  "card_number",
  "card_cvc",
  "value",
]);

export const FIELDS_BY_KIND: Record<VaultKind, ValueField[]> = {
  login: ["username", "password", "totp", "notes"],
  card: ["card_number", "card_expiry", "card_cvc", "card_holder", "card_billing_address", "notes"],
  identity: ["identity_name", "identity_email", "identity_phone", "identity_address", "notes"],
  api_key: ["value", "username", "notes"],
};

export function apiError(error: unknown, fallback: string): string {
  return errorMessage(error, fallback);
}
