import { z } from "zod";
import { MAX_ANSWER_TEXT } from "@tiny-agents/agent";

const toolPermissions = z.record(z.string().min(1).max(128), z.enum(["allow", "ask", "off"]));
const browserProfile = z.enum(["shared", "own"]);

export const createBotSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  description: z.string().trim().max(200).optional().default(""),
  systemPrompt: z
    .string()
    .max(24_576, "System prompt is too long (max ~24 KB)")
    .optional()
    .default(""),
  modelId: z.string().min(1, "Model is required"),
  toolPermissions: toolPermissions.optional(),
  memoryEnabled: z.boolean().optional(),
  autoReview: z.boolean().optional(),
  yoloByDefault: z.boolean().optional(),
  browserProfile: browserProfile.optional(),
  skillIds: z.array(z.string()).max(200).optional(),
  connectionIds: z.array(z.string()).max(100).optional(),
  guestIds: z.array(z.number().int().positive()).max(50).optional(),
});

export const updateBotSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100).optional(),
  description: z.string().trim().max(200).optional(),
  systemPrompt: z.string().max(24_576, "System prompt is too long (max ~24 KB)").optional(),
  modelId: z.string().min(1, "Model is required").optional(),
  toolPermissions: toolPermissions.optional(),
  memoryEnabled: z.boolean().optional(),
  autoReview: z.boolean().optional(),
  yoloByDefault: z.boolean().optional(),
  browserProfile: browserProfile.optional(),
  skillIds: z.array(z.string()).max(200).optional(),
  connectionIds: z.array(z.string()).max(100).optional(),
  guestIds: z.array(z.number().int().positive()).max(50).optional(),
});

export const chatHistorySchema = z.object({
  before: z.string().regex(/^e\d+$/, "Invalid message id"),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

export const pinBotSchema = z.object({ pinned: z.boolean() });

export const yoloSchema = z.object({ on: z.boolean() });

export const approvalSchema = z.object({
  decision: z.enum(["approved", "denied"]),
  alwaysAllow: z.string().min(1).max(128).optional(),
  everyBot: z.boolean().optional(),
  grant: z.boolean().optional(),
});

export const toolPermissionsSchema = z.object({
  permissions: z.record(z.string().min(1).max(128), z.enum(["allow", "ask", "off"])),
});

const ownerAnswer = z.object({
  selected: z.array(z.string().min(1).max(100)).max(6),
  text: z.string().max(MAX_ANSWER_TEXT).optional(),
});

export const answerQuestionsSchema = z
  .object({
    answers: z.array(ownerAnswer).min(1).max(4).optional(),
    dismissed: z.literal(true).optional(),
  })
  .refine((data) => (data.answers === undefined) !== (data.dismissed === undefined), {
    message: "Send either answers or dismissed",
    path: ["answers"],
  });

export const sendMessageSchema = z
  .object({
    requestId: z.string().min(8, "requestId is required").max(128),
    text: z.string().max(32_768),
    mentions: z.array(z.string().min(1).max(64)).max(20).optional(),
    attachments: z
      .array(z.string().regex(/^[a-f0-9]{24}$/, "Invalid upload id"))
      .max(10)
      .optional(),
    whenBusy: z.enum(["steer", "followUp"]).optional(),
  })
  .refine((data) => (data.text ?? "").trim().length > 0 || (data.attachments?.length ?? 0) > 0, {
    message: "Message text or at least one attachment is required",
    path: ["text"],
  });

export type CreateBotDTO = z.infer<typeof createBotSchema>;
export type UpdateBotDTO = z.infer<typeof updateBotSchema>;
export type ChatHistoryDTO = z.infer<typeof chatHistorySchema>;
