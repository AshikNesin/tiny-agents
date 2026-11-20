export interface BotListEntry {
  id: string;
  conversationId: string;
  name: string;
  description: string;
  modelId: string | null;
  lastMessagePreview: string | null;
  lastActivityAt: Date;
  lastReadAt: Date | null;
  unread: boolean;
  replying: boolean;
  approvals: number;
  questions: number;
  pinnedAt: Date | null;
}
