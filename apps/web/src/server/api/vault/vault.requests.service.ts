import { eq } from "drizzle-orm";
import { Boom } from "@groot/core/errors";
import {
  SecretValue,
  secretRedactor,
  VaultTargetMovedError,
  type AgentRuntime,
  type CredentialField,
  type CredentialRequest,
} from "@tiny-agents/agent";
import { FrameOriginError, type SecretFillField } from "@tiny-agents/sandbox/browser";
import { logger } from "@groot/core/logger";
import { db, vaultItems } from "../../db";
import { getBrowserSessions } from "../bots/browser.sessions";
import { browserTargetForConversation } from "../bots/browser.targets";
import { getAgentRuntime } from "../bots/bots.runtime";
import { conversationOwner } from "../bots/bots.owner";
import { onOwnerWait } from "../bots/bots.chat";
import { createItem, updateItem } from "./vault.admin.service";
import { audit } from "./vault.service";
import { app } from "../../app-root";
import type {
  CredentialCancelled,
  CredentialRequestView,
  CredentialSubmitted,
} from "../../../shared/api/vault";

type RequestRuntime = Pick<AgentRuntime, "credentialRequest" | "settleCredentialRequest">;

function pending(taskId: number, runtime: RequestRuntime) {
  return onOwnerWait(() => runtime.credentialRequest(taskId));
}

export async function requestView(
  taskId: number,
  runtime: RequestRuntime = getAgentRuntime(),
): Promise<CredentialRequestView> {
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
    frameOrigin: request.frameOrigin ?? null,
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

async function save(
  request: CredentialRequest,
  filled: { field: CredentialField; value: string }[],
): Promise<string | undefined> {
  const of = (match: (field: CredentialField) => boolean) =>
    filled.find((f) => match(f.field))?.value;
  const password = of((f) => f.type === "password");
  const username = of(
    (f) =>
      (f.type === "email" || f.type === "text") &&
      ["username", "email", "tel"].includes(f.autocomplete),
  );
  const number = of((f) => f.type === "card_number");
  const host = new URL(request.origin).host;
  const origins = request.frameOrigin ? [request.origin, request.frameOrigin] : [request.origin];
  if (password || username) {
    const values = { ...(password ? { password } : {}), ...(username ? { username } : {}) };
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
          origins,
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
          origins,
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

export async function submitRequest(
  taskId: number,
  input: { values: Record<string, string>; save: boolean },
  runtime: RequestRuntime = getAgentRuntime(),
): Promise<CredentialSubmitted> {
  const submitting = app().submittingRequests;
  const inFlight = submitting.get(taskId);
  if (inFlight) return inFlight;
  const filling = fillRequest(taskId, input, runtime).finally(() => submitting.delete(taskId));
  submitting.set(taskId, filling);
  return filling;
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
    result = await getBrowserSessions().fillSecret(target, {
      origin: request.origin,
      ...(request.frameOrigin ? { frameOrigins: [request.frameOrigin] } : {}),
      fields,
      steps: true,
    });
  } catch (error) {
    if (error instanceof FrameOriginError) {
      throw Boom.conflict(
        `The sign-in field is in a frame from ${error.actual}, not on ${request.origin}. Nothing was filled.`,
      );
    }
    if (error instanceof VaultTargetMovedError) {
      throw Boom.conflict("The page moved before the fill. Nothing was filled.");
    }
    throw Boom.badGateway("Couldn't fill the page. Try again in a moment.");
  }
  if (result.filled.length === 0) {
    throw Boom.unprocessable(
      "No matching fields were found on the page. The bot may not be on the sign-in form yet: try again in a moment.",
    );
  }
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

export async function cancelRequest(
  taskId: number,
  runtime: RequestRuntime = getAgentRuntime(),
): Promise<CredentialCancelled> {
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
