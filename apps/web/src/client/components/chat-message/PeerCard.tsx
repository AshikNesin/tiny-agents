import { Streamdown } from "streamdown";
import { markdownComponents } from "../../lib/markdown";
import type { ChatMessage } from "../../lib/chat-types";
import { BotAvatar } from "../BotAvatar";
import { TypingIndicator, USER_PILL } from "../ui/transcript-parts";
import { Message } from "../ui/message";
import { CopyButton } from "./message-chrome";

/** One peer-traffic user message as a Grok-style attributed card. */
export function PeerCard({
  peer,
  text,
  failed,
  error,
  streaming,
}: {
  peer: NonNullable<ChatMessage["peer"]>;
  text: string;
  failed: boolean;
  error?: string;
  streaming: boolean;
}) {
  if (peer.kind === "mention") {
    // The owner tagged this bot from {host}'s chat: the owner's own words
    // in a labeled muted bubble.
    return (
      <Message align="end" className="group">
        <div className="flex max-w-[92%] md:max-w-[80%] min-w-0 flex-col items-end gap-1">
          <p className="text-muted-foreground px-1 text-right text-xs">
            You · in {peer.hostName}&apos;s chat
          </p>
          <div className="flex max-w-full min-w-0 items-center gap-2">
            <CopyButton text={text} />
            <div className={USER_PILL}>
              <p className="whitespace-pre-wrap">{text}</p>
            </div>
          </div>
          {failed && <p className="text-destructive text-right text-xs">{error}</p>}
        </div>
      </Message>
    );
  }
  if (peer.kind === "message") {
    // A bot messaged this bot via message_bot: attributed incoming card.
    return (
      <PeerIncomingCard
        name={peer.name}
        text={text}
        failed={failed}
        error={error}
        streaming={streaming}
      />
    );
  }
  // A relayed reply into the asker's chat: attributed incoming card with a
  // relayed marker.
  return (
    <PeerIncomingCard
      name={peer.name}
      text={text}
      relayed
      failed={failed}
      error={error}
      streaming={streaming}
    />
  );
}

/**
 * Incoming card for bot-to-bot traffic: peer avatar + name header (the
 * Grok handoff pattern) with the payload below; full-width like assistant
 * replies, never painted as the owner's bubble. `relayed` marks a reply
 * that the relay delivered back into the asker's chat.
 */
export function PeerIncomingCard({
  name,
  text,
  relayed = false,
  failed = false,
  error,
  streaming = false,
}: {
  name: string;
  text: string;
  relayed?: boolean;
  failed?: boolean;
  error?: string;
  streaming?: boolean;
}) {
  return (
    <Message
      className="group flex-col gap-1.5"
      data-testid="peer-card"
      data-peer={name}
      data-relayed={relayed ? "true" : undefined}
    >
      <p className="text-muted-foreground flex items-center justify-center gap-1.5 py-1 text-xs">
        <BotAvatar name={name} className="size-4" />
        <span className="text-foreground/80 font-medium">{name}</span>
        <span aria-hidden>·</span>
        <span>{relayed ? "reply relayed into this chat" : "messaged you"}</span>
      </p>
      <div className="flex min-w-0 items-center gap-2">
        <div
          data-slot="reply-card"
          className="bg-bubble chat-md min-w-0 max-w-[92%] md:max-w-[80%] rounded-3xl px-4 py-2"
        >
          <Streamdown components={markdownComponents}>{text}</Streamdown>
        </div>
        <CopyButton text={text} />
      </div>
      {streaming && <TypingIndicator label="replying" />}
      {failed && (
        <p className="text-destructive px-1 text-xs">
          {error ?? "This delivery was not answered."}
        </p>
      )}
    </Message>
  );
}
