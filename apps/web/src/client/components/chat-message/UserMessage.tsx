import type { ChatMessage } from "../../lib/chat-types";
import { MessageAttachments } from "../Attachments";
import { OTHER_PILL, USER_PILL } from "../ui/transcript-parts";
import { Message } from "../ui/message";
import { useAuthStore } from "@groot/shell/store/auth";
import { LastTurnButtons } from "./last-turn";
import { MessageEnter, MessageMeta, isFresh } from "./message-chrome";
import { Wrench } from "lucide-react";
import { splitToolPicks } from "../../../shared/tool-picks";
import { sentToolName } from "../../lib/slash-menu";

export function UserMessage({
  message,
  text: sent,
  failed,
}: {
  message: ChatMessage;
  text: string;
  failed: boolean;
}) {
  const me = useAuthStore((s) => s.user?.id);
  const { tools, text } = splitToolPicks(sent);
  const other = message.author !== undefined && message.author.id !== me;
  const align = other ? "start" : "end";
  return (
    <Message align={align} className="group" data-author={message.author?.name}>
      <MessageEnter
        fresh={isFresh(message)}
        align={align}
        className={`flex max-w-[92%] md:max-w-[80%] min-w-0 flex-col gap-1 ${other ? "items-start" : "items-end"}`}
      >
        {other && (
          <p className="text-muted-foreground flex items-center gap-1.5 px-1 text-xs">
            <span className="bg-muted text-foreground/80 flex size-4 items-center justify-center rounded-full text-[10px] font-semibold">
              {message.author!.name[0]?.toUpperCase()}
            </span>
            <span className="text-foreground/80 font-medium">{message.author!.name}</span>
          </p>
        )}
        {message.attachments && message.attachments.length > 0 && (
          <MessageAttachments attachments={message.attachments} />
        )}
        {tools.length > 0 && (
          <ul
            aria-label="Tools asked for"
            className={`flex flex-wrap gap-1 px-1 ${other ? "justify-start" : "justify-end"}`}
          >
            {tools.map((name) => (
              <li
                key={name}
                className="bg-muted text-muted-foreground flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
              >
                <Wrench className="size-3" />
                {sentToolName(name)}
              </li>
            ))}
          </ul>
        )}
        {text && (
          <div className={other ? OTHER_PILL : USER_PILL}>
            <p className="whitespace-pre-wrap">{text}</p>
          </div>
        )}
        {failed && (
          <p className={`text-destructive text-xs ${other ? "" : "text-right"}`}>{message.error}</p>
        )}
        {text && (
          <MessageMeta
            text={text}
            at={message.createdAt || undefined}
            align={align}
            actions={<LastTurnButtons messageId={message.id} />}
          />
        )}
      </MessageEnter>
    </Message>
  );
}
