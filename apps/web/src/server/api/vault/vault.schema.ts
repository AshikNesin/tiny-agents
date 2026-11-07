import { z } from "zod";

const KINDS = ["login", "card", "identity", "api_key"] as const;

const VALUE_FIELDS = [
  "username",
  "password",
  "totp",
  "notes",
  "card_number",
  "card_expiry",
  "card_cvc",
  "card_holder",
  "card_billing_address",
  "identity_name",
  "identity_email",
  "identity_phone",
  "identity_address",
  "value",
] as const;

const handle = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{0,47}$/, "Lowercase letters, digits and dashes (max 48)");

const origin = z
  .string()
  .trim()
  .transform((value, ctx) => {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
      return url.origin;
    } catch {
      ctx.addIssue({ code: "custom", message: `"${value}" is not an http(s) origin` });
      return z.NEVER;
    }
  });

const host = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9.-]+(:\d+)?$/, "A hostname, optionally with a port");

/** Who and what may use an item: never a value. */
const policySchema = z.object({
  handle,
  label: z.string().trim().min(1).max(120).optional(),
  origins: z.array(origin).max(20).default([]),
  hosts: z.array(host).max(20).default([]),
  inject: z
    .object({
      as: z.literal("header"),
      name: z
        .string()
        .trim()
        .min(1)
        .max(100)
        .regex(/^[A-Za-z0-9-]+$/),
      format: z.string().max(200).default("{value}"),
    })
    .optional()
    .nullable(),
  tools: z.array(z.string().min(1).max(64)).max(20).default([]),
  /** null: every bot. */
  bots: z.array(z.string().min(1).max(64)).max(100).nullable().default(null),
  approval: z.enum(["every_use", "per_conversation", "allowed"]).default("per_conversation"),
  allowUnattended: z.boolean().default(false),
  whenToUse: z.string().trim().max(300).optional().nullable(),
  disabled: z.boolean().default(false),
  /** api_key: which value field holds the key. */
  field: z.enum(VALUE_FIELDS).optional().nullable(),
});

const values = z.partialRecord(z.enum(VALUE_FIELDS), z.string().max(10_000));

export const createItemSchema = z.object({
  kind: z.enum(KINDS),
  title: z.string().trim().min(1).max(120),
  /** Websites; their origins become the item's allowed origins unless policy names others. */
  urls: z.array(z.string().trim().url().max(2000)).max(20).default([]),
  values,
  policy: policySchema,
});

export const linkItemSchema = z.object({
  backend: z.enum(["onepassword-connect", "local"]),
  externalId: z.string().min(1).max(200),
  policy: policySchema,
});

export const updateItemSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  urls: z.array(z.string().trim().url().max(2000)).max(20).optional(),
  /** Set these values; "" clears a field (local backend). */
  values: values.optional(),
  policy: policySchema.partial({ handle: true }).optional(),
});

export const patchValueSchema = z.object({
  field: z.enum(VALUE_FIELDS),
  value: z.string().max(10_000),
});

export const revealSchema = z.object({
  field: z.enum(VALUE_FIELDS),
  purpose: z.enum(["reveal", "copy"]).default("reveal"),
});

export const deleteQuerySchema = z.object({
  /** Also delete it in the backend (1Password); otherwise only unlink. */
  purge: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export const stepUpSchema = z.union([
  z.object({ password: z.string().min(1).max(500) }),
  z.object({ passkey: z.record(z.string(), z.unknown()) }),
]);

/** The owner's submit of a credential request: values only for the request's keys. */
export const submitCredentialsSchema = z.object({
  values: z.record(z.string().max(32), z.string().max(2000)),
  save: z.boolean().default(false),
});

export type PolicyDTO = z.infer<typeof policySchema>;
export type CreateItemDTO = z.infer<typeof createItemSchema>;
export type UpdateItemDTO = z.infer<typeof updateItemSchema>;
