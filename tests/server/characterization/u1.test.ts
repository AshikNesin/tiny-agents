import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { Capability } from "../../../packages/agent/src/capabilities";
import { appStoreCapabilities } from "../../../apps/web/src/server/api/bots/bots.runtime";
import { appEnv } from "../../../apps/web/src/server/env";
import * as routinesService from "../../../apps/web/src/server/api/routines/routines.service";
import { createRoutineStore } from "../../../apps/web/src/server/api/routines/routines.toolkit-store";
import { FIXED_NOW } from "../../test-clock";
import { resetAppTables, seedBot } from "../fixtures";

afterEach(resetAppTables);

const render = (today: Capability) =>
  today.extension.sections![0]!.render({ conversationId: 1 } as never, BACKGROUND_CONTEXT);

describe("U1: an owner whose server runs with TZ=America/Los_Angeles", () => {
  it("dates the prompt in Los Angeles, but schedules and shows routines in IST", async () => {
    expect(FIXED_NOW).toBe("2026-11-06T06:30:00.000Z");
    const capabilities = appStoreCapabilities(appEnv({ TZ: "America/Los_Angeles" }));
    expect(await render(capabilities.today)).toBe(
      "Today is Thursday, 5 November 2026 (America/Los_Angeles).",
    );

    const bot = await seedBot({ name: "Morning" });
    const routine = await routinesService.create({
      botId: bot.id,
      name: "Daily brief",
      prompt: "Brief me.",
      schedule: { kind: "cron", expr: "0 9 * * *" },
      enabled: true,
    });
    expect(routine.nextRunAt).toEqual(new Date("2026-11-07T03:30:00.000Z"));

    const [record] = await createRoutineStore().list(1);
    expect(record!.nextRunAt).toBe("2026-11-07T03:30:00.000Z");
    expect(record!.nextFireTimes).toEqual([
      "Sat, 07 Nov 2026, 09:00 IST",
      "Sun, 08 Nov 2026, 09:00 IST",
      "Mon, 09 Nov 2026, 09:00 IST",
    ]);
  });
});
