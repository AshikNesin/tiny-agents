import { apiClient } from "@groot/shell/lib/api";

export type NotificationCategory = "needs_input" | "notify" | "security" | "system";

export interface NotificationEventDef {
  event: string;
  label: string;
  description: string;
  category: NotificationCategory;
  defaultEnabled: boolean;
  locked?: boolean;
}

export interface NotificationSettings {
  events: Record<string, boolean>;
  quietHours: {
    enabled: boolean;
    start: string;
    end: string;
    timezone: string;
    urgentBypass: boolean;
  };
  device: string;
  longRunMinutes: number;
  coalesceSeconds: number;
  reminderMinutes: number;
  throttle: { perHour: number; perBotPerMinute: number };
}

export type ChannelState =
  | "not_configured"
  | "unknown"
  | "connected"
  | "invalid_credentials"
  | "over_quota";

export interface NotificationStatus {
  channel: string;
  state: ChannelState;
  requiredEnv: string[];
  devices: string[];
  quota?: { limit: number; remaining: number; reset: string };
  lastError?: { reason: string; detail?: string; at: string };
  checkedAt?: string;
}

export type TestResult =
  | { ok: true; providerId: string }
  | { ok: false; reason: string; detail?: string };

export interface NotificationLogRow {
  id: string;
  event: string;
  title: string;
  url: string | null;
  priority: number;
  status: string;
  reason: string | null;
  attempts: number;
  createdAt: string;
  sentAt: string | null;
}

export interface NotificationSettingsResponse {
  settings: NotificationSettings;
  events: NotificationEventDef[];
}

export const notificationsService = {
  status: () => apiClient.get<NotificationStatus>("/notifications/status"),
  settings: () => apiClient.get<NotificationSettingsResponse>("/notifications/settings"),
  saveSettings: (settings: NotificationSettings) =>
    apiClient.put<NotificationSettingsResponse>("/notifications/settings", settings),
  test: () => apiClient.post<TestResult>("/notifications/test"),
  validate: () => apiClient.post<NotificationStatus>("/notifications/validate"),
  log: (limit = 20) => apiClient.get<NotificationLogRow[]>("/notifications/log", { limit }),
};
