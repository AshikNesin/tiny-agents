import { z } from "zod";

const KINDS = [
  "anthropic",
  "openai-chat",
  "openai-responses",
  "gemini",
  "cloudflare-ai-gateway",
  "claude-plan",
] as const;

export const ROLES = [
  "bot_default",
  "memory_capture",
  "chat_title",
  "vision",
  "classifier",
] as const;

const name = z.string().trim().min(1).max(80);
const apiKey = z.string().trim().min(1).max(4_000);
const baseUrl = z.string().trim().min(1).max(500);
const id = z.string().trim().min(1).max(100);
const maxTurns = z.union([z.number().int().min(1).max(1_000), z.literal("unlimited")]);

const settings = z.strictObject({
  accountId: z.string().trim().min(1).max(100).optional(),
  gatewayId: z.string().trim().min(1).max(100).optional(),
  upstream: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]+$/, "Lowercase letters, digits and dashes")
    .max(100)
    .optional(),
  basePath: z.string().trim().max(200).optional(),
  customProviders: z
    .array(
      z.strictObject({
        slug: z
          .string()
          .trim()
          .regex(/^custom-[a-z0-9-]+$/, "The gateway's slug, like custom-zai-coding-plan"),
        basePath: z.string().trim().max(200).optional(),
      }),
    )
    .max(20)
    .optional(),
  fallbackModelId: id.nullable().optional(),
  maxTurns: maxTurns.nullable().optional(),
});

const overridesSchema = z.strictObject({
  contextWindow: z.number().int().min(1_000).max(10_000_000).optional(),
  maxOutputTokens: z.number().int().min(1).max(1_000_000).optional(),
  imageInput: z.boolean().optional(),
  reasoning: z.boolean().optional(),
});

const compat = z.record(z.string(), z.unknown()).nullable();

const connection = {
  kind: z.enum(KINDS),
  baseUrl: baseUrl.nullable().optional(),
  apiKey: apiKey.optional(),
  settings: settings.default({}),
  allowPrivateNetwork: z.boolean().default(false),
  viaProviderId: id.nullable().optional(),
};

export const discoverSchema = z.strictObject(connection);

export const createAccountSchema = z.strictObject({
  ...connection,
  name: name.optional(),
  discovery: z.enum(["auto", "manual"]).default("auto"),
  models: z.array(z.string().min(1).max(300)).max(5_000).default([]),
  model: z
    .strictObject({
      upstreamId: z.string().trim().min(1).max(300),
      name: name.optional(),
      overrides: overridesSchema.default({}),
      compat: compat.optional(),
    })
    .optional(),
});

export const patchAccountSchema = z.strictObject({
  name: name.optional(),
  enabled: z.boolean().optional(),
  fallbackModelId: id.nullable().optional(),
  maxTurns: maxTurns.nullable().optional(),
});

export const updateConnectionSchema = z.strictObject({
  baseUrl: baseUrl.nullable().optional(),
  apiKey: apiKey.optional(),
  settings: settings.optional(),
  allowPrivateNetwork: z.boolean().optional(),
});

export const addModelSchema = z.strictObject({
  upstreamId: z.string().trim().min(1).max(300),
  name: name.optional(),
  overrides: overridesSchema.default({}),
  compat: compat.optional(),
});

export const patchModelSchema = z.strictObject({
  name: name.optional(),
  enabled: z.boolean().optional(),
  overrides: overridesSchema.optional(),
  compat: compat.optional(),
});

export const moveToSchema = z.strictObject({ moveTo: id.optional() });

export const testSchema = z.union([
  z.strictObject({ modelId: id }),
  z.strictObject({
    ...connection,
    upstreamId: z.string().trim().min(1).max(300),
    image: z.boolean().default(false),
  }),
]);

export const rolesSchema = z.partialRecord(z.enum(ROLES), id.nullable());

export type CreateAccountDTO = z.infer<typeof createAccountSchema>;
export type DiscoverDTO = z.infer<typeof discoverSchema>;
export type UpdateConnectionDTO = z.infer<typeof updateConnectionSchema>;
export type Overrides = z.infer<typeof overridesSchema>;
export type TestDTO = z.infer<typeof testSchema>;
