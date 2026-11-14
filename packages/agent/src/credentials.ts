/**
 * Credential requests (issue #56): the bot asks the owner to type a sign-in,
 * a one-time code or a card into a sheet the server fills into the page.
 *
 * The `request_credentials` call waits on its task-scoped document like an
 * approval (`waiting.ts`). The document holds only metadata: the origin, the
 * form, and afterwards which keys were filled, never a typed value: the
 * owner's submit goes to an app route that fills the browser in the same
 * request and then settles the document (`AgentRuntime.settleCredentialRequest`).
 */
import type { JsonValue } from "@earendil-works/chord";
import { defineDoc, type JsonObject, type TaskId } from "@earendil-works/pi-durable";
import { z } from "zod";
import { innerDetails } from "./approvals";
import { parseStored, toJson } from "./durable-json";
import type { ChatCredentialRequest } from "./types";
import { pendingToolTask, sealedAsNotPending, type HostTx } from "./waiting";

const CREDENTIAL_FIELD_TYPES = [
  "text",
  "email",
  "password",
  "otp",
  "card_number",
  "expiry",
  "cvc",
  "select",
] as const;

export type CredentialFieldType = (typeof CREDENTIAL_FIELD_TYPES)[number];

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

/** The credential request was already answered, expired, or its call ended. */
export class CredentialRequestNotPendingError extends Error {
  constructor(taskId: number) {
    super(`Tool call ${taskId} is not waiting for credentials`);
    this.name = "CredentialRequestNotPendingError";
  }
}

// ── The card's details: one shape, produced and parsed here ─────────────

/** The details a `request_credentials` call shows while it waits. */
export function pendingCredentialDetails(
  request: CredentialRequest,
  expiresAt: number,
): JsonObject {
  return { credentials: "pending", request: toJson(request), expiresAt };
}

/** The details a `request_credentials` call ends with. */
export function credentialResultDetails(
  doc: { status: CredentialRequestStatus; filled: string[]; savedHandle: string | null },
  request: CredentialRequest,
): JsonObject {
  return {
    credentials: doc.status,
    request: toJson(request),
    filled: doc.filled,
    ...(doc.savedHandle ? { savedHandle: doc.savedHandle } : {}),
  };
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** A `request_credentials` call as the chat reads it off the call's details. */
export function credentialsOf(details: unknown): ChatCredentialRequest | undefined {
  const value = innerDetails(details);
  const request = record(value?.request);
  if (!value || typeof value.credentials !== "string" || !request) return undefined;
  return {
    status: value.credentials as ChatCredentialRequest["status"],
    origin: String(request.origin ?? ""),
    title: String(request.title ?? ""),
    purpose: String(request.purpose ?? ""),
    fields: (Array.isArray(request.fields) ? request.fields : []).map((field) => {
      const f = record(field) ?? {};
      return {
        key: String(f.key ?? ""),
        label: String(f.label ?? ""),
        type: String(f.type ?? "text"),
        required: f.required === true,
      };
    }),
    ...(Array.isArray(value.filled) ? { filled: value.filled.map(String) } : {}),
    ...(typeof value.savedHandle === "string" ? { savedHandle: value.savedHandle } : {}),
  };
}

// ── Host side: the owner's sheet ────────────────────────────────────────

/**
 * The request a waiting `request_credentials` call shows, in the host's
 * transaction. Throws `CredentialRequestNotPendingError` for a call that is
 * not waiting on one (another tool's call, answered, expired, ended).
 */
export async function readPendingRequest(
  tx: HostTx,
  taskId: number,
): Promise<{ conversation: number; request: CredentialRequest; expiresAt: number }> {
  const id = taskId as TaskId;
  const notPending = () => new CredentialRequestNotPendingError(taskId);
  const conversation = await pendingToolTask(tx, id, undefined, notPending);
  // Another tool's task has no request (and the throw rolls back the
  // document this read would create).
  const doc = await tx.doc(CredentialRequestDoc, id);
  // A plain copy: parsing builds new objects from the draft proxy.
  const request = storedRequest(doc);
  if (doc.status !== "pending" || !request) throw notPending();
  if (doc.expiresAt <= Date.now()) throw notPending();
  return { conversation, request, expiresAt: doc.expiresAt };
}

/** Settle a waiting request with the owner's outcome (never values), in the host's transaction. */
export async function settleRequest(
  tx: HostTx,
  taskId: number,
  outcome: CredentialRequestOutcome,
): Promise<void> {
  const id = taskId as TaskId;
  const notPending = () => new CredentialRequestNotPendingError(taskId);
  await pendingToolTask(tx, id, undefined, notPending);
  const doc = await tx.doc(CredentialRequestDoc, id);
  if (doc.status !== "pending" || !doc.request) throw notPending();
  doc.status = outcome.status;
  if (outcome.status === "filled") {
    doc.filled = [...outcome.filled];
    doc.savedHandle = outcome.savedHandle ?? null;
  }
}

/** Map a sealed-document error (the call ended) to `CredentialRequestNotPendingError`. */
export function credentialRequestNotPending(error: unknown, taskId: number): never {
  if (error instanceof CredentialRequestNotPendingError) throw error;
  return sealedAsNotPending(error, () => new CredentialRequestNotPendingError(taskId));
}

/** How the owner answered a credential request. */
export type CredentialRequestOutcome =
  | { status: "filled"; filled: string[]; savedHandle?: string }
  | { status: "cancelled" };

/** A credential request is open per conversation at most, and this many per bot per hour. */
export const CREDENTIAL_REQUESTS_PER_HOUR = 3;

/** How long the sheet stays open. */
export const CREDENTIAL_REQUEST_TTL_MS = 10 * 60_000;

/** What a credential request's push names: its title and the origin's host, never a value. */
export function credentialSubject(request: Pick<CredentialRequest, "origin" | "title">): string {
  let host = request.origin;
  try {
    host = new URL(request.origin).hostname.replace(/^www\./, "");
  } catch {
    // keep the stored origin as it is
  }
  return `${request.title} on ${host}`;
}

const credentialRequest: z.ZodType<CredentialRequest> = z.object({
  origin: z.string(),
  title: z.string(),
  purpose: z.string(),
  fields: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      type: z.enum(CREDENTIAL_FIELD_TYPES),
      required: z.boolean(),
      autocomplete: z.string(),
      options: z.array(z.string()).optional(),
      ref: z.string().optional(),
    }),
  ),
  savedHandle: z.string().optional(),
});

export const storedRequest = (doc: { request: JsonValue }) =>
  parseStored("tiny.credential-request.request", doc.request, credentialRequest.nullable());
