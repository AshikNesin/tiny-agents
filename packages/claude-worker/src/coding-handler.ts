import { CodingError, type CodingBook, type CodingSession } from "./coding";
import { runCodingOp } from "./coding-ops";
import { claudeConfigDir, withSessionPatches } from "./session-patches";
import {
  isCodingMessage,
  parseCodingClientMessage,
  type CodingClientMessage,
  type CodingEvent,
  type CodingHelloResult,
  type CodingLimits,
} from "./coding-protocol";
import { resumeResultOf } from "./session-log";
import type { Audience, EventFrame, Peer, ProtocolHandler } from "./socket-handler";

const codingEvent: EventFrame<CodingEvent> = (event) => ({
  type: "coding.event",
  sessionId: event.sessionId,
  seq: event.seq,
  event: event.event,
});

export function createCodingHandler(deps: {
  book: CodingBook | undefined;
  audience: Audience;
  bootId: string;
  limits: CodingLimits;
  uploadsDir?: string;
  home?: string;
}): ProtocolHandler {
  const { book, audience } = deps;
  if (book) {
    book.onCatalog = (catalog) => audience.broadcast({ type: "coding.catalog", catalog });
    book.onPartial = (sessionId, partial) =>
      audience.broadcast({ type: "coding.partial", sessionId, ...partial });
  }
  const follow = (session: CodingSession): CodingSession => {
    audience.follow(session.log, codingEvent);
    return session;
  };

  async function request(
    sessions: CodingBook,
    message: CodingClientMessage,
    peer: Peer,
  ): Promise<unknown> {
    const existing = (id: string): CodingSession => {
      const session = sessions.get(id);
      if (!session) throw new CodingError("not_found", "That Claude Code session is not running.");
      return session;
    };
    switch (message.type) {
      case "coding.hello":
        audience.add(peer);
        if (sessions.catalog) peer.send({ type: "coding.catalog", catalog: sessions.catalog });
        return {
          bootId: deps.bootId,
          sessions: sessions.list().map((session) => ({
            sessionId: session.id,
            running: session.running,
            live: session.live,
            lastSeq: session.log.lastSeq,
          })),
        } satisfies CodingHelloResult;
      case "coding.send":
        return follow(sessions.ensure(message.sessionId, message.session)).send({
          uuid: message.uuid,
          text: message.text,
          mode: message.mode,
          attachments: message.attachments,
        });
      case "coding.interrupt":
        return sessions.get(message.sessionId)?.interrupt() ?? { stopped: false };
      case "coding.tool_result":
        return {
          settled: existing(message.sessionId).settleCall(message.callId, {
            content: message.content,
            ...(message.isError ? { isError: true } : {}),
          }),
        };
      case "coding.respond":
        existing(message.sessionId).respond(message.approvalId, message.answer);
        return undefined;
      case "coding.settings":
        return follow(sessions.ensure(message.sessionId, message.session)).settings(message.change);
      case "coding.queue":
        await existing(message.sessionId).manageQueue(message.action, message.queuedId);
        return undefined;
      case "coding.history":
        return {
          messages: await withSessionPatches(
            await sessions.deps.sdk.getSessionMessages(message.claudeSessionId, {
              dir: message.cwd,
              includeSystemMessages: true,
            }),
            claudeConfigDir(sessions.deps.env),
            message.claudeSessionId,
          ),
        };
      case "coding.fork":
        return sessions.deps.sdk.forkSession(message.claudeSessionId, {
          dir: message.cwd,
          ...(message.upToMessageId ? { upToMessageId: message.upToMessageId } : {}),
          ...(message.title ? { title: message.title } : {}),
        });
      case "coding.commands":
        return sessions.catalog ?? { commands: [], models: [] };
      case "coding.op":
        return runCodingOp(message.op, {
          limits: deps.limits,
          uploadsDir: deps.uploadsDir,
          home: deps.home,
        });
      case "coding.resume": {
        const session = sessions.get(message.sessionId);
        if (session) follow(session);
        return resumeResultOf(session?.log, message.afterSeq);
      }
      case "coding.close":
        sessions.get(message.sessionId)?.close();
        return undefined;
    }
  }

  return {
    claims: isCodingMessage,
    async handle(raw, peer) {
      const message = parseCodingClientMessage(raw);
      const rawId = (raw as { requestId?: unknown }).requestId;
      const requestId = typeof rawId === "string" ? rawId : "";
      if (!message) {
        peer.refuse(requestId, "bad_message", "Message does not match the coding protocol.");
        return;
      }
      try {
        if (!book) {
          throw new CodingError("unavailable", "This worker was started without coding mode.");
        }
        peer.reply(requestId, await request(book, message, peer));
        if (message.type === "coding.resume") {
          peer.replay(book.get(message.sessionId)?.log, message.afterSeq, codingEvent);
        }
      } catch (error) {
        peer.refuse(
          requestId,
          codingErrorCode(error),
          error instanceof Error ? error.message : String(error),
        );
      }
    },
    sweep: (now) => book?.sweep(now),
    close: () => book?.closeAll(),
  };
}

function codingErrorCode(error: unknown): string {
  if (error instanceof CodingError) return error.code;
  const name = error instanceof Error ? error.name : "";
  if (name === "SubscriptionRequired") return "auth";
  if (name === "OverrideRefusal") return "override";
  return "failed";
}
