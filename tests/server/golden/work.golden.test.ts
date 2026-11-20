/**
 * Golden flows: tasks, memory, skills, people and routines, through their
 * APIs, with the tables behind them. Routine fires run on the faux model and
 * the job queue is ticked by hand. See recorder.ts.
 */
import { runTick } from "@groot/jobs/server/tick";
import { afterEach, beforeEach, describe, vi } from "vite-plus/test";
import { createTestApp } from "../helpers";
import {
  botGuests,
  botSkills,
  guests,
  memories,
  routineRuns,
  routines,
  skills,
  tasks,
} from "../../../apps/web/src/server/db";
import { startSettledPipeline } from "../../../apps/web/src/server/api/bots/bots.settled";
import { registerRoutineJobs } from "../../../apps/web/src/server/api/routines/routines.jobs";
import {
  authToken,
  closeAppRuntime,
  openAppRuntime,
  resetAppTables,
  TEST_MODEL,
  until,
} from "../fixtures";
import { FIXED_NOW } from "../../test-clock";
import { goldenFlow } from "./recorder";
import { useFreshTestDatabase } from "../fixtures/test-db";

const app = createTestApp();
let token = "";
let stopSettled = () => {};

// Each flow starts as if it ran first: a new database copy and runtime, so
// the ids it records do not depend on which flows ran before it.
beforeEach(async () => {
  await useFreshTestDatabase();
  token = await authToken("golden-work@example.com");
  const runtime = await openAppRuntime();
  stopSettled = startSettledPipeline(runtime);
  registerRoutineJobs();
  await resetAppTables();
});
afterEach(async () => {
  stopSettled();
  await closeAppRuntime();
});

const setup = { app, token: () => token };
const BOT = { description: "", systemPrompt: "Be brief.", modelId: TEST_MODEL };

async function get(path: string, as = token) {
  const response = await app.request(path, { headers: { authorization: `Bearer ${as}` } });
  // oxlint-disable-next-line typescript/no-explicit-any -- route data varies
  return ((await response.json()) as { data: any }).data;
}

