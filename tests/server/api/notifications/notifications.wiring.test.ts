/**
 * The emit points (issue #57) over the real test DB with a fake runtime and a
 * fake notifier: approvals and questions push once with the bot's name and
 * the tool (never arguments), resolving cancels and reminders follow; failed
 * or long runs push only when nobody watches the chat and the turn was not a
 * routine's; routine outcomes render their own events.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { prisma } from "@groot/core/database";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  type NotificationSettings,
} from "@groot/core/notification/notification.settings";
import type { Notification } from "@groot/core/notification/notifier";
import { registerRedactor } from "@groot/core/notification/scrub";
import type { ActivityChange, FinishedReply, WaitEvent } from "@tiny-agents/agent";
import { secretRedactor } from "../../../../packages/agent/src/redact";
import { watchBot } from "../../../../apps/web/src/server/api/bots/bots.viewers";
import {
  notifyRoutineRun,
  notifyVaultAlert,
  startNotifications,
  type NotificationsWiring,
} from "../../../../apps/web/src/server/api/notifications/notifications.wiring";

const CONVERSATION = 4242;

function fakeRuntime() {
  const wait = new Set<(event: WaitEvent) => void>();
  const activity = new Set<(change: ActivityChange) => void>();
  let replies: FinishedReply[] = [];
  return {
    onWait: (listener: (event: WaitEvent) => void) => {
      wait.add(listener);
      return () => wait.delete(listener);
    },
    onActivity: (listener: (change: ActivityChange) => void) => {
      activity.add(listener);
      return () => activity.delete(listener);
    },
    finishedReplies: async () => replies,
    setReplies: (next: FinishedReply[]) => {
      replies = next;
    },
    wait: (event: WaitEvent) => wait.forEach((listener) => listener(event)),
    activity: (busy: boolean, conversation = CONVERSATION) =>
      activity.forEach((listener) => listener({ conversation, busy, approvals: 0, questions: 0 })),
  };
}

function fakeNotifier(settings: Partial<NotificationSettings> = {}) {
  const sent: Notification[] = [];
  const cancelled: string[] = [];
  return {
    sent,
    cancelled,
    notify: vi.fn((n: Notification) => sent.push(n)),
    cancel: vi.fn((key: string) => cancelled.push(key)),
    getSettings: async () => ({ ...DEFAULT_NOTIFICATION_SETTINGS, ...settings }),
    defineEvents: vi.fn(),
  };
}

async function until(check: () => boolean, what: string) {
  const deadline = Date.now() + 5_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

const settle = () => new Promise((r) => setTimeout(r, 50));

let botId: string;
let wiring: NotificationsWiring | undefined;

beforeEach(async () => {
  await prisma.routineRun.deleteMany();
  await prisma.routine.deleteMany();
  await prisma.bot.deleteMany();
  const bot = await prisma.bot.create({
    data: { name: "Ops bot", modelId: "m1", conversationId: String(CONVERSATION) },
  });
  botId = bot.id;
});

afterEach(async () => {
  wiring?.stop();
  wiring = undefined;
  vi.useRealTimers();
  await prisma.routineRun.deleteMany();
  await prisma.routine.deleteMany();
  await prisma.bot.deleteMany();
});

describe("needs-input notifications", () => {
  it("push an approval with the bot and tool, and cancel it once answered", async () => {
    const runtime = fakeRuntime();
    const notifier = fakeNotifier();
    wiring = startNotifications(runtime, notifier);
    runtime.wait({
      kind: "approval",
      change: "added",
      conversation: CONVERSATION,
      task: 17,
      tool: "run_command",
    });
    await until(() => notifier.sent.length === 1, "approval push");
    expect(notifier.sent[0]).toMatchObject({
      event: "approval.requested",
      category: "needs_input",
      title: "✋ Ops bot needs approval",
      message: "Wants to run run_command. Open the chat to approve or deny.",
      path: `/chats/${botId}?focus=approval%3A17`,
      priority: 1,
      dedupeKey: `approval:${CONVERSATION}:17`,
      botId,
      coalesce: expect.objectContaining({ key: `needs:${CONVERSATION}` }),
    });
    const summary = notifier.sent[0].coalesce!.summarize([
      notifier.sent[0],
      { ...notifier.sent[0], event: "question.asked" },
    ]);
    expect(summary).toEqual({
      title: "✋ Ops bot needs you",
      message: "1 approval and 1 question waiting. Open the chat to answer.",
    });

    runtime.wait({ kind: "approval", change: "removed", conversation: CONVERSATION, task: 17 });
    expect(notifier.cancelled).toEqual([`approval:${CONVERSATION}:17`]);
  });

  it("push a question with a scrubbed preview", async () => {
    const unregister = registerRedactor((text) =>
      text.replaceAll("s3cr3t-vault-value", "[redacted]"),
    );
    try {
      const runtime = fakeRuntime();
      const notifier = fakeNotifier();
      wiring = startNotifications(runtime, notifier);
      runtime.wait({
        kind: "question",
        change: "added",
        conversation: CONVERSATION,
        task: 3,
        tool: "ask_owner",
        preview:
          "Should I log in to https://bank.example with s3cr3t-vault-value as the password now?",
      });
      await until(() => notifier.sent.length === 1, "question push");
      const [question] = notifier.sent;
      expect(question.event).toBe("question.asked");
      expect(question.message).not.toContain("s3cr3t");
      expect(question.message).not.toContain("bank.example");
      expect([...question.message].length).toBeLessThanOrEqual(200);
    } finally {
      unregister();
    }
  });

  it("name the vault item and host of a vault approval, expiring with it", async () => {
    const runtime = fakeRuntime();
    const notifier = fakeNotifier();
    wiring = startNotifications(runtime, notifier);
    runtime.wait({
      kind: "approval",
      change: "added",
      conversation: CONVERSATION,
      task: 21,
      tool: "browser_fill",
      subject: "GitHub login on github.com",
      expiresAt: Date.now() + 600_000,
    });
    await until(() => notifier.sent.length === 1, "vault approval push");
    expect(notifier.sent[0]).toMatchObject({
      event: "approval.requested",
      message:
        "Wants to use GitHub login on github.com (browser_fill). Open the chat to approve or deny.",
    });
    expect(notifier.sent[0].ttlSeconds).toBeGreaterThan(590);
    expect(notifier.sent[0].ttlSeconds).toBeLessThanOrEqual(600);
  });

  it("push a credential request to its vault page, with no reminder past its expiry", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
    const runtime = fakeRuntime();
    const notifier = fakeNotifier({ reminderMinutes: 15 });
    wiring = startNotifications(runtime, notifier);
    runtime.wait({
      kind: "approval",
      change: "added",
      conversation: CONVERSATION,
      task: 33,
      tool: "request_credentials",
      subject: "Sign in to Acme on acme.example",
      expiresAt: Date.now() + 600_000,
    });
    await until(() => notifier.sent.length === 1, "credential push");
    expect(notifier.sent[0]).toMatchObject({
      event: "credential.requested",
      category: "needs_input",
      title: "🔑 Ops bot: sign-in needed",
      message: "Sign in to Acme on acme.example. Open the request to fill it in.",
      path: "/vault/requests/33",
      priority: 1,
      dedupeKey: `approval:${CONVERSATION}:33`,
    });
    await settle();
    vi.advanceTimersByTime(30 * 60_000);
    await settle();
    expect(notifier.sent).toHaveLength(1);
  });

  it("scrub values the vault resolved from every push", async () => {
    secretRedactor.register("tr0ub4dor-and-3-horses");
    const runtime = fakeRuntime();
    const notifier = fakeNotifier();
    wiring = startNotifications(runtime, notifier);
    runtime.wait({
      kind: "question",
      change: "added",
      conversation: CONVERSATION,
      task: 5,
      preview: "Is tr0ub4dor-and-3-horses still the right password for the staging admin page?",
    });
    await until(() => notifier.sent.length === 1, "question push");
    expect(notifier.sent[0].message).not.toContain("tr0ub4dor");
    expect(notifier.sent[0].message).toContain("[vault]");
  });

  it("send one reminder for a request still waiting", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
    const runtime = fakeRuntime();
    const notifier = fakeNotifier({ reminderMinutes: 15 });
    wiring = startNotifications(runtime, notifier);
    const added = {
      kind: "approval" as const,
      change: "added" as const,
      conversation: CONVERSATION,
      task: 9,
      tool: "send_email",
    };
    runtime.wait(added);
    await until(() => notifier.sent.length === 1, "approval push");
    await settle();
    // A re-run after a restart re-adds the call: still one reminder.
    runtime.wait(added);
    await settle();
    vi.advanceTimersByTime(15 * 60_000);
    await until(() => notifier.sent.some((n) => n.event === "input.reminder"), "reminder");
    vi.advanceTimersByTime(60 * 60_000);
    await settle();
    expect(notifier.sent.filter((n) => n.event === "input.reminder")).toEqual([
      expect.objectContaining({
        title: "⏰ Ops bot is still waiting",
        dedupeKey: `reminder:approval:${CONVERSATION}:9`,
      }),
    ]);
  });

  it("send no reminder once answered", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
    const runtime = fakeRuntime();
    const notifier = fakeNotifier({ reminderMinutes: 15 });
    wiring = startNotifications(runtime, notifier);
    runtime.wait({ kind: "question", change: "added", conversation: CONVERSATION, task: 4 });
    await until(() => notifier.sent.length === 1, "question push");
    await settle();
    runtime.wait({ kind: "question", change: "removed", conversation: CONVERSATION, task: 4 });
    vi.advanceTimersByTime(20 * 60_000);
    await settle();
    expect(notifier.sent).toHaveLength(1);
  });
});

describe("run notifications", () => {
  it("push a failed reply while nobody watches the chat", async () => {
    const runtime = fakeRuntime();
    const notifier = fakeNotifier();
    wiring = startNotifications(runtime, notifier);
    runtime.activity(true);
    runtime.setReplies([{ text: "", createdAt: Date.now() + 1, error: "429 rate limited" }]);
    runtime.activity(false);
    await until(() => notifier.sent.length === 1, "failed push");
    expect(notifier.sent[0]).toMatchObject({
      event: "run.failed",
      title: "⚠️ Ops bot: reply failed",
      message: "429 rate limited",
      path: `/chats/${botId}`,
    });
  });

  it("stay quiet while the chat is open", async () => {
    const runtime = fakeRuntime();
    const notifier = fakeNotifier();
    wiring = startNotifications(runtime, notifier);
    const unwatch = watchBot(botId);
    try {
      runtime.activity(true);
      runtime.setReplies([{ text: "", createdAt: Date.now() + 1, error: "boom" }]);
      runtime.activity(false);
      await settle();
      expect(notifier.sent).toHaveLength(0);
    } finally {
      unwatch();
    }
  });

  it("leave routine runs (their own conversations) to the routine events", async () => {
    const runtime = fakeRuntime();
    const notifier = fakeNotifier();
    wiring = startNotifications(runtime, notifier);
    const routineConversation = CONVERSATION + 1;
    const routine = await prisma.routine.create({
      data: {
        botId,
        name: "Digest",
        prompt: "Summarize",
        schedule: "{}",
        conversationId: String(routineConversation),
      },
    });
    await prisma.routineRun.create({
      data: {
        routineId: routine.id,
        scheduledFor: new Date(),
        status: "awaiting",
        requestId: "routine:test",
      },
    });
    runtime.activity(true, routineConversation);
    runtime.setReplies([{ text: "", createdAt: Date.now() + 1, error: "boom" }]);
    runtime.activity(false, routineConversation);
    await settle();
    expect(notifier.sent).toHaveLength(0);

    // The owner's own failed reply still pushes while a routine run is working.
    runtime.activity(true);
    runtime.setReplies([{ text: "", createdAt: Date.now() + 1, error: "boom" }]);
    runtime.activity(false);
    await until(() => notifier.sent.length === 1, "run failure push");
    expect(notifier.sent[0].event).toBe("run.failed");
  });

  it("push a long reply's end with a preview, and skip short ones", async () => {
    const runtime = fakeRuntime();
    const notifier = fakeNotifier({ longRunMinutes: 5 });
    wiring = startNotifications(runtime, notifier);
    const start = Date.now();
    const now = vi.spyOn(Date, "now");
    try {
      now.mockReturnValue(start);
      runtime.activity(true);
      now.mockReturnValue(start + 60_000);
      runtime.setReplies([{ text: "Short answer.", createdAt: start + 60_000 }]);
      runtime.activity(false);
      await settle();
      expect(notifier.sent).toHaveLength(0);

      now.mockReturnValue(start + 2 * 60_000);
      runtime.activity(true);
      now.mockReturnValue(start + 9 * 60_000);
      runtime.setReplies([
        { text: "Here is the full migration plan.", createdAt: start + 9 * 60_000 },
      ]);
      runtime.activity(false);
      await until(() => notifier.sent.length === 1, "long-run push");
      expect(notifier.sent[0]).toMatchObject({
        event: "run.long_done",
        title: "✅ Ops bot finished",
        message: "Here is the full migration plan.",
        priority: -1,
      });
    } finally {
      now.mockRestore();
    }
  });
});

describe("vault alerts", () => {
  it("are locked security pushes to the vault", () => {
    const notifier = fakeNotifier();
    notifyVaultAlert(
      "revealed",
      "Vault value revealed",
      "The password of GitHub was revealed.",
      notifier,
    );
    expect(notifier.sent[0]).toMatchObject({
      event: "vault.alert",
      category: "security",
      title: "🛡️ Vault value revealed",
      path: "/vault",
      priority: 1,
    });
  });
});

describe("routine notifications", () => {
  const run = { runId: "run-1", routineName: "Morning digest", bot: { id: "b1", name: "Ops bot" } };

  it("render success quietly with a preview and a day's ttl", () => {
    const notifier = fakeNotifier();
    notifyRoutineRun(run, { status: "succeeded", output: "3 new issues, 1 PR merged." }, notifier);
    expect(notifier.sent[0]).toMatchObject({
      event: "routine.succeeded",
      title: "✅ Morning digest",
      message: "Ops bot: 3 new issues, 1 PR merged.",
      priority: -1,
      ttlSeconds: 86_400,
      dedupeKey: "routine:run-1:succeeded",
    });
  });

  it("render failures, misses and pauses with the reason", () => {
    const notifier = fakeNotifier();
    notifyRoutineRun(run, { status: "failed", error: "model error" }, notifier);
    notifyRoutineRun(run, { status: "missed" }, notifier);
    notifyRoutineRun(run, { status: "paused", error: "Submit failed: no model" }, notifier);
    expect(notifier.sent.map((n) => [n.title, n.message, n.path, n.priority])).toEqual([
      ["❌ Morning digest failed", "model error", "/routines", 0],
      ["⏭️ Morning digest missed", "The run was too late to start.", "/routines", 0],
      ["⏸️ Morning digest paused", "Submit failed: no model", "/chats/b1", 0],
    ]);
  });
});
