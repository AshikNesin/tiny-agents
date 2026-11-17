/**
 * The notification port: what the notification service hands a channel
 * (Pushover and Web Push today; ntfy or Telegram later) and what it gets back.
 * Call sites never talk to a channel — they call `notificationService.notify`.
 */

/**
 * Pushover priorities (https://pushover.net/api#priority): -2 no alert, -1
 * quiet popup, 0 default, 1 bypasses the device's quiet hours. Emergency (2)
 * needs receipt handling and is not used yet.
 */
export type NotificationPriority = -2 | -1 | 0 | 1;

/**
 * - `needs_input`: something waits on the owner (approval, question).
 * - `notify`: unattended work ended (routine result, failed run).
 * - `security`: alerts that cannot be turned off.
 * - `system`: the app itself (startup ping, test, quota warnings).
 */
export type NotificationCategory = "needs_input" | "notify" | "security" | "system";

/** A notification as the app renders it, before quiet hours, dedupe and throttling. */
export interface Notification {
  /** Event key, e.g. "approval.requested" (see `NotificationEventDef`). */
  event: string;
  category: NotificationCategory;
  /** Plain text; clamped to 80 chars. */
  title: string;
  /** Plain text; clamped to 300 chars. */
  message: string;
  /** App path the notification opens, e.g. "/chats/abc". Prefixed with ORIGIN. */
  path?: string;
  /** Link label, e.g. "Open approval". */
  urlTitle?: string;
  priority: NotificationPriority;
  /** Seconds after which the device drops the notification. */
  ttlSeconds?: number;
  /** One send per key within `dedupeSeconds` (also across restarts). */
  dedupeKey: string;
  /** Default 24 hours. */
  dedupeSeconds?: number;
  /** The bot it is about: per-bot throttling and the log. */
  botId?: string;
  /**
   * Notifications sharing `key` within the coalescing window send as one:
   * `summarize` renders the batch (two or more). Pending ones can be
   * cancelled by dedupe key before the window ends.
   */
  coalesce?: {
    key: string;
    summarize: (batch: readonly Notification[]) => { title: string; message: string };
  };
  /**
   * What replaces or takes back this notification on a device (Web Push).
   * Default: `dedupeKey`. A reminder shares its request's tag, so it replaces
   * the first push and an answer takes back either.
   */
  tag?: string;
  /** Buttons a channel that can show them offers (approvals); others ignore it. */
  actions?: NotificationActions;
}

/**
 * Answer an approval from the notification itself, through the same route
 * the chat card uses. `tool` cards offer "Always allow" (that tool, for this
 * bot); `vault` cards offer "For this chat" only when `grantable`.
 */
export interface NotificationActions {
  kind: "tool" | "vault";
  botId: string;
  taskId: number;
  /** The waiting call's tool ("Always allow" switches this one on). */
  tool: string;
  /** Vault cards: the use can be granted for the rest of the chat. */
  grantable?: boolean;
}

/** What a channel sends: the rendered, clamped message. */
export interface OutgoingMessage {
  title: string;
  message: string;
  url?: string;
  urlTitle?: string;
  priority: NotificationPriority;
  ttlSeconds?: number;
  /** Deliver to this device only. */
  device?: string;
  /**
   * What a channel that renders the notification itself (Web Push) needs:
   * the log row, a tag that replaces or dismisses it, the event and category,
   * the app path, and its buttons. Pushover ignores these.
   */
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
      /** Only transient failures are retried. */
      retryable: boolean;
      reason: SendFailureReason;
      /** Provider error text (never credentials). */
      detail?: string;
      /** Over quota: when the quota resets. */
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
  /** Credentials are present; nothing is sent otherwise. */
  configured(): boolean;
  /** Check the credentials (and optional device) with the provider. */
  validate(device?: string): Promise<ValidateResult>;
  /** The monthly message quota, when the provider reports one. */
  quota(): Promise<ChannelQuota | undefined>;
  send(message: OutgoingMessage): Promise<SendResult>;
  /**
   * Take back a notification already sent with this `tag` (its approval or
   * question was answered). Channels that can't simply leave it out.
   */
  dismiss?(tag: string): Promise<void>;
}

/** An event the owner can turn on or off in Settings. */
export interface NotificationEventDef {
  event: string;
  label: string;
  description: string;
  category: NotificationCategory;
  defaultEnabled: boolean;
  /** Cannot be turned off (security alerts). */
  locked?: boolean;
}
