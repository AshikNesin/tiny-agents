import { env } from "@groot/core/env";
import { logger } from "@groot/core/logger";
import { createDbLogStore } from "@groot/core/notification/notification.log";
import {
  NotificationService,
  notificationService,
  type NotificationHub,
} from "@groot/core/notification/notification.service";
import { createKvSettingsStore } from "@groot/core/notification/notification.settings";
import { createWebPushChannel } from "@groot/core/notification/webpush";
import type { VapidKeys } from "@groot/core/notification/webpush.crypto";
import { pushSubscriptionStore, refreshActiveDevices, revokeAllDevices } from "./push.store";
import { vapidKeys } from "./push.vapid";

export function vapidSubject(): string {
  const origin = env.ORIGIN?.trim().replace(/\/+$/, "");
  return origin?.startsWith("https://") ? origin : "mailto:owner@tiny-agents.invalid";
}

export function serverVapidKeys(): Promise<VapidKeys> {
  return vapidKeys(() =>
    revokeAllDevices("The server's push key changed; open the app to register again"),
  );
}

export function attachWebPush(hub: NotificationHub = notificationService): () => void {
  const service = new NotificationService({
    channel: createWebPushChannel({
      store: pushSubscriptionStore,
      keys: () =>
        serverVapidKeys().catch((error: unknown) => {
          logger.warn({ error }, "Web Push keys unavailable");
          return undefined;
        }),
      subject: vapidSubject,
    }),
    log: createDbLogStore(),
    settings: createKvSettingsStore(),
    origin: () => env.ORIGIN,
  });
  const detach = hub.add(service);
  void refreshActiveDevices().catch((error: unknown) =>
    logger.warn({ error }, "Counting push devices failed"),
  );
  return () => {
    detach();
    service.stop();
  };
}
