/**
 * Boot wiring for Code (ADR 0011): build the configured harnesses, open
 * their live connections through one hub, and start the watcher (hand-off
 * finishes back to the bots that asked, pushes for followed threads). With no harness
 * configured the hub is empty and the Code page says how to add one.
 */
import { logger } from "@groot/core/logger";
import { notificationService } from "@groot/core/notification/notification.service";
import { threadIdOf, type HarnessInstance } from "@tiny-agents/code/server";
import type { DeliveryRuntime } from "../bots/bots.delivery";
import { deliverHandoffFinish } from "./code.bots";
import { createCodeHub, setCodeHub } from "./code.hub";
import { buildHarnesses } from "./code.registry";
import { copyShelleyTables } from "./code.store";
import { onTurnEnded, rearmReconcilers } from "./code.pulls";
import { startCodeWatcher } from "./code.watcher";

export function startCode(
  runtime: DeliveryRuntime,
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
    deliver: (finish) => deliverHandoffFinish(runtime, finish),
    notify: (notification) => notificationService.notify(notification),
  });
  // Pull requests (issue #297): a pass's turn ends here; boot re-arms every chain.
  const offPulls = hub.onEvent(({ instance, event }) => {
    if (event.type !== "turn_ended") return;
    const id = threadIdOf(instance.id, event.nativeId);
    void onTurnEnded(id, event.outcome).catch((error: unknown) =>
      logger.warn({ error, threadId: id }, "Code: a pass's turn end failed"),
    );
  });
  void rearmReconcilers()
    .then((armed) => armed && logger.info(`Code: re-armed ${armed} pull request reconciler(s)`))
    .catch((error: unknown) => logger.warn({ error }, "Code: could not re-arm PR reconcilers"));
  hub.start();
  if (instances.length) {
    logger.info(`Code: ${instances.map((i) => i.label).join(", ")}`);
  }
  return () => {
    offPulls();
    stopWatcher();
    setCodeHub(undefined);
  };
}
