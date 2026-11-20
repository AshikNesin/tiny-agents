import { startAuthentication } from "@simplewebauthn/browser";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { ApiError, apiClient } from "@groot/shell/lib/api";
import type { Deleted } from "../../shared/api/common";
import type {
  CredentialCancelled,
  CredentialRequestView,
  CredentialSubmitBody,
  CredentialSubmitted,
  StepUpBody,
  StepUpToken,
  ValueField,
  VaultBackendName,
  VaultItem,
  VaultItemCreateBody,
  VaultItemDetail,
  VaultItemUpdateBody,
  VaultKind,
  VaultLinkBody,
  VaultOverview,
  VaultRevealBody,
  VaultRevealed,
} from "../../shared/api/vault";
import { errorMessage } from "./errors";

let stepUp: StepUpToken | undefined;

export function hasStepUp(): boolean {
  return stepUp !== undefined && stepUp.expiresAt > Date.now() + 5_000;
}

function setStepUp(next: typeof stepUp) {
  stepUp = next;
}

export class StepUpRequiredError extends Error {
  constructor() {
    super("Confirm it's you first");
    this.name = "StepUpRequiredError";
  }
}

async function confirmWithPassword(password: string) {
  setStepUp(await apiClient.post<StepUpToken>("/vault/step-up", { password } satisfies StepUpBody));
}

async function confirmWithPasskey() {
  const options =
    await apiClient.post<PublicKeyCredentialRequestOptionsJSON>("/vault/step-up/options");
  const response = await startAuthentication({ optionsJSON: options });
  setStepUp(await apiClient.post<StepUpToken>("/vault/step-up", { passkey: response }));
}

function requestWithStepUp<T>(
  method: "post" | "put" | "patch" | "delete",
  url: string,
  data: unknown,
  token: string,
): Promise<T> {
  return apiClient.request<T>(method, url, {
    body: data,
    headers: { "X-Vault-Step-Up": token },
    emptyOk: true,
  });
}

export async function stepped<T>(
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
  create: (input: VaultItemCreateBody) => stepped<VaultItem>("post", "/vault/items", input),
  link: (input: VaultLinkBody) => stepped<VaultItem>("post", "/vault/links", input),
  update: (handle: string, input: VaultItemUpdateBody) =>
    stepped<VaultItem>("put", `/vault/items/${encodeURIComponent(handle)}`, input),
  remove: (handle: string, purge: boolean) =>
    stepped<Deleted>("delete", `/vault/items/${encodeURIComponent(handle)}?purge=${purge}`),
  reveal: (handle: string, field: ValueField, purpose: "reveal" | "copy") =>
    stepped<VaultRevealed>("post", `/vault/items/${encodeURIComponent(handle)}/reveal`, {
      field,
      purpose,
    } satisfies VaultRevealBody),
  request: (taskId: number) => apiClient.get<CredentialRequestView>(`/vault/requests/${taskId}`),
  submitRequest: (taskId: number, values: Record<string, string>, save: boolean) =>
    apiClient.post<CredentialSubmitted>(`/vault/requests/${taskId}/submit`, {
      values,
      save,
    } satisfies CredentialSubmitBody),
  cancelRequest: (taskId: number) =>
    apiClient.post<CredentialCancelled>(`/vault/requests/${taskId}/cancel`),
};

export const BACKEND_LABEL: Record<VaultBackendName, string> = {
  "onepassword-connect": "1Password",
  local: "Local",
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
