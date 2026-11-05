/**
 * Boot wiring for Code (ADR 0011): build the configured harnesses, open
 * their live connections through one hub, and start the watcher (hand-off
 * finishes into bots' chats, pushes for followed threads). With no harness
 * configured the hub is empty and the Code page says how to add one.
 */
import { logger } from "@groot/core/logger";
import { notificationService } from "@groot/core/notification/notification.service";
import type { HarnessInstance } from "@tiny-agents/code/server";
import type { BotConversationRuntime } from "../bots/bots.conversation";
import { submitToBot } from "../bots/bots.conversation";
import { createCodeHub, setCodeHub } from "./code.hub";
import { buildHarnesses } from "./code.registry";
import { copyShelleyTables } from "./code.store";
import { startCodeWatcher } from "./code.watcher";

export function startCode(
  runtime: BotConversationRuntime,
  options: { extra?: HarnessInstance[] } = {},
): () => void {
  const instances = buildHarnesses({ extra: options.extra });
  const hub = setCodeHub(createCodeHub({ instances }))!;
  // Followed conversations and hand-offs from before the harness layer.
  void copyShelleyTables()
    .then((copied) => copied && logger.info(`Code: copied ${copied} Shelley row(s)`))
    .catch((error: unknown) => logger.warn({ error }, "Code: could not copy the Shelley tables"));
  const stopWatcher = startCodeWatcher({
    hub,
    deliver: async (botId, { from, ...submission }) => {
      await submitToBot(botId, { ...submission, peer: { kind: "reply", name: from } }, runtime);
    },
    notify: (notification) => notificationService.notify(notification),
  });
  hub.start();
  if (instances.length) {
    logger.info(`Code: ${instances.map((i) => i.label).join(", ")}`);
  }
  return () => {
    stopWatcher();
    setCodeHub(undefined);
  };
}
