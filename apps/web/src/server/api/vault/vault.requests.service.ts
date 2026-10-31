/**
 * Credential requests (issue #56): the owner types into a sheet, the server
 * fills the bot's browser, the model never sees it.
 *
 * The submit handler holds the typed values only for the length of the
 * request: it wraps them in `SecretValue`, registers them with the redactor,
 * re-checks that the bot's page is still on the request's origin, fills over
 * CDP, optionally saves a login or card to the vault (never a one-time code
 * or a CVC), audits the keys filled, and settles the request. Nothing typed
 * is stored outside the vault backend.
 */
import { eq } from "drizzle-orm";
import { Boom } from "@groot/core/errors";
import {
  CredentialRequestNotPendingError,
  SecretValue,
  secretRedactor,
  type AgentRuntime,
  type CredentialField,
  type CredentialRequest,
  type SecretFillField,
} from "@tiny-agents/agent";
import { logger } from "@groot/core/logger";
import { db, vaultItems } from "../../db";
import { getBrowserSessions } from "../bots/browser.sessions";
import { browserTargetForConversation } from "../bots/browser.targets";
import { getAgentRuntime } from "../bots/bots.runtime";
import { conversationOwner } from "../bots/bots.owner";
import { createItem, updateItem } from "./vault.admin.service";
import { audit } from "./vault.service";

type RequestRuntime = Pick<AgentRuntime, "credentialRequest" | "settleCredentialRequest">;

async function pending(taskId: number, runtime: RequestRuntime) {
  try {
    return await runtime.credentialRequest(taskId);
  } catch (error) {
    if (error instanceof CredentialRequestNotPendingError) {
      throw Boom.notFound("This request was answered, cancelled or expired");
    }
    throw error;
  }
}

/** The sheet's content: metadata only. */
export async function requestView(taskId: number, runtime: RequestRuntime = getAgentRuntime()) {
  const { conversation, request, expiresAt } = await pending(taskId, runtime);
  const owner = await conversationOwner(conversation);
  const bot = owner ? { id: owner.bot.id, name: owner.bot.name } : undefined;
  const liveOrigin = await getBrowserSessions().tabOrigin(
    await browserTargetForConversation(conversation),
  );
  return {
    taskId,
    bot: bot ?? null,
    origin: request.origin,
    title: request.title,
    purpose: request.purpose,
    fields: request.fields.map(({ ref: _ref, ...field }) => field),
    savedHandle: request.savedHandle ?? null,
    expiresAt,
    liveOrigin: liveOrigin ?? null,
  };
}

function checkValues(request: CredentialRequest, values: Record<string, string>) {
  const known = new Map(request.fields.map((field) => [field.key, field]));
  for (const key of Object.keys(values)) {
    if (!known.has(key)) throw Boom.badRequest(`Unknown field "${key}"`);
  }
  const filled: { field: CredentialField; value: string }[] = [];
  for (const field of request.fields) {
    const value = values[field.key]?.trim() ?? "";
    if (!value) {
      if (field.required) throw Boom.badRequest(`${field.label} is required`);
      continue;
    }
    if (field.type === "select" && !field.options?.includes(value)) {
      throw Boom.badRequest(`${field.label}: pick one of the options`);
    }
    filled.push({ field, value: field.type === "password" ? values[field.key] : value });
  }
  return filled;
}

