/**
 * Owner send: everything about putting an owner message in front of a bot,
 * from its Echo to the server's confirmation (GLOSSARY: Echo).
 *
 * - The request id is minted once per Echo. Every attempt of that message
 *   reuses it, so the server's submit (idempotent by request id) can never
 *   place it twice, even when an answer was lost on the way back.
 * - A send that got no answer while the browser is offline keeps its Echo
 *   and goes again, with the same id, once the browser is back online.
 * - A refusal (the server answered with an error, or no answer while
 *   online) withdraws the Echo, says why, and resolves "restored": the
 *   composer puts the draft back for another try.
 * - Confirmation itself happens in the chat store, by request id
 *   (`echoMatches` in store/bots.ts).
 *
 * Everything outside the browser tab (HTTP, the online signal, the chat
 * store, toasts) comes in through `OwnerSendPorts`, so tests drive it with
 * fakes; `ownerSend` is the instance wired to the real ones.
 */
import { toast } from "sonner";
import { ApiError } from "@groot/shell/lib/api";
import { botsApi, type AttachmentRef } from "../lib/bots-api";
import type { ChatEvent, PendingMessage } from "./bots";
import { errorMessage } from "../lib/errors";
import { useBotsStore } from "./bots";

/** What the composer hands over for one owner message. */
export interface OwnerSubmission {
  body: string;
  attachments: AttachmentRef[];
  /** Bot ids @mentioned in the body. */
  mentions: string[];
  /** Placement while a reply runs: steer joins it, followUp waits for the next. */
  whenBusy: "steer" | "followUp";
}

/** "sent": accepted, or held to go again once online. "restored": put the draft back. */
export type OwnerSendOutcome = "sent" | "restored";

export interface OwnerSendPorts {
  send(
    botId: string,
    requestId: string,
    body: string,
    mentions: string[],
    attachmentIds: string[],
    whenBusy: "steer" | "followUp",
  ): Promise<unknown>;
  withdraw(botId: string, requestId: string): Promise<unknown>;
  abort(botId: string): Promise<unknown>;
  /** The browser's online signal, now. */
  isOnline(): boolean;
  /** Call `listener` once the browser comes back online; returns an unsubscribe. */
  whenOnline(listener: () => void): () => void;
  /** Echo show/withdraw: the chat store's `applyChatEvent`. */
  applyChatEvent(botId: string, event: ChatEvent): void;
  notifyError(message: string): void;
  newId(): string;
  now(): number;
}

export interface OwnerSend {
  /**
   * Echo the message at once and send it. Resolves when the message is
   * placed ("sent") or refused ("restored", the Echo already withdrawn and
   * the reason toasted). While offline it stays pending and goes again with
   * the same request id once the browser is back.
   */
  submit(botId: string, submission: OwnerSubmission): Promise<OwnerSendOutcome>;
  /** Stop the running reply. Rejects (after toasting) when the server refused. */
  stop(botId: string): Promise<void>;
  /** Withdraw a queued or steering message: the x on its bubble. */
  cancelQueued(botId: string, requestId: string): Promise<void>;
}

/** No answer at all (fetch rejected): the request may or may not have landed. */
function unanswered(error: unknown): boolean {
  return !(error instanceof ApiError);
}

export function createOwnerSend(ports: OwnerSendPorts): OwnerSend {
  async function attempt(
    botId: string,
    echo: PendingMessage,
    submission: OwnerSubmission,
  ): Promise<OwnerSendOutcome> {
    try {
      await ports.send(
        botId,
        echo.id,
        submission.body,
        submission.mentions,
        submission.attachments.map((a) => a.uploadId),
        submission.whenBusy,
      );
      return "sent";
    } catch (error) {
      if (unanswered(error) && !ports.isOnline()) {
        // Keep the Echo on screen; the same request id goes again once online.
        return new Promise<OwnerSendOutcome>((resolve) => {
          const stop = ports.whenOnline(() => {
            stop();
            resolve(attempt(botId, echo, submission));
          });
        });
      }
      ports.applyChatEvent(botId, { type: "pending-remove", id: echo.id });
      ports.notifyError(errorMessage(error, "Failed to send"));
      return "restored";
    }
  }

  return {
    submit(botId, submission) {
      const echo: PendingMessage = {
        id: ports.newId(),
        // Exactly the submitted body: a legacy confirmation without a request
        // id is matched by text, so any transformation would leave both.
        text: submission.body,
        createdAt: ports.now(),
        ...(submission.attachments.length > 0 ? { attachments: submission.attachments } : {}),
      };
      ports.applyChatEvent(botId, { type: "pending-add", message: echo });
      return attempt(botId, echo, submission);
    },

    async stop(botId) {
      try {
        await ports.abort(botId);
      } catch (error) {
        ports.notifyError("Failed to stop the reply");
        throw error;
      }
    },

    async cancelQueued(botId, requestId) {
      try {
        await ports.withdraw(botId, requestId);
        // The queued SSE event clears the bubble.
      } catch (error) {
        // A refusal means the message was placed or answered meanwhile; the
        // server's message says which.
        ports.notifyError(errorMessage(error, "Failed to cancel the message"));
      }
    },
  };
}

function whenBrowserOnline(listener: () => void): () => void {
  window.addEventListener("online", listener);
  return () => window.removeEventListener("online", listener);
}

/** The instance wired to the real HTTP client, browser and chat store. */
export const ownerSend: OwnerSend = createOwnerSend({
  send: (botId, requestId, body, mentions, attachmentIds, whenBusy) =>
    botsApi.send(botId, requestId, body, mentions, attachmentIds, whenBusy),
  withdraw: (botId, requestId) => botsApi.withdraw(botId, requestId),
  abort: (botId) => botsApi.abort(botId),
  isOnline: () => navigator.onLine,
  whenOnline: whenBrowserOnline,
  applyChatEvent: (botId, event) => useBotsStore.getState().applyChatEvent(botId, event),
  notifyError: (message) => toast.error(message),
  newId: () => crypto.randomUUID(),
  now: () => Date.now(),
});
