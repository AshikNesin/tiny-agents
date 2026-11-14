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
  /** Tool name → past-tense label for transcript rows ("Opened a page"). */
  toolLabels?: ToolLabels;
  /** Tool name → imperative label for approval cards ("open a page"). */
  toolAskLabels?: ToolLabels;
}

/**
 * One transcript row. User messages are right-aligned dark pills; assistant
 * replies are left-aligned light cards with markdown (PRD §6.2). Tool calls are Trace steps above the
 * reply; a call waiting for approval renders its Confirmation card, acting
 * through the `OwnerActions` in scope (none in a Past chat: no actions).
 * Compaction entries become a divider marker.
 */
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
    // Trusted attribution only (entry metadata set by the delivery pipeline):
    // a typed text that merely looks like an envelope renders as a plain
    // bubble, so no one can forge a peer card (cubic: spoofing).
    const peer = message.peer;
    if (peer) {
      return (
        <PeerCard
          peer={peer}
          text={stripPeerEnvelope(message.text)}
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
