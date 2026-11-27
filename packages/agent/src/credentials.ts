import type { JsonValue } from "@earendil-works/chord/json";
import { defineDoc, type JsonObject, type TaskId } from "@earendil-works/pi-durable";
import { z } from "zod";
import { innerDetails } from "./approvals";
import { parseStored, toJson } from "./durable-json";
import type { ChatCredentialRequest } from "./types";
import { pendingToolTask, sealedAsNotPending, wakeOwnerWait, type HostTx } from "./waiting";
import { record } from "@tiny-agents/std";

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
  autocomplete: string;
  options?: string[];
  ref?: string;
}

export interface CredentialRequest {
  origin: string;
  frameOrigin?: string;
  title: string;
  purpose: string;
  fields: CredentialField[];
  savedHandle?: string;
}

export type CredentialRequestStatus = "pending" | "filled" | "cancelled" | "expired";

export const CredentialRequestDoc = defineDoc<{
  status: CredentialRequestStatus;
  request: JsonValue;
  expiresAt: number;
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

export class CredentialRequestNotPendingError extends Error {
  constructor(taskId: number) {
    super(`Tool call ${taskId} is not waiting for credentials`);
    this.name = "CredentialRequestNotPendingError";
  }
}

export function pendingCredentialDetails(
  request: CredentialRequest,
  expiresAt: number,
): JsonObject {
  return { credentials: "pending", request: toJson(request), expiresAt };
}

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

export async function readPendingRequest(
  tx: HostTx,
  taskId: number,
): Promise<{ conversation: number; request: CredentialRequest; expiresAt: number }> {
  const id = taskId as TaskId;
  const notPending = () => new CredentialRequestNotPendingError(taskId);
  const conversation = await pendingToolTask(tx, id, undefined, notPending);
  const doc = await tx.doc(CredentialRequestDoc, id);
  const request = storedRequest(doc);
  if (doc.status !== "pending" || !request) throw notPending();
  if (doc.expiresAt <= Date.now()) throw notPending();
  return { conversation, request, expiresAt: doc.expiresAt };
}

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
  await wakeOwnerWait(tx, CredentialRequestDoc, id);
  doc.status = outcome.status;
  if (outcome.status === "filled") {
    doc.filled = [...outcome.filled];
    doc.savedHandle = outcome.savedHandle ?? null;
  }
}

export function credentialRequestNotPending(error: unknown, taskId: number): never {
  if (error instanceof CredentialRequestNotPendingError) throw error;
  return sealedAsNotPending(error, () => new CredentialRequestNotPendingError(taskId));
}

export type CredentialRequestOutcome =
  | { status: "filled"; filled: string[]; savedHandle?: string }
  | { status: "cancelled" };

export const CREDENTIAL_REQUESTS_PER_HOUR = 3;

export const CREDENTIAL_REQUEST_TTL_MS = 10 * 60_000;

export function credentialSubject(request: Pick<CredentialRequest, "origin" | "title">): string {
  let host = request.origin;
  try {
    host = new URL(request.origin).hostname.replace(/^www\./, "");
  } catch {}
  return `${request.title} on ${host}`;
}

const credentialRequest: z.ZodType<CredentialRequest> = z.object({
  origin: z.string(),
  frameOrigin: z.string().optional(),
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