function slug(host: string): string {
  return (
    host
      .toLowerCase()
      .replace(/^www\./, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "login"
  );
}

async function freeHandle(base: string): Promise<string> {
  for (let n = 1; n < 100; n++) {
    const handle = n === 1 ? base : `${base}-${n}`;
    if (!(await db.query.vaultItems.findFirst({ where: eq(vaultItems.handle, handle) }))) {
      return handle;
    }
  }
  throw Boom.conflict("No free handle for the saved item");
}

/** Save what was typed as a LOGIN or CREDIT_CARD (never an OTP or CVC). */
async function save(
  request: CredentialRequest,
  filled: { field: CredentialField; value: string }[],
): Promise<string | undefined> {
  const of = (match: (field: CredentialField) => boolean) =>
    filled.find((f) => match(f.field))?.value;
  const password = of((f) => f.type === "password");
  const username = of(
    (f) =>
      (f.type === "email" || f.type === "text") && ["username", "email"].includes(f.autocomplete),
  );
  const number = of((f) => f.type === "card_number");
  const host = new URL(request.origin).host;
  if (password) {
    const values = { password, ...(username ? { username } : {}) };
    if (request.savedHandle) {
      await updateItem(request.savedHandle, { values }, { via: "credential_request" });
      return request.savedHandle;
    }
    const created = await createItem(
      {
        kind: "login",
        title: host,
        urls: [request.origin],
        values,
        policy: {
          handle: await freeHandle(slug(host)),
          origins: [request.origin],
          hosts: [],
          tools: [],
          bots: null,
          approval: "per_conversation",
          allowUnattended: false,
          disabled: false,
        },
      },
      { via: "credential_request" },
    );
    return created.handle;
  }
  if (number) {
    const expiry = of((f) => f.type === "expiry");
    const holder = of((f) => f.autocomplete === "cc-name");
    const created = await createItem(
      {
        kind: "card",
        title: `Card for ${host}`,
        urls: [request.origin],
        values: {
          card_number: number,
          ...(expiry ? { card_expiry: expiry } : {}),
          ...(holder ? { card_holder: holder } : {}),
        },
        policy: {
          handle: await freeHandle(`card-${slug(host)}`),
          origins: [request.origin],
          hosts: [],
          tools: [],
          bots: null,
          approval: "every_use",
          allowUnattended: false,
          disabled: false,
        },
      },
      { via: "credential_request" },
    );
    return created.handle;
  }
  return undefined;
}

/** Requests a submit is filling right now: a second submit of one waits for nothing and is refused. */
const submitting = new Set<number>();

export async function submitRequest(
  taskId: number,
  input: { values: Record<string, string>; save: boolean },
  runtime: RequestRuntime = getAgentRuntime(),
) {
  if (submitting.has(taskId)) throw Boom.conflict("This request is being filled already.");
  submitting.add(taskId);
  try {
    return await fillRequest(taskId, input, runtime);
  } finally {
    submitting.delete(taskId);
  }
}

async function fillRequest(
  taskId: number,
  input: { values: Record<string, string>; save: boolean },
  runtime: RequestRuntime,
) {
  const { conversation, request } = await pending(taskId, runtime);
  const botId = (await conversationOwner(conversation))?.bot.id;
  const filled = checkValues(request, input.values);
  for (const { value } of filled) secretRedactor.register(value);
  const target = await browserTargetForConversation(conversation);
  const live = await getBrowserSessions().tabOrigin(target);
  if (live !== request.origin) {
    await audit({
      handle: "(credential request)",
      botId,
      conversationId: conversation,
      taskId,
      tool: "credential_request",
      target: request.origin,
      outcome: "refused_origin",
      reason: `page is on ${live ?? "no page"}`,
    });
    throw Boom.conflict(
      live
        ? `The bot's page is now on ${live}, not ${request.origin}. Nothing was filled.`
        : "The bot's browser is not open any more. Nothing was filled.",
    );
  }
  const fields: SecretFillField[] = filled.map(({ field, value }) => ({
    key: field.key,
    autocomplete: field.autocomplete,
    value: new SecretValue(field.type === "card_number" ? value.replace(/[\s-]/g, "") : value),
    ...(field.ref ? { ref: field.ref } : {}),
  }));
  let result: { filled: string[] };
  try {
    result = await getBrowserSessions().fillSecret(target, { origin: request.origin, fields });
  } catch (error) {
    if (error instanceof Error && error.name === "OriginMismatchError") {
      throw Boom.conflict("The page moved before the fill. Nothing was filled.");
    }
    throw Boom.badGateway("Couldn't fill the page. Try the live browser instead.");
  }
  if (result.filled.length === 0) {
    throw Boom.unprocessable(
      "No matching fields were found on the page. Open the live browser to check it, then try again.",
    );
  }
  // The page is filled: from here the request settles whatever else fails.
  let savedHandle: string | undefined;
  let saveFailed = false;
  if (input.save) {
    try {
      savedHandle = await save(
        request,
        filled.filter(({ field }) => field.type !== "otp" && field.type !== "cvc"),
      );
    } catch (error) {
      saveFailed = true;
      logger.warn({ error, taskId }, "Filled the page but could not save the login to the vault");
    }
  }
  await audit({
    handle: savedHandle ?? "(credential request)",
    botId,
    conversationId: conversation,
    taskId,
    tool: "credential_request",
    target: request.origin,
    outcome: "filled",
    reason: `keys: ${result.filled.join(", ")}${saveFailed ? " (save to vault failed)" : ""}`,
  });
  await runtime.settleCredentialRequest(taskId, {
    status: "filled",
    filled: result.filled,
    ...(savedHandle ? { savedHandle } : {}),
  });
  return { filled: result.filled, savedHandle: savedHandle ?? null, saveFailed };
}

export async function cancelRequest(taskId: number, runtime: RequestRuntime = getAgentRuntime()) {
  const { conversation, request } = await pending(taskId, runtime);
  await runtime.settleCredentialRequest(taskId, { status: "cancelled" });
  await audit({
    handle: "(credential request)",
    botId: (await conversationOwner(conversation))?.bot.id,
    conversationId: conversation,
    taskId,
    tool: "credential_request",
    target: request.origin,
    outcome: "cancelled",
  });
  return { cancelled: true };
}
