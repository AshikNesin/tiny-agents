/**
 * Request bodies of the Models routes (issue #179). Strict: unknown fields are
 * rejected. No response carries a key.
 */
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
/** Claude plan: Claude Code `maxTurns` per turn; the worker's limit is 1,000. */
const maxTurns = z.number().int().min(1).max(1_000);

/** Kind-specific, non-secret settings. */
const settings = z.strictObject({
  /** cloudflare-ai-gateway */
  accountId: z.string().trim().min(1).max(100).optional(),
  gatewayId: z.string().trim().min(1).max(100).optional(),
  /** gateway route */
  upstream: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]+$/, "Lowercase letters, digits and dashes")
    .max(100)
    .optional(),
  basePath: z.string().trim().max(200).optional(),
  /**
   * cloudflare-ai-gateway: providers configured in the gateway itself (BYOK
   * custom providers), by slug, with the path the gateway appends.
   */
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
  /** claude-plan: a pi model a turn moves to when the plan is off or unreachable */
  fallbackModelId: id.nullable().optional(),
  /** claude-plan: Claude Code `maxTurns` per turn; absent: the worker's default */
  maxTurns: maxTurns.nullable().optional(),
});

/** Capability overrides: a key present wins over the catalog. */
const overridesSchema = z.strictObject({
  contextWindow: z.number().int().min(1_000).max(10_000_000).optional(),
  maxOutputTokens: z.number().int().min(1).max(1_000_000).optional(),
  imageInput: z.boolean().optional(),
  reasoning: z.boolean().optional(),
});

const compat = z.record(z.string(), z.unknown()).nullable();

/** An endpoint to reach: what discovery, Test and a new account start from. */
const connection = {
  kind: z.enum(KINDS),
  baseUrl: baseUrl.nullable().optional(),
  apiKey: apiKey.optional(),
  settings: settings.default({}),
  allowPrivateNetwork: z.boolean().default(false),
  /** An OpenAI Chat account routed through this gateway account. */
  viaProviderId: id.nullable().optional(),
};

export const discoverSchema = z.strictObject(connection);

export const createAccountSchema = z.strictObject({
  ...connection,
  name: name.optional(),
  /** auto: models come from discovery; manual: the "single model" tab adds one. */
  discovery: z.enum(["auto", "manual"]).default("auto"),
  /** auto: the upstream ids to add (enabled). */
  models: z.array(z.string().min(1).max(300)).max(5_000).default([]),
  /** manual: the one model to add. */
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
  /** Only the Claude plan's fallback and max turns can change without step-up. */
  fallbackModelId: id.nullable().optional(),
  /** Claude plan: null goes back to the worker's default. */
  maxTurns: maxTurns.nullable().optional(),
});

export const updateConnectionSchema = z.strictObject({
  baseUrl: baseUrl.nullable().optional(),
  /** Blank keeps the saved key; a new origin needs a new key. */
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
    /** Also send a 1×1 image, to check image input. */
    image: z.boolean().default(false),
  }),
]);

export const rolesSchema = z.partialRecord(z.enum(ROLES), id.nullable());

export type CreateAccountDTO = z.infer<typeof createAccountSchema>;
export type DiscoverDTO = z.infer<typeof discoverSchema>;
export type UpdateConnectionDTO = z.infer<typeof updateConnectionSchema>;
export type Overrides = z.infer<typeof overridesSchema>;
export type TestDTO = z.infer<typeof testSchema>;
