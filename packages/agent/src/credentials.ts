/**
 * Credential requests (issue #56): the bot asks the owner to type a sign-in,
 * a one-time code or a card into a sheet the server fills into the page.
 *
 * The `request_credentials` call waits on its task-scoped document like an
 * approval (`waiting.ts`). The document holds only metadata — the origin, the
 * form, and afterwards which keys were filled — never a typed value: the
 * owner's submit goes to an app route that fills the browser in the same
 * request and then settles the document (`AgentRuntime.settleCredentialRequest`).
 */
import type { JsonValue } from "@earendil-works/chord";
import { defineDoc } from "@earendil-works/pi-durable";

export type CredentialFieldType =
  | "text"
  | "email"
  | "password"
  | "otp"
  | "card_number"
  | "expiry"
  | "cvc"
  | "select";

export interface CredentialField {
  key: string;
  label: string;
  type: CredentialFieldType;
  required: boolean;
  /** HTML autocomplete token: how the page's field is found, and the owner's own manager fills it. */
  autocomplete: string;
  options?: string[];
  /** A snapshot ref the value goes into; else matched by `autocomplete`. */
  ref?: string;
}

export interface CredentialRequest {
  /** The page's top-level origin when the bot asked; values only ever fill there. */
  origin: string;
  title: string;
  purpose: string;
  fields: CredentialField[];
  /** A saved login exists for the origin ("Use saved login" / "Update saved login"). */
  savedHandle?: string;
}

export type CredentialRequestStatus = "pending" | "filled" | "cancelled" | "expired";

export const CredentialRequestDoc = defineDoc<{
  status: CredentialRequestStatus;
  /** The normalized `CredentialRequest` (see `storedRequest`). */
  request: JsonValue;
  expiresAt: number;
  /** Keys the server filled (never values). */
  filled: string[];
  savedHandle: string | null;
}>({
  kind: "tiny.credential-request",
  version: 1,
  scope: "task",
  initial: () => ({
    status: "pending",
    request: null,
    expiresAt: 0,
    filled: [],
    savedHandle: null,
  }),
  checkpointWhen: () => false,
});

/** How the owner answered a credential request. */
export type CredentialRequestOutcome =
  | { status: "filled"; filled: string[]; savedHandle?: string }
  | { status: "cancelled" };

/** Masked in the sheet; never saved when an OTP or CVC. */
export const SECRET_FIELD_TYPES: ReadonlySet<CredentialFieldType> = new Set([
  "password",
  "otp",
  "card_number",
  "cvc",
]);

/** A credential request is open per conversation at most, and this many per bot per hour. */
export const CREDENTIAL_REQUESTS_PER_HOUR = 3;

/** How long the sheet stays open. */
export const CREDENTIAL_REQUEST_TTL_MS = 10 * 60_000;

export const storedRequest = (doc: { request: JsonValue }) =>
  doc.request as unknown as CredentialRequest | null;
