/**
 * The browser's vault sinks (issue #56): fill a vault item into the page,
 * enter a one-time code, or have the owner type into a credential request
 * sheet. Values go server → page over CDP; results only say which fields
 * were filled. Everything here acts on the agent's live tab through the
 * session manager and never opens a browser just to plan a call.
 */
import type { Context } from "@earendil-works/chord";
import { Type } from "@earendil-works/pi-ai";
import {
  defineTool,
  type JsonObject,
  type ToolExecutionApi,
  type ToolExecutionResult,
} from "@earendil-works/pi-durable";
import { isUnattendedConversation, withGatePlan } from "../approvals";
import type { ToolInfo } from "../capabilities";
import {
  CREDENTIAL_REQUEST_TTL_MS,
  credentialSubject,
  CREDENTIAL_REQUESTS_PER_HOUR,
  CredentialRequestDoc,
  storedRequest,
  type CredentialField,
  type CredentialFieldType,
  type CredentialRequest,
  pendingCredentialDetails,
  credentialResultDetails,
} from "../credentials";
import { SecretValue, VAULT_RULE, type VaultBroker } from "../vault";
import { refuseUnattended, waitForOwner, type WaitTracker } from "../waiting";
import type { SecretFill, SecretFillField } from "./browser-fill";
import { assertRefShape, parseExemptHosts } from "./browser-guard";
import {
  describeBrowserError,
  type BrowserSession,
  type BrowserSessions,
  type BrowserTarget,
  type LiveBrowserTab,
} from "./browser-sessions";
import { safeMessage, useFromSink, vaultGatePlan } from "./vault";

export interface BrowserVaultOptions {
  /** The vault broker: enables `browser_fill_secret` and `browser_enter_code`. */
  vault?: VaultBroker;
  /** Counts credential requests waiting on the owner; without it `request_credentials` is not offered. */
  ownerWaits?: WaitTracker;
  /** Comma-separated hosts exempt from the https rule for credential requests. */
  allowedPrivateHosts?: string;
}

const fail = (text: string): ToolExecutionResult => ({
  output: [{ type: "text", text }],
  isError: true,
});

export function browserVaultToolInfos(options: BrowserVaultOptions): ToolInfo[] {
  return [
    ...(options.vault
      ? [
          {
            name: "browser_fill_secret",
            label: "Filled a saved login",
            askLabel: "fill a saved login",
            description: "Fill a vault login or card into the page without seeing it.",
            vault: true,
          },
          {
            name: "browser_enter_code",
            label: "Entered a one-time code",
            askLabel: "enter a one-time code",
            description: "Fill a 2FA code from the vault, or ask you for it.",
            vault: true,
          },
        ]
      : []),
    ...(options.ownerWaits
      ? [
          {
            name: "request_credentials",
            label: "Asked you to sign in",
            askLabel: "ask you to sign in",
            description: "Ask you to type a sign-in, code or card into a secure sheet.",
            // The owner's submit is the consent.
            readOnly: true,
          },
        ]
      : []),
  ];
}

async function currentOrigin(session: BrowserSession): Promise<string> {
  if (!session.origin || !session.fillSecret) {
    throw new Error("This browser can't fill vault values.");
  }
  return session.origin();
}

type FillableField = "password" | "username" | "card";

function expiryParts(value: SecretValue, wrap: (v: string) => SecretValue) {
  const [month = "", year = ""] = value.reveal().split("/");
  const full = year.length === 2 ? `20${year}` : year;
  return {
    combined: wrap(`${month}/${full.slice(-2)}`),
    month: wrap(month),
    year: wrap(full),
  };
}

const ORIGIN_MOVED = (origin: string) =>
  `The page is now on ${origin}, not the origin this call was approved for. Nothing was filled.`;

const OPEN_PAGE_FIRST = "Open the sign-in or checkout page in the browser first.";

/** A credential request's fields as the tool accepts them. */
const credentialFieldSchema = Type.Object({
  key: Type.String({ minLength: 1, maxLength: 32, description: "Slug: password, email, code" }),
  label: Type.String({ minLength: 1, maxLength: 60 }),
  type: Type.Union(
    ["text", "email", "password", "otp", "card_number", "expiry", "cvc", "select"].map((t) =>
      Type.Literal(t),
    ),
  ),
  required: Type.Optional(Type.Boolean()),
  autocomplete: Type.Optional(
    Type.String({ maxLength: 40, description: "HTML autocomplete token (username, email, …)" }),
  ),
  options: Type.Optional(
    Type.Array(Type.String({ minLength: 1, maxLength: 60 }), { minItems: 1, maxItems: 20 }),
  ),
  ref: Type.Optional(Type.String({ minLength: 2, maxLength: 32 })),
});

