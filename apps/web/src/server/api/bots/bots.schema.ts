import { z } from "zod";

export const AVATAR_COLORS = [
  "#14b8a6",
  "#0ea5e9",
  "#8b5cf6",
  "#f43f5e",
  "#f59e0b",
  "#10b981",
  "#6366f1",
  "#ec4899",
] as const;

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Avatar colour must be a hex value like #14b8a6");

const toolkits = z.array(z.string().min(1).max(64)).max(50);
const toolPermissions = z.record(z.string().min(1).max(128), z.enum(["allow", "ask", "off"]));

export const createBotSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  description: z.string().trim().max(200).optional().default(""),
  systemPrompt: z
    .string()
    .max(24_576, "System prompt is too long (max ~24 KB)")
    .optional()
    .default(""),
  modelId: z.string().min(1, "Model is required"),
  avatarEmoji: z.string().trim().max(16).optional(),
  avatarColor: hexColor.optional().default(AVATAR_COLORS[0]),
  toolkits: toolkits.optional(),
  toolPermissions: toolPermissions.optional(),
  skillIds: z.array(z.string()).max(200).optional(),
  connectionIds: z.array(z.string()).max(100).optional(),
});

export const updateBotSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100).optional(),
  description: z.string().trim().max(200).optional(),
  systemPrompt: z.string().max(24_576, "System prompt is too long (max ~24 KB)").optional(),
  modelId: z.string().min(1, "Model is required").optional(),
  avatarEmoji: z.string().trim().max(16).nullable().optional(),
  avatarColor: hexColor.optional(),
  toolkits: toolkits.optional(),
  toolPermissions: toolPermissions.optional(),
  skillIds: z.array(z.string()).max(200).optional(),
  connectionIds: z.array(z.string()).max(100).optional(),
});

export const approvalSchema = z.object({
  decision: z.enum(["approved", "denied"]),
  /** Tool name to switch to `allow` for this bot along with approving. */
  alwaysAllow: z.string().min(1).max(128).optional(),
});

export const sendMessageSchema = z.object({
  requestId: z.string().min(8, "requestId is required").max(128),
  text: z.string().min(1, "Message text is required").max(32_768),
});

export type CreateBotDTO = z.infer<typeof createBotSchema>;
export type UpdateBotDTO = z.infer<typeof updateBotSchema>;
export type SendMessageDTO = z.infer<typeof sendMessageSchema>;
export type ApprovalDTO = z.infer<typeof approvalSchema>;
