import type { ChatMessage } from "../lib/chat-types";
import type { ToolLabels } from "../lib/tool-call-text";
import { ownerText } from "../lib/attachment-notes";
import { stripPeerEnvelope } from "@tiny-agents/agent/peer-envelope";
import { assistantView } from "./chat-message/AssistantMessage";
import { PeerCard } from "./chat-message/PeerCard";
import { UserMessage } from "./chat-message/UserMessage";

export { PeerIncomingCard } from "./chat-message/PeerCard";

export interface ChatMessageViewProps {
  message: ChatMessage;
  botName: string;
  toolLabels?: ToolLabels;
  toolAskLabels?: ToolLabels;
}

export function ChatMessageView({
  message,
  botName,
  toolLabels = {},
  toolAskLabels = {},
}: ChatMessageViewProps) {
  if (message.role === "marker") {
    return (
      <div className="my-4 flex items-center gap-3" role="separator">
        <div className="grow border-t border-dashed" />
        <span className="text-muted-foreground text-xs">Earlier messages summarized</span>
        <div className="grow border-t border-dashed" />
      </div>
    );
  }

  if (message.role === "user") {
    const failed = message.status === "unanswered";
    const peer = message.peer;
    if (peer) {
      return (
        <PeerCard
          peer={peer}
          text={stripPeerEnvelope(message.text)}
          author={message.author}
          failed={failed}
          error={message.error}
          streaming={message.status === "streaming"}
        />
      );
    }
    const text = ownerText(message.text, Boolean(message.attachments?.length));
    return <UserMessage message={message} text={text} failed={failed} />;
  }

  return assistantView(message, { botName, toolLabels, toolAskLabels });
}
