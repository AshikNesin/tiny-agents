import { Streamdown } from "streamdown";
import { markdownComponents } from "../../lib/markdown";
import type { ChatMessage } from "../../lib/chat-types";
import { BotAvatar } from "../BotAvatar";
import { TypingIndicator, OTHER_PILL, USER_PILL } from "../ui/transcript-parts";
import { Message } from "../ui/message";
import { CopyButton } from "./message-chrome";

export function PeerCard({
  peer,
  text,
  author,
  failed,
  error,
  streaming,
}: {
  peer: NonNullable<ChatMessage["peer"]>;
  text: string;
  author?: ChatMessage["author"];
  failed: boolean;
  error?: string;
  streaming: boolean;
}) {
  if (peer.kind === "mention") {
    const other = author !== undefined;
    return (
      <Message align={other ? "start" : "end"} className="group" data-author={author?.name}>
        <div
          className={
            other
              ? "flex max-w-[92%] md:max-w-[80%] min-w-0 flex-col items-start gap-1"
              : "flex max-w-[92%] md:max-w-[80%] min-w-0 flex-col items-end gap-1"
          }
        >
          <p
            className={
              other
                ? "text-muted-foreground px-1 text-left text-xs"
                : "text-muted-foreground px-1 text-right text-xs"
            }
          >
            {other ? author!.name : "You"} · in {peer.hostName}&apos;s chat
          </p>
          <div className="flex max-w-full min-w-0 items-center gap-2">
            {other ? (
              <>
                <div className={OTHER_PILL}>
                  <p className="whitespace-pre-wrap">{text}</p>
                </div>
                <CopyButton text={text} />
              </>
            ) : (
              <>
                <CopyButton text={text} />
                <div className={USER_PILL}>
                  <p className="whitespace-pre-wrap">{text}</p>
                </div>
              </>
            )}
          </div>
          {failed && (
            <p
              className={other ? "text-destructive text-xs" : "text-destructive text-right text-xs"}
            >
              {error}
            </p>
          )}
        </div>
      </Message>
    );
  }
  if (peer.kind === "message") {
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
