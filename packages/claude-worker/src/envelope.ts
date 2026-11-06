/**
 * Frames every worker socket carries, whichever protocol rides on it (the
 * bot protocol in `protocol.ts`, the coding protocol in `coding-protocol.ts`).
 * The client side reads them in `WorkerConnection` (`connection.ts`); the
 * protocols never see them.
 *
 * - `welcome`: the worker's first frame on a socket. `bootId` changes when the
 *   worker process restarts, and with it every session's `seq` numbering.
 * - `ping` / `pong`: either side pings; the other answers.
 * - `reply`: exactly one per request (a client message with a `requestId`).
 * - Session events carry `sessionId` and a per-session `seq`; a resume request
 *   (`resume` or `coding.resume`) answers a `ResumeResult`, then replays the
 *   buffered events after `afterSeq`. Both protocols keep those events in a
 *   `SessionLog` (`session-log.ts`), which also answers the `ResumeResult`.
 */
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

/** What a resume request answers before it replays. */
export interface ResumeResult {
  /** The worker has this session (false after a worker restart). */
  known: boolean;
  /** Events after `afterSeq` were dropped from the buffer: reload history. */
  gap: boolean;
  /** The oldest event still buffered (the replay starts here on a gap). */
  firstSeq: number;
  lastSeq: number;
}
