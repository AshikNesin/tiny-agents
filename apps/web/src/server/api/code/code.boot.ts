import { logger } from "@groot/core/logger";
import { notificationService } from "@groot/core/notification/notification.service";
import type { HarnessInstance } from "@tiny-agents/code/server";
import { app } from "../../app-root";
import type { DeliveryRuntime } from "../bots/bots.delivery";
import { deliverHandoffFinish } from "./code.bots";
import { createCodeHub, setCodeHub } from "./code.hub";
import { buildHarnesses } from "./code.registry";
import { onTurnEnded } from "./code.pulls";
import { rearmReconcilers } from "./code.pulls.reconcile";
import { startCodeWatcher } from "./code.watcher";
import { threadKey } from "./code.threads";

export function startCode(
  runtime: DeliveryRuntime,
  options: { extra?: HarnessInstance[] } = {},
): () => void {
  const instances = buildHarnesses({ extra: options.extra ?? app().codeHarnesses });
  const hub = setCodeHub(createCodeHub({ instances }))!;
  const stopWatcher = startCodeWatcher({
    hub,
    deliver: (finish) => deliverHandoffFinish(runtime, finish),
    notify: (notification) => notificationService.notify(notification),
  });
  const offPulls = hub.onEvent(({ instance, event }) => {
    if (event.type !== "turn_ended") return;
    const id = threadKey(instance.id, event.nativeId);
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