/** Identifier-like tokens a visible (text, email, select) field may carry: no free text. */
const IDENTIFIER_TOKENS = new Set([
  "username",
  "email",
  "name",
  "given-name",
  "family-name",
  "tel",
  "organization",
  "postal-code",
  "country",
  "country-name",
  "address-line1",
  "address-line2",
  "address-level1",
  "address-level2",
  "cc-name",
  "cc-exp-month",
  "cc-exp-year",
  "cc-type",
]);

const DEFAULT_TOKEN: Record<CredentialFieldType, string> = {
  text: "username",
  email: "email",
  // The HTML autocomplete token, not a credential.
  password: "current-password", // gitleaks:allow
  otp: "one-time-code",
  card_number: "cc-number",
  expiry: "cc-exp",
  cvc: "cc-csc",
  select: "",
};

type CredentialArgs = {
  origin?: string;
  title: string;
  purpose: string;
  fields: {
    key: string;
    label: string;
    type: string;
    required?: boolean;
    autocomplete?: string;
    options?: string[];
    ref?: string;
  }[];
};

/** The request as stored and shown, or why it is refused. */
function normalizeCredentialRequest(
  args: CredentialArgs,
  pageOrigin: string,
  allowedPrivateHosts?: string,
): CredentialRequest | string {
  let origin: URL;
  try {
    origin = new URL(pageOrigin);
  } catch {
    return "Open the sign-in page in the browser first.";
  }
  const exempt = parseExemptHosts(allowedPrivateHosts);
  if (origin.protocol !== "https:" && !exempt.has(origin.hostname.toLowerCase())) {
    return "Credentials can only be requested for an https page.";
  }
  if (args.origin && args.origin.replace(/\/+$/, "") !== origin.origin) {
    return `The page is on ${origin.origin}, not ${args.origin}. Credentials only fill on the page's own origin.`;
  }
  if (args.fields.length === 0 || args.fields.length > 8) return "Ask for 1 to 8 fields.";
  if (args.title.length > 80 || args.purpose.length > 200) return "Title or purpose is too long.";
  const keys = new Set<string>();
  const fields: CredentialField[] = [];
  for (const field of args.fields) {
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(field.key) || keys.has(field.key)) {
      return `Field key "${field.key}" must be a unique lowercase slug.`;
    }
    keys.add(field.key);
    const type = field.type as CredentialFieldType;
    const autocomplete = (field.autocomplete ?? DEFAULT_TOKEN[type]).trim().toLowerCase();
    if (
      (type === "text" || type === "email" || type === "select") &&
      !IDENTIFIER_TOKENS.has(autocomplete)
    ) {
      return `Field "${field.key}" needs an identifier autocomplete (username, email, name, postal-code, …); free-text fields are not allowed.`;
    }
    if (type === "select" && !field.options?.length) return `Field "${field.key}" needs options.`;
    if (field.ref) {
      try {
        assertRefShape(field.ref);
      } catch (error) {
        return (error as Error).message;
      }
    }
    fields.push({
      key: field.key,
      label: field.label.replace(/\s+/g, " ").trim(),
      type,
      required: field.required ?? true,
      autocomplete,
      ...(type === "select" ? { options: field.options } : {}),
      ...(field.ref ? { ref: field.ref } : {}),
    });
  }
  return {
    origin: origin.origin,
    title: args.title.replace(/\s+/g, " ").trim(),
    purpose: args.purpose.replace(/\s+/g, " ").trim(),
    fields,
  };
}

/**
 * The vault sink tools, acting on the agent's tab through `sessions`.
 * `targetOf` maps a conversation to its browser target (the toolkit's
 * resolver).
 */
