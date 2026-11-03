/**
 * Boot wiring for Shelley (issue #143): with `SHELLEY_URL` set, open the
 * hub's single stream and start the watcher (hand-off finishes into bots'
 * chats, pushes for followed conversations). Without it, nothing starts.
 */
import { logger } from "@groot/core/logger";
import { notificationService } from "@groot/core/notification/notification.service";
import type { BotConversationRuntime } from "../bots/bots.conversation";
import { submitToBot } from "../bots/bots.conversation";
import { shelleyConfig } from "./shelley.client";
import { createShelleyHub, setShelleyHub } from "./shelley.hub";
import { startShelleyWatcher } from "./shelley.watcher";

export function startShelley(runtime: BotConversationRuntime): () => void {
  const config = shelleyConfig();
  if (!config) return () => {};
  const hub = setShelleyHub(createShelleyHub({ config }))!;
  const stopWatcher = startShelleyWatcher({
    hub,
    deliver: async (botId, submission) => {
      await submitToBot(
        botId,
        { ...submission, peer: { kind: "reply", name: "Shelley" } },
        runtime,
      );
    },
    notify: (notification) => notificationService.notify(notification),
  });
  hub.start();
  logger.info(`Shelley: following ${config.url}`);
  return () => {
    stopWatcher();
    setShelleyHub(undefined);
  };
}
