import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import * as service from "../../../../apps/web/src/server/api/tasks/task.service";
import { taskStore } from "../../../../apps/web/src/server/api/tasks/task.store";
import { resetAppTables } from "../../fixtures";

describe("tasks module", () => {
  beforeEach(resetAppTables);
  afterEach(resetAppTables);

  it("creates once per source key: a replayed tool call returns the same task", async () => {
    const first = await taskStore.create({ title: "Ship it", idempotencyKey: "tool-call-1" });
    const again = await taskStore.create({ title: "Ship it", idempotencyKey: "tool-call-1" });
    expect(again.id).toBe(first.id);
    expect(await service.listTasks()).toHaveLength(1);
    expect((await service.findTask(first.id))?.title).toBe("Ship it");
  });

  it("gives done its completion time and reopening clears it, whichever side writes", async () => {
    const task = await service.create({
      title: "Review",
      description: "",
      status: "todo",
      priority: "medium",
    });
    const done = await taskStore.update(task.id, { status: "done" });
    expect(done?.completedAt).toEqual(expect.any(String));
    vi.setSystemTime(Date.now() + 60_000);
    const again = await taskStore.update(task.id, { status: "done" });
    expect(again?.completedAt).toBe(done?.completedAt);
    const reopened = await service.update(task.id, { status: "todo" });
    expect(reopened.completedAt).toBeNull();
    const created = await service.create({
      title: "Already",
      description: "",
      status: "done",
      priority: "low",
    });
    expect(created.completedAt).toBeInstanceOf(Date);
  });

  it("says when a task is gone: undefined to the tool, 404 to the page", async () => {
    expect(await taskStore.update("missing", { title: "x" })).toBeUndefined();
    expect(await taskStore.remove("missing")).toBe(false);
    await expect(service.update("missing", { title: "x" })).rejects.toMatchObject({
      output: { statusCode: 404 },
    });
    await expect(service.remove("missing")).rejects.toMatchObject({
      output: { statusCode: 404 },
    });
  });

  it("filters the tool's list by status and maps dates to ISO strings", async () => {
    await taskStore.create({ title: "A", dueAt: "2026-11-02T09:00:00.000Z", idempotencyKey: "a" });
    const b = await taskStore.create({ title: "B", idempotencyKey: "b" });
    await taskStore.update(b.id, { status: "done" });
    const todo = await taskStore.list({ status: "todo" });
    expect(todo.map((t) => [t.title, t.dueAt])).toEqual([["A", "2026-11-02T09:00:00.000Z"]]);
    expect(await taskStore.list()).toHaveLength(2);
  });
});