export function createBrowserVaultTools(
  options: BrowserVaultOptions,
  sessions: BrowserSessions,
  targetOf: (conversationId: number) => Promise<BrowserTarget>,
) {
  const broker = options.vault;
  const tracker = options.ownerWaits;
  const tools = [];
  /** Open credential requests and recent ones, per conversation (rate limits). */
  const openRequests = new Map<number, number>();
  const recentRequests = new Map<number, number[]>();

  /** The agent's tab if its browser is open; planning never launches one. */
  const peek = async (conversationId: number): Promise<LiveBrowserTab | undefined> =>
    sessions.peek(await targetOf(conversationId));

  /** The page's origin for planning, or undefined when no browser or page is open. */
  const plannedOrigin = async (conversationId: number): Promise<string | undefined> => {
    const tab = await peek(conversationId);
    if (!tab) return undefined;
    const origin = await currentOrigin(tab.session);
    return /^https?:\/\//.test(origin) ? origin : undefined;
  };

  /** Ask the owner through the credential request sheet and wait (shared by enter_code). */
  const requestCredentials = async (
    args: CredentialArgs,
    api: ToolExecutionApi,
    context: Context,
  ): Promise<ToolExecutionResult> => {
    if (!tracker) return fail("Credential requests are not available.");
    const conversation = Number(api.conversationId);
    const taskId = Number(api.taskId);
    const existing = await api.snapshot(CredentialRequestDoc, api.taskId, context);
    let request = existing ? storedRequest(existing) : null;
    if (!request) {
      // A routine's run (issue #63) has nobody to fill the sheet: refused like
      // an approval nobody can give, so the run shows as needing attention (#87).
      if (await isUnattendedConversation(api, context)) {
        return refuseUnattended(
          "Nobody can fill credentials here: this is a scheduled routine run. Use a saved vault item, or say in your reply what is needed.",
        );
      }
      const tab = await peek(conversation);
      const normalized = normalizeCredentialRequest(
        args,
        tab ? await currentOrigin(tab.session).catch(() => "null") : "null",
        options.allowedPrivateHosts,
      );
      if (typeof normalized === "string") return fail(normalized);
      const open = openRequests.get(conversation);
      if (open !== undefined && open !== taskId) {
        return fail("A credential request is already open in this chat. Wait for the owner.");
      }
      const hour = Date.now() - 60 * 60_000;
      const recent = (recentRequests.get(conversation) ?? []).filter((at) => at > hour);
      if (recent.length >= CREDENTIAL_REQUESTS_PER_HOUR) {
        return fail(
          "Too many credential requests this hour. Ask the owner to take over the browser.",
        );
      }
      recentRequests.set(conversation, [...recent, Date.now()]);
      const saved = broker
        ? await broker
            .requested({ conversation, taskId, origin: normalized.origin, title: normalized.title })
            .catch(() => ({ savedHandle: undefined }))
        : { savedHandle: undefined };
      request = { ...normalized, ...(saved.savedHandle ? { savedHandle: saved.savedHandle } : {}) };
    }
    const stored = request;
    openRequests.set(conversation, taskId);
    try {
      const doc = await waitForOwner(
        api,
        tracker,
        CredentialRequestDoc,
        (value) => pendingCredentialDetails(stored, value.expiresAt),
        context,
        (value) => {
          if (!value.request) {
            value.request = stored as unknown as JsonObject;
            value.expiresAt = Date.now() + CREDENTIAL_REQUEST_TTL_MS;
          }
        },
        { tool: "request_credentials", subject: credentialSubject(stored) },
      );
      const result = {
        status: doc.status,
        filled_fields: doc.filled,
        ...(doc.savedHandle ? { saved_item_handle: doc.savedHandle } : {}),
      };
      const next =
        doc.status === "filled"
          ? " Submit the form (take a snapshot to find the button)."
          : doc.status === "cancelled"
            ? " The owner cancelled: don't ask again unless they say so."
            : " Nobody answered in time.";
      return {
        output: [{ type: "text", text: JSON.stringify(result) + next }],
        ...(doc.status === "filled" ? {} : { isError: true }),
        details: credentialResultDetails(doc, stored),
      };
    } finally {
      if (openRequests.get(conversation) === taskId) openRequests.delete(conversation);
    }
  };

  if (broker) {
    tools.push(
      withGatePlan(
        defineTool({
          name: "browser_fill_secret",
          description:
            "Fill a vault item into the current page without seeing its value: a login's password " +
            "(or username), or a card's number, expiry, security code and name. Find the handle with " +
            "vault_list. Only fills on the item's exact origins. Pass `ref` from the last snapshot " +
            "for a single field; otherwise the fields are found by their form markup. Type the " +
            "username yourself with browser_type if you prefer. " +
            VAULT_RULE,
          parameters: Type.Object({
            handle: Type.String({ minLength: 1, maxLength: 64 }),
            field: Type.Optional(
              Type.Union(
                [Type.Literal("password"), Type.Literal("username"), Type.Literal("card")],
                {
                  description: "Default: password for logins, card for cards",
                },
              ),
            ),
            ref: Type.Optional(Type.String({ minLength: 2, maxLength: 32 })),
          }),
          replay: "unsafe",
          execute: async (args, api, context) => {
            try {
              if (args.ref) assertRefShape(args.ref);
              const s = await sessions.actionTurn(await targetOf(Number(api.conversationId)));
              const origin = await currentOrigin(s.session);
              let chosen = "password" as FillableField;
              const result = await useFromSink(
                broker,
                api,
                context,
                {
                  handle: args.handle,
                  tool: "browser_fill_secret",
                  targetKind: "origin",
                  target: origin,
                },
                (item) => {
                  chosen = args.field ?? (item.kind === "card" ? "card" : "password");
                  if (chosen === "card") {
                    if (item.kind !== "card") return [];
                    return ["card_number", "card_expiry", "card_cvc", "card_holder"];
                  }
                  return item.kind === "login" ? [chosen] : [];
                },
                async (values, item) => {
                  const fields: SecretFillField[] = [];
                  const wrap = (v: string) => new SecretValue(v);
                  if (chosen === "card") {
                    if (values.card_number) {
                      fields.push({
                        key: "card_number",
                        autocomplete: "cc-number",
                        value: wrap(values.card_number.reveal().replace(/\D/g, "")),
                      });
                    }
                    if (values.card_expiry) {
                      const parts = expiryParts(values.card_expiry, wrap);
                      fields.push(
                        { key: "card_expiry", autocomplete: "cc-exp", value: parts.combined },
                        {
                          key: "card_expiry_month",
                          autocomplete: "cc-exp-month",
                          value: parts.month,
                        },
                        { key: "card_expiry_year", autocomplete: "cc-exp-year", value: parts.year },
                      );
                    }
                    if (values.card_cvc) {
                      fields.push({
                        key: "card_cvc",
                        autocomplete: "cc-csc",
                        value: values.card_cvc,
                      });
                    }
                    if (values.card_holder) {
                      fields.push({
                        key: "card_holder",
                        autocomplete: "cc-name",
                        value: values.card_holder,
                      });
                    }
                  } else {
                    const value = values[chosen];
                    if (value) {
                      fields.push({
                        key: chosen,
                        autocomplete: chosen === "password" ? "current-password" : "username",
                        value,
                        ...(args.ref ? { ref: args.ref } : {}),
                      });
                    }
                  }
                  const fill: SecretFill = {
                    origin,
                    // An embedded payment form may sit on one of the item's other origins.
                    frameOrigins: item.origins.filter((o) => o !== origin),
                    fields,
                  };
                  return s.session.fillSecret!(fill);
                },
                ORIGIN_MOVED,
              );
              const filled = [
                ...new Set(result.filled.map((key) => key.replace(/_(month|year)$/, ""))),
              ];
              if (filled.length === 0) {
                return fail(
                  `No matching field found on ${origin}. Take a snapshot and pass the field's ref.`,
                );
              }
              const next =
                chosen === "card"
                  ? "Check the order total, then submit."
                  : `Submit the form; if asked for a one-time code, call browser_enter_code with handle ${args.handle}.`;
              return {
                output: [{ type: "text", text: JSON.stringify({ filled, origin, next }) }],
                details: { filled, origin },
              };
            } catch (error) {
              return fail(safeMessage(error));
            }
          },
        }),
        vaultGatePlan(broker, true, async (args: { handle: string }, api) => {
          const origin = await plannedOrigin(Number(api.conversationId));
          if (!origin) return { refuse: OPEN_PAGE_FIRST };
          return {
            handle: args.handle,
            tool: "browser_fill_secret",
            targetKind: "origin",
            target: origin,
          };
        }),
      ),
      withGatePlan(
        defineTool({
          name: "browser_enter_code",
          description:
            "Enter a 2FA one-time code into the current page. With a vault handle whose item has a " +
            "one-time-password seed, the server generates the code and fills it. Without one (codes " +
            "sent by SMS or email), the owner is asked to type it into a secure sheet. " +
            VAULT_RULE,
          parameters: Type.Object({
            handle: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
            ref: Type.Optional(Type.String({ minLength: 2, maxLength: 32 })),
          }),
          replay: "unsafe",
          execute: async (args, api, context) => {
            const askOwner = () =>
              requestCredentials(
                {
                  title: "Enter the one-time code",
                  purpose: "The site asks for a verification code.",
                  fields: [
                    {
                      key: "code",
                      label: "One-time code",
                      type: "otp",
                      autocomplete: "one-time-code",
                      ...(args.ref ? { ref: args.ref } : {}),
                    },
                  ],
                },
                api,
                context,
              );
            try {
              if (args.ref) assertRefShape(args.ref);
              if (!args.handle) return await askOwner();
              const s = await sessions.actionTurn(await targetOf(Number(api.conversationId)));
              const origin = await currentOrigin(s.session);
              let hasSeed = true;
              const result = await useFromSink(
                broker,
                api,
                context,
                {
                  handle: args.handle,
                  tool: "browser_enter_code",
                  targetKind: "origin",
                  target: origin,
                },
                (item) => {
                  hasSeed = item.hasTotp;
                  return item.hasTotp ? ["totp"] : [];
                },
                async (values) =>
                  values.totp
                    ? s.session.fillSecret!({
                        origin,
                        fields: [
                          {
                            key: "code",
                            autocomplete: "one-time-code",
                            value: values.totp,
                            ...(args.ref ? { ref: args.ref } : {}),
                          },
                        ],
                      })
                    : { filled: [] },
                ORIGIN_MOVED,
              );
              if (!hasSeed) return await askOwner();
              if (result.filled.length === 0) {
                return fail(
                  `No code field found on ${origin}. Take a snapshot and pass the field's ref.`,
                );
              }
              return {
                output: [
                  {
                    type: "text",
                    text: JSON.stringify({ filled: ["code"], origin, next: "Submit the code." }),
                  },
                ],
                details: { filled: ["code"], origin },
              };
            } catch (error) {
              return fail(safeMessage(error));
            }
          },
        }),
        {
          // Without a handle the call only parks on the credential sheet, so a
          // restart re-attaches to it instead of reporting "interrupted".
          replaySafe: (args: { handle?: string }) => !args.handle,
          ...vaultGatePlan(broker, false, async (args: { handle?: string }, api) => {
            if (!args.handle) return undefined;
            const origin = await plannedOrigin(Number(api.conversationId));
            if (!origin) return { refuse: "Open the page asking for the code first." };
            return {
              handle: args.handle,
              tool: "browser_enter_code",
              targetKind: "origin",
              target: origin,
            };
          }),
        },
      ),
    );
  }

  if (tracker) {
    tools.push(
      defineTool({
        name: "request_credentials",
        description:
          "Ask the owner to type credentials for the current page into a secure sheet: a sign-in, " +
          "a one-time code sent by SMS or email, or a card. The server fills what they type " +
          "straight into the page (only on its current origin) and you only learn which fields " +
          "were filled. Call vault_list first and prefer browser_fill_secret when a handle exists. " +
          "Fields: 1-8, each with a slug key, a short label and a type; text, email and select " +
          "fields need an identifier autocomplete (username, email, name, postal-code, …). " +
          "Your reply pauses until the owner answers (10 minutes at most). " +
          VAULT_RULE,
        parameters: Type.Object({
          origin: Type.Optional(
            Type.String({ maxLength: 300, description: "The page's origin; checked, not trusted" }),
          ),
          title: Type.String({ minLength: 1, maxLength: 80, description: "Sign in to Umami" }),
          purpose: Type.String({ minLength: 1, maxLength: 200 }),
          fields: Type.Array(credentialFieldSchema, { minItems: 1, maxItems: 8 }),
        }),
        // Re-running only re-attaches to the call's document (waitForOwner).
        replay: "safe",
        execute: async (args, api, context) => {
          try {
            return await requestCredentials(args, api, context);
          } catch (error) {
            return fail(describeBrowserError(error));
          }
        },
      }),
    );
  }
  return tools;
}
