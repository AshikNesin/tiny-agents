import { z } from "zod";

export const welcomeFrameSchema = z.strictObject({
  type: z.literal("welcome"),
  bootId: z.string().min(1).optional(),
});

export type WelcomeFrame = z.infer<typeof welcomeFrameSchema>;

export const replyFrameSchema = z.strictObject({
  type: z.literal("reply"),
  requestId: z.string().min(1).max(100),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.strictObject({ code: z.string(), message: z.string() }).optional(),
});

export type ReplyFrame = z.infer<typeof replyFrameSchema>;

export type EnvelopeFrame = WelcomeFrame | ReplyFrame | { type: "ping" } | { type: "pong" };

export interface ResumeResult {
  known: boolean;
  gap: boolean;
  firstSeq: number;
  lastSeq: number;
}