describe("golden: tasks, memory, skills, people, routines", () => {
  goldenFlow("tasks", setup, async (r) => {
    await r.http("create without a title", "/api/v1/tasks", {
      method: "POST",
      json: { title: "" },
    });
    const a = await r.http("create", "/api/v1/tasks", {
      method: "POST",
      json: { title: "Renew passport", priority: "high", dueAt: "2026-11-10T09:00:00+05:30" },
    });
    const b = await r.http("create another", "/api/v1/tasks", {
      method: "POST",
      json: { title: "Plan trip" },
    });
    await r.http("list", "/api/v1/tasks");
    await r.http("complete", `/api/v1/tasks/${a.id}`, {
      method: "PATCH",
      json: { status: "done" },
    });
    await r.http("complete again", `/api/v1/tasks/${a.id}`, {
      method: "PATCH",
      json: { status: "done" },
    });
    await r.http("reopen", `/api/v1/tasks/${a.id}`, { method: "PATCH", json: { status: "todo" } });
    await r.http("edit", `/api/v1/tasks/${b.id}`, {
      method: "PATCH",
      json: { title: "Plan the trip", description: "Japan, two weeks" },
    });
    await r.http("delete", `/api/v1/tasks/${b.id}`, { method: "DELETE" });
    await r.http("delete again", `/api/v1/tasks/${b.id}`, { method: "DELETE" });
    await r.db("tasks", [tasks]);
  });

  goldenFlow("memory", setup, async (r) => {
    const bot = await r.http("create a bot", "/api/v1/bots", {
      method: "POST",
      json: { ...BOT, name: "Rememberer" },
    });
    const base = `/api/v1/bots/${bot.id}/memories`;
    const one = await r.http("add", base, {
      method: "POST",
      json: { text: "Prefers window seats", category: "preference" },
    });
    await r.http("add the same text", base, {
      method: "POST",
      json: { text: "prefers window seats", category: "preference" },
    });
    await r.http("add expiring", base, {
      method: "POST",
      json: { text: "In Tokyo this week", category: "fact", until: "2026-11-01T00:00:00.000Z" },
    });
    await r.http("list", base);
    await r.http("list with archived", `${base}?includeArchived=true`);
    await r.http("edit", `/api/v1/memories/${one.memory.id}`, {
      method: "PATCH",
      json: { text: "Prefers aisle seats" },
    });
    await r.http("delete", `/api/v1/memories/${one.memory.id}`, { method: "DELETE" });
    await r.http("restore a deleted one", `/api/v1/memories/${one.memory.id}`, {
      method: "PATCH",
      json: { restore: true },
    });
    await r.http("list after", `${base}?includeArchived=true`);
    await r.db("memories", [memories]);
  });

  goldenFlow("skills", setup, async (r) => {
    const bot = await r.http("create a bot", "/api/v1/bots", {
      method: "POST",
      json: { ...BOT, name: "Skilled" },
    });
    await r.http("preview a paste", "/api/v1/skills/preview", {
      method: "POST",
      json: {
        source: "paste",
        content: "---\nname: haiku\ndescription: Write haiku\n---\nWrite in 5-7-5.",
      },
    });
    const skill = await r.http("create", "/api/v1/skills", {
      method: "POST",
      json: {
        name: "haiku",
        description: "Write haiku",
        body: "Write in 5-7-5.",
        botIds: [bot.id],
      },
    });
    await r.http("create a duplicate", "/api/v1/skills", {
      method: "POST",
      json: { name: "haiku", description: "Again", body: "x" },
    });
    await r.http("list", "/api/v1/skills");
    await r.http("get", `/api/v1/skills/${skill.id}`);
    await r.http("edit", `/api/v1/skills/${skill.id}`, {
      method: "PATCH",
      json: { description: "Haiku, always", botIds: [] },
    });
    await r.http("bot after unassign", `/api/v1/bots/${bot.id}`);
    await r.db("skills", [skills, botSkills]);
    await r.http("delete", `/api/v1/skills/${skill.id}`, { method: "DELETE" });
    await r.http("list after", "/api/v1/skills");
  });

  goldenFlow("people-and-sharing", setup, async (r) => {
    const bot = await r.http("create a bot", "/api/v1/bots", {
      method: "POST",
      json: { ...BOT, name: "Shared" },
    });
    await r.http("me", "/api/v1/people/me");
    const guest = await r.http("add a guest", "/api/v1/people", {
      method: "POST",
      json: { name: "Priya", email: "priya-golden@example.com", password: "secret-pass" },
    });
    await r.http("add the same email", "/api/v1/people", {
      method: "POST",
      json: { name: "Priya", email: "priya-golden@example.com", password: "secret-pass" },
    });
    await r.http("list", "/api/v1/people");
    await r.http("share the bot", `/api/v1/bots/${bot.id}`, {
      method: "PATCH",
      json: { guestIds: [guest.id] },
    });
    const guestToken = await authToken("priya-golden@example.com", guest.id);
    await r.http("guest: me", "/api/v1/people/me", { token: guestToken });
    await r.http("guest: bots", "/api/v1/bots", { token: guestToken });
    await r.http("guest: the bot", `/api/v1/bots/${bot.id}`, { token: guestToken });
    await r.http("guest: tasks", "/api/v1/tasks", { token: guestToken });
    await r.http("guest: edit the bot", `/api/v1/bots/${bot.id}`, {
      method: "PATCH",
      token: guestToken,
      json: { name: "Mine" },
    });
    await r.http("guest: yolo", `/api/v1/bots/${bot.id}/yolo`, {
      method: "PUT",
      token: guestToken,
      json: { on: true },
    });
    await r.http("guest: drive the browser", `/api/v1/bots/${bot.id}/browser/driver`, {
      method: "POST",
      token: guestToken,
      json: { driver: "human" },
    });
    await r.db("sharing", [guests, botGuests]);
    await r.http("remove the guest", `/api/v1/people/${guest.id}`, { method: "DELETE" });
    await r.http("list after", "/api/v1/people");
  });

  goldenFlow("routines", setup, async (r) => {
    const bot = await r.http("create a bot", "/api/v1/bots", {
      method: "POST",
      json: { ...BOT, name: "Routiner" },
    });
    await r.http("create with a bad schedule", "/api/v1/routines", {
      method: "POST",
      json: { botId: bot.id, name: "Bad", prompt: "x", schedule: { kind: "interval", minutes: 1 } },
    });
    const every = await r.http("create an interval routine", "/api/v1/routines", {
      method: "POST",
      json: {
        botId: bot.id,
        name: "Hourly check",
        prompt: "Check the weather",
        schedule: { kind: "interval", minutes: 60 },
      },
    });
    await r.http("list", "/api/v1/routines");
    await r.http("get", `/api/v1/routines/${every.id}`);
    await r.http("pause", `/api/v1/routines/${every.id}/pause`, { method: "POST" });
    await r.http("resume", `/api/v1/routines/${every.id}/resume`, { method: "POST" });
    await r.http("edit", `/api/v1/routines/${every.id}`, {
      method: "PATCH",
      json: { schedule: { kind: "cron", expr: "0 9 * * *" }, name: "Morning check" },
    });
    await r.http("run now", `/api/v1/routines/${every.id}/run`, { method: "POST" });
    r.note("tick after run now", await runTick());
    await until(async () => {
      const runs = await get(`/api/v1/routines/${every.id}/runs`);
      return runs?.runs?.[0]?.status && runs.runs[0].status !== "awaiting";
    }, "the manual run settled");
    await r.http("runs", `/api/v1/routines/${every.id}/runs`);

    // A once routine a minute from now: the queue fires it once the clock passes it.
    const at = new Date(Date.parse(FIXED_NOW) + 60_000);
    const once = await r.http("create a once routine in a minute", "/api/v1/routines", {
      method: "POST",
      json: {
        botId: bot.id,
        name: "Soon",
        prompt: "Say good morning",
        schedule: { kind: "once", at: at.toISOString() },
      },
    });
    vi.setSystemTime(Date.parse(FIXED_NOW) + 120_000);
    try {
      r.note("tick", await runTick());
      await until(async () => {
        const runs = await get(`/api/v1/routines/${once.id}/runs`);
        return runs?.runs?.[0]?.status && runs.runs[0].status !== "awaiting";
      }, "the scheduled run settled");
    } finally {
      vi.setSystemTime(FIXED_NOW);
    }
    await r.http("scheduled runs", `/api/v1/routines/${once.id}/runs`);
    await r.http("recent runs", "/api/v1/routines/runs/recent?limit=10");
    await r.http("list after the runs", "/api/v1/routines");
    await r.db("routines", [routines, routineRuns]);
    await r.http("delete", `/api/v1/routines/${every.id}`, { method: "DELETE" });
    await r.http("get deleted", `/api/v1/routines/${every.id}`);
  });
});
