/**
 * The bot protocol (`protocol.ts`) on the worker socket: turns, tool results,
 * aborts and resumes for the Claude plan bot engine. Every socket follows
 * every bot session. A failed turn answers an `error` frame.
 */
import { assertSessionMayStart, type ClaudeAuthStatus } from "./auth";
import { parseClientMessage, type ClientMessage, type SessionEvent } from "./protocol";
import type { ModelLister } from "./sdk";
import { resumeResultOf } from "./session-log";
import { SessionLimitError, type SessionBook, type SessionOpen } from "./sessions";
import type { Audience, EventFrame, Peer, ProtocolHandler } from "./socket-handler";

const botEvent: EventFrame<SessionEvent> = (event) => ({
  type: "event",
  sessionId: event.sessionId,
  seq: event.seq,
  event: event.event,
});

export function createBotHandler(deps: {
  book: SessionBook;
  /** Every socket on the worker. */
  everyone: Audience;
  env: Record<string, string | undefined>;
  authStatus: () => Promise<ClaudeAuthStatus>;
  now: () => number;
  /** Claude Code's model list. Absent: a `models` request answers `unavailable`. */
  listModels?: ModelLister;
}): ProtocolHandler {
  const { book, everyone } = deps;

  async function turn(
    message: Extract<ClientMessage, { type: "turn" }>,
    peer: Peer,
  ): Promise<void> {
    const open: SessionOpen = {
      sessionId: message.sessionId,
      model: message.model,
      system: message.system,
      resume: message.resume,
      tools: message.tools ?? book.get(message.sessionId)?.tools ?? [],
      ...(message.maxTurns ? { maxTurns: message.maxTurns } : {}),
    };
    try {
      await assertSessionMayStart(deps.env, deps.authStatus);
      const session = book.open(open, deps.now());
      everyone.follow(session.log, botEvent);
      await book.runTurn(
        open,
        { turnId: message.turnId, text: message.text, images: message.images },
        deps.now(),
      );
    } catch (error) {
      peer.send({
        type: "error",
        code: error instanceof SessionLimitError ? error.code : "rejected",
        message: error instanceof Error ? error.message : String(error),
        sessionId: message.sessionId,
        turnId: message.turnId,
      });
    }
  }

  async function models(requestId: string, peer: Peer): Promise<void> {
    if (!deps.listModels) {
      peer.refuse(requestId, "unavailable", "This worker cannot list Claude Code's models.");
      return;
    }
    try {
      await assertSessionMayStart(deps.env, deps.authStatus);
      peer.reply(requestId, { models: await deps.listModels() });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      peer.refuse(
        requestId,
        name === "SubscriptionRequired" ? "auth" : "failed",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return {
    // The bot protocol predates the others: it answers whatever they do not claim.
    claims: () => true,
    async handle(raw, peer) {
      const message = parseClientMessage(raw);
      if (!message) {
        peer.send({
          type: "error",
          code: "bad_message",
          message: "Message does not match the protocol.",
        });
        return;
      }
      switch (message.type) {
        case "ping":
        case "pong":
          // The server answers the heartbeat before any protocol sees it.
          return;
        case "resume": {
          const log = book.get(message.sessionId)?.log;
          if (message.requestId) {
            peer.reply(message.requestId, resumeResultOf(log, message.afterSeq));
          }
          peer.replay(log, message.afterSeq, botEvent);
          return;
        }
        case "abort":
          book.get(message.sessionId)?.abortTurn();
          return;
        case "tool_waiting":
          book.get(message.sessionId)?.holdTool(message.toolUseId);
          return;
        case "tool_result":
          book.settle(message.sessionId, message.toolUseId, {
            content: message.content,
            ...(message.isError ? { isError: true } : {}),
          });
          return;
        case "turn":
          await turn(message, peer);
          return;
        case "models":
          await models(message.requestId, peer);
          return;
      }
    },
    sweep: (now) => book.sweep(now),
    close: () => undefined,
  };
}
