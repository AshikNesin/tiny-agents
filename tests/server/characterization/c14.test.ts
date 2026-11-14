/**
 * Characterization of behavior-register row C14: a notification reminder
 * race can push for a wait that was already answered.
 * Preserve: this pins today's behavior, quirk included; change it only with a
 * signed-off register row.
 *
 * `startNotifications` (notifications.wiring.ts) handles an `added` wait in
 * an async `onAdded` (bot lookup, push, settings read, then the reminder
 * timer), while `removed` is handled at once: it cancels the push key and
 * clears a timer only if one is already set. A wait answered while `onAdded`
 * is still awaiting gets its push after the cancel, and its reminder later.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { DEFAULT_NOTIFICATION_SETTINGS } from "@groot/core/notification/notification.settings";
import type { Notification } from "@groot/core/notification/notifier";
import {
  startNotifications,
  type Notifier,
  type NotificationsWiring,
} from "../../../apps/web/src/server/api/notifications/notifications.wiring";
import { createFakeRuntime, resetAppTables, seedBot, until } from "../fixtures";

const CONVERSATION = 9801;
const REMINDER_MINUTES = 15;

let wiring: NotificationsWiring | undefined;

beforeEach(async () => {
  await resetAppTables();
  await seedBot({ name: "Ops bot", conversationId: String(CONVERSATION) });
});

afterEach(async () => {
  wiring?.stop();
  wiring = undefined;
  vi.useRealTimers();
  await resetAppTables();
});

describe("C14: an answered wait can still push and remind", () => {
  it("pushes and reminds for a wait removed before its added handler finished", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
    const log: string[] = [];
    const sent: Notification[] = [];
    const notifier: Notifier = {
      notify: vi.fn((n: Notification) => {
        log.push(`notify:${n.event}`);
        sent.push(n);
      }),
      cancel: vi.fn((key: string) => {
        log.push(`cancel:${key}`);
      }),
      getSettings: async () => ({
        ...DEFAULT_NOTIFICATION_SETTINGS,
        reminderMinutes: REMINDER_MINUTES,
      }),
      defineEvents: vi.fn(),
    };
    const runtime = createFakeRuntime();
    wiring = startNotifications(runtime, notifier);

    // The owner answers in the same tick the wait starts.
    runtime.emitWait({
      kind: "approval",
      change: "added",
      conversation: CONVERSATION,
      task: 7,
      tool: "send_email",
    });
    runtime.emitWait({ kind: "approval", change: "removed", conversation: CONVERSATION, task: 7 });

    await until(() => sent.length === 1, "the approval push");
    // The cancel ran first; the push for the answered wait came after it.
    expect(log).toEqual([`cancel:approval:${CONVERSATION}:7`, "notify:approval.requested"]);

    // And the reminder timer was armed after the removal, so it fires too.
    await until(() => vi.getTimerCount() > 0, "the reminder timer");
    vi.advanceTimersByTime(REMINDER_MINUTES * 60_000);
    await until(() => sent.length === 2, "the reminder");
    expect(sent[1]).toMatchObject({
      event: "input.reminder",
      dedupeKey: `reminder:approval:${CONVERSATION}:7`,
    });
  });
});
