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

const policyFields = {
  handle,
  label: z.string().trim().min(1).max(120),
  origins: z.array(origin).max(20),
  hosts: z.array(host).max(20),
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
    .nullable(),
  tools: z.array(z.string().min(1).max(64)).max(20),
  bots: z.array(z.string().min(1).max(64)).max(100).nullable(),
  approval: z.enum(["every_use", "per_conversation", "allowed"]),
  allowUnattended: z.boolean(),
  whenToUse: z.string().trim().max(300).nullable(),
  disabled: z.boolean(),
  field: z.enum(VALUE_FIELDS).nullable(),
};

const policySchema = z.object({
  ...policyFields,
  label: policyFields.label.optional(),
  origins: policyFields.origins.default([]),
  hosts: policyFields.hosts.default([]),
  inject: policyFields.inject.optional(),
  tools: policyFields.tools.default([]),
  bots: policyFields.bots.default(null),
  approval: policyFields.approval.default("per_conversation"),
  allowUnattended: policyFields.allowUnattended.default(false),
  whenToUse: policyFields.whenToUse.optional(),
  disabled: policyFields.disabled.default(false),
  field: policyFields.field.optional(),
});

const values = z.partialRecord(z.enum(VALUE_FIELDS), z.string().max(10_000));

export const createItemSchema = z.object({
  kind: z.enum(KINDS),
  title: z.string().trim().min(1).max(120),
  urls: z.array(z.string().trim().url().max(2000)).max(20).default([]),
  values,
  policy: policySchema,
});

export const linkItemSchema = z.object({
  backend: z.enum(["onepassword", "local"]),
  externalId: z.string().min(1).max(200),
  policy: policySchema,
});

export const updateItemSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  urls: z.array(z.string().trim().url().max(2000)).max(20).optional(),
  values: values.optional(),
  policy: z.object(policyFields).partial().optional(),
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
  purge: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export const stepUpSchema = z.union([
  z.object({ password: z.string().min(1).max(500) }),
  z.object({ passkey: z.record(z.string(), z.unknown()) }),
]);

export const submitCredentialsSchema = z.object({
  values: z.record(z.string().max(32), z.string().max(2000)),
  save: z.boolean().default(false),
});

export type PolicyDTO = z.infer<typeof policySchema>;
export type CreateItemDTO = z.infer<typeof createItemSchema>;
export type UpdateItemDTO = z.infer<typeof updateItemSchema>;
