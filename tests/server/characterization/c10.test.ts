import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { notificationService } from "@groot/core/notification/notification.service";
import { db, routineRuns, routines } from "../../../apps/web/src/server/db";
import {
  recordAwaiting,
  recordSubmitFailed,
  runRequestId,
} from "../../../apps/web/src/server/api/routines/routines.runs";
import * as routinesService from "../../../apps/web/src/server/api/routines/routines.service";
import {
  onBotChatEvent,
  type BotChatEvent,
} from "../../../apps/web/src/server/api/bots/bots.events";
import { installFakeRuntime, resetAppTables, seedBot, until } from "../fixtures";

async function seedRoutine(botId: string, conversationId?: string) {
  const [routine] = await db
    .insert(routines)
    .values({
      botId,
      name: "digest",
      prompt: "Do the thing.",
      schedule: { kind: "cron", expr: "0 9 * * 1-5" },
      enabled: false,
      ...(conversationId ? { conversationId } : {}),
    })
    .returning();
  return routine!;
}

const runRow = (id: string) => db.query.routineRuns.findFirst({ where: eq(routineRuns.id, id) });

let stops: Array<() => void> = [];

beforeEach(async () => {
  installFakeRuntime();
  await resetAppTables();
});

afterEach(async () => {
  for (const stop of stops) stop();
  stops = [];
  vi.restoreAllMocks();
  await resetAppTables();
});

describe("C10: routine run writes outside the machine's guarded moves", () => {
  it("moves a failed run back to awaiting when the same slot is recorded awaiting", async () => {
    const notify = vi.spyOn(notificationService, "notify").mockImplementation(() => undefined);
    const bot = await seedBot({ name: "Bot", conversationId: "9701" });
    const events: BotChatEvent[] = [];
    stops.push(onBotChatEvent(bot.id, (event) => events.push(event)));
    const routine = await seedRoutine(bot.id);
    const ref = { id: routine.id, name: routine.name, bot: { id: bot.id, name: bot.name } };
    const slot = new Date(Date.now() - 60_000);
    const failedAt = new Date(Date.now() - 30_000);

    const failedId = await recordSubmitFailed(
      ref,
      slot,
      "schedule",
      failedAt,
      new Error("model gone"),
    );
    expect(await runRow(failedId)).toMatchObject({ status: "failed" });
    expect(notify).toHaveBeenCalledTimes(1);
    await until(() => events.some((event) => event.type === "routine-run"), "the failed card");

    const awaitingId = await recordAwaiting(ref, slot, "schedule", new Date());
    expect(awaitingId).toBe(failedId);
    const row = await runRow(awaitingId);
    expect(row).toMatchObject({
      status: "awaiting",
      error: null,
      requestId: runRequestId(routine.id, slot),
    });
    expect(row?.finishedAt?.getTime()).toBe(failedAt.getTime());
    expect(await db.$count(routineRuns)).toBe(1);
  });

  it("cancels awaiting runs on a move to another bot without a push or a chat event", async () => {
    const notify = vi.spyOn(notificationService, "notify").mockImplementation(() => undefined);
    const from = await seedBot({ name: "From", conversationId: "9702" });
    const to = await seedBot({ name: "To", conversationId: "9703" });
    const routine = await seedRoutine(from.id, "9704");
    const [run] = await db
      .insert(routineRuns)
      .values({
        routineId: routine.id,
        scheduledFor: new Date(Date.now() - 60_000),
        status: "awaiting",
        trigger: "schedule",
        requestId: "c10-run",
        submittedAt: new Date(),
      })
      .returning();
    const events: Array<[string, BotChatEvent]> = [];
    for (const botId of [from.id, to.id]) {
      stops.push(onBotChatEvent(botId, (event) => events.push([botId, event])));
    }

    await routinesService.update(routine.id, { botId: to.id });

    expect(await runRow(run!.id)).toMatchObject({
      status: "cancelled",
      error: "Moved to another bot",
      finishedAt: expect.any(Date),
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(notify).not.toHaveBeenCalled();
    expect(events.filter(([, event]) => event.type === "routine-run")).toEqual([]);
  });
});
