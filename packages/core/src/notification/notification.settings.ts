import { z } from "zod";
import { createNamespaceKv } from "@groot/core/kv";

export const NOTIFICATION_SETTINGS_KEY = "notifications";

export const DELIVERY_CHOICES = ["auto", "webpush", "pushover", "off"] as const;
export type DeliveryChoice = (typeof DELIVERY_CHOICES)[number];

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24-hour)");

function validTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export const notificationSettingsSchema = z.object({
  events: z.record(z.string(), z.boolean()).prefault({}),
  quietHours: z
    .object({
      enabled: z.boolean().default(false),
      start: clock.default("22:00"),
      end: clock.default("07:00"),
      timezone: z.string().refine(validTimeZone, "Unknown time zone").default("Asia/Kolkata"),
      urgentBypass: z.boolean().default(false),
    })
    .prefault({}),
  deliverTo: z.enum(DELIVERY_CHOICES).default("auto"),
  device: z
    .string()
    .regex(/^[A-Za-z0-9_-]{0,25}$/, "Up to 25 letters, digits, _ or -")
    .default(""),
  longRunMinutes: z.number().int().min(1).max(240).default(5),
  coalesceSeconds: z.number().int().min(0).max(300).default(30),
  reminderMinutes: z.number().int().min(0).max(1440).default(15),
  throttle: z
    .object({
      perHour: z.number().int().min(1).max(500).default(30),
      perBotPerMinute: z.number().int().min(1).max(60).default(5),
    })
    .prefault({}),
});

export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;
export type NotificationSettingsInput = z.input<typeof notificationSettingsSchema>;

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = notificationSettingsSchema.parse(
  {},
);

export function parseNotificationSettings(value: unknown): NotificationSettings {
  const parsed = notificationSettingsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : DEFAULT_NOTIFICATION_SETTINGS;
}

export interface NotificationSettingsStore {
  load(): Promise<NotificationSettings>;
  save(settings: NotificationSettings): Promise<NotificationSettings>;
}

export function createKvSettingsStore(): NotificationSettingsStore {
  const kv = createNamespaceKv("APP_SETTING");
  return {
    async load() {
      const setting = await kv.get<{ value?: unknown }>(NOTIFICATION_SETTINGS_KEY);
      return parseNotificationSettings(setting?.value);
    },
    async save(settings) {
      await kv.set(NOTIFICATION_SETTINGS_KEY, {
        key: NOTIFICATION_SETTINGS_KEY,
        value: settings,
        metadata: {
          description: "Push notification preferences (Settings → Notifications)",
          updatedAt: new Date().toISOString(),
        },
      });
      return settings;
    },
  };
}

export function minutesInZone(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

const toMinutes = (clockText: string) => {
  const [h, m] = clockText.split(":").map(Number);
  return h * 60 + m;
};

export function quietRemainingMs(at: Date, quiet: NotificationSettings["quietHours"]): number {
  if (!quiet.enabled) return 0;
  const start = toMinutes(quiet.start);
  const end = toMinutes(quiet.end);
  if (start === end) return 0;
  const now = minutesInZone(at, quiet.timezone);
  const inside = start < end ? now >= start && now < end : now >= start || now < end;
  if (!inside) return 0;
  const minutes = (end - now + 1440) % 1440;
  return minutes * 60_000 - at.getUTCSeconds() * 1000 - at.getUTCMilliseconds();
}
