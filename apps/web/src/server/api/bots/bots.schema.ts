import { z } from "zod";

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
  toolkits: toolkits.optional(),
  toolPermissions: toolPermissions.optional(),
  memoryEnabled: z.boolean().optional(),
  skillIds: z.array(z.string()).max(200).optional(),
  connectionIds: z.array(z.string()).max(100).optional(),
});

export const updateBotSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100).optional(),
  description: z.string().trim().max(200).optional(),
  systemPrompt: z.string().max(24_576, "System prompt is too long (max ~24 KB)").optional(),
  modelId: z.string().min(1, "Model is required").optional(),
  toolkits: toolkits.optional(),
  toolPermissions: toolPermissions.optional(),
  memoryEnabled: z.boolean().optional(),
  skillIds: z.array(z.string()).max(200).optional(),
  connectionIds: z.array(z.string()).max(100).optional(),
});

export const pinBotSchema = z.object({ pinned: z.boolean() });

export const approvalSchema = z.object({
  decision: z.enum(["approved", "denied"]),
  /** Tool name to switch to `allow` for this bot along with approving. */
  alwaysAllow: z.string().min(1).max(128).optional(),
});

export const sendMessageSchema = z
  .object({
    requestId: z.string().min(8, "requestId is required").max(128),
    text: z.string().max(32_768),
    /** Bot ids the text @mentions; the server delivers copies to each. */
    mentions: z.array(z.string().min(1).max(64)).max(20).optional(),
    /** Upload ids attached to this message (issue #17). */
    attachments: z
      .array(z.string().regex(/^[a-f0-9]{24}$/, "Invalid upload id"))
      .max(10)
      .optional(),
    /**
     * Placement while a reply runs: "steer" joins it after the current tool
     * round, "followUp" is answered by the next run. Default: followUp.
     */
    whenBusy: z.enum(["steer", "followUp"]).optional(),
  })
  .refine((data) => (data.text ?? "").trim().length > 0 || (data.attachments?.length ?? 0) > 0, {
    message: "Message text or at least one attachment is required",
    path: ["text"],
  });

export type CreateBotDTO = z.infer<typeof createBotSchema>;
export type UpdateBotDTO = z.infer<typeof updateBotSchema>;
export type SendMessageDTO = z.infer<typeof sendMessageSchema>;
export type ApprovalDTO = z.infer<typeof approvalSchema>;
