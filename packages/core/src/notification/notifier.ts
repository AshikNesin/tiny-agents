export type NotificationPriority = -2 | -1 | 0 | 1;

export type NotificationCategory = "needs_input" | "notify" | "security" | "system";

export interface Notification {
  event: string;
  category: NotificationCategory;
  title: string;
  message: string;
  path?: string;
  urlTitle?: string;
  priority: NotificationPriority;
  ttlSeconds?: number;
  dedupeKey: string;
  dedupeSeconds?: number;
  botId?: string;
  coalesce?: {
    key: string;
    summarize: (batch: readonly Notification[]) => { title: string; message: string };
  };
  tag?: string;
  actions?: NotificationActions;
}

export interface NotificationActions {
  kind: "tool" | "vault";
  botId: string;
  taskId: number;
  tool: string;
  grantable?: boolean;
}

export interface OutgoingMessage {
  title: string;
  message: string;
  url?: string;
  urlTitle?: string;
  priority: NotificationPriority;
  ttlSeconds?: number;
  device?: string;
  id?: string;
  tag?: string;
  event?: string;
  category?: NotificationCategory;
  path?: string;
  actions?: NotificationActions;
}

export type SendFailureReason =
  | "invalid_credentials"
  | "over_quota"
  | "invalid_input"
  | "transient";

export type SendResult =
  | { ok: true; providerId: string; quota?: ChannelQuota }
  | {
      ok: false;
      retryable: boolean;
      reason: SendFailureReason;
      detail?: string;
      resetAt?: Date;
    };

export interface ChannelQuota {
  limit: number;
  remaining: number;
  reset: Date;
}

export type ValidateResult =
  | { ok: true; devices: string[] }
  | { ok: false; reason: "invalid_credentials" | "transient"; detail?: string };

export interface NotificationChannel {
  readonly id: string;
  configured(): boolean;
  validate(device?: string): Promise<ValidateResult>;
  quota(): Promise<ChannelQuota | undefined>;
  send(message: OutgoingMessage): Promise<SendResult>;
  dismiss?(tag: string): Promise<void>;
}

export interface NotificationEventDef {
  event: string;
  label: string;
  description: string;
  category: NotificationCategory;
  defaultEnabled: boolean;
  locked?: boolean;
}
