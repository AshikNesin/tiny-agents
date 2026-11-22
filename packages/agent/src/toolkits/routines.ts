import type { ToolExecutionResult } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { isUnattendedConversation } from "../approvals";
import type { Capability } from "../capabilities";
import { defineToolkit, tool } from "../toolkit";
import { toolIdempotencyKey } from "./tasks";

export const REPORT_ROUTINE_BLOCKED = "report_routine_blocked";
const MAX_BLOCKED_REASON = 300;
const MAX_ROUTINE_PROGRESS = 1_500;

export type RoutineSchedule =
  | { kind: "once"; at: string }
  | { kind: "cron"; expr: string }
  | { kind: "interval"; minutes: number }
  | { kind: "webhook" };

export interface RoutineRecord {
  id: string;
  name: string;
  prompt: string;
  schedule: RoutineSchedule;
  enabled: boolean;
  sentence: string;
  nextFireTimes: string[];
  nextRunAt: string | null;
}

export interface RoutineUpdateInput {
  name?: string;
  prompt?: string;
  schedule?: RoutineSchedule;
  enabled?: boolean;
}

interface RoutineCreateInput {
  idempotencyKey: string;
  name: string;
  prompt: string;
  schedule: RoutineSchedule;
}

export interface RoutineStore {
  create(conversationId: number, input: RoutineCreateInput): Promise<RoutineRecord>;
  list(conversationId: number): Promise<RoutineRecord[]>;
  update(
    conversationId: number,
    id: string,
    input: RoutineUpdateInput,
  ): Promise<RoutineRecord | undefined>;
  remove(conversationId: number, id: string): Promise<boolean>;
  runNow(conversationId: number, id: string): Promise<{ runId: string }>;
  saveProgress(conversationId: number, text: string): Promise<boolean>;
}

const nameSchema = Type.String({ minLength: 1, maxLength: 80 });
const promptSchema = Type.String({ minLength: 1, maxLength: 20_000 });
const idSchema = Type.String({ minLength: 1 });

type ScheduleInput = RoutineSchedule | { kind: "in"; minutes: number };

const scheduleSchema = Type.Unsafe<ScheduleInput>(
  Type.Union([
    Type.Object({
      kind: Type.Literal("in"),
      minutes: Type.Integer({
        minimum: 1,
        maximum: 10_080,
        description: "Once, this many minutes from now",
      }),
    }),
    Type.Object({
      kind: Type.Literal("once"),
      at: Type.String({
        format: "date-time",
        description: "Once, ISO datetime with offset, e.g. 2026-11-01T09:00:00+05:30",
      }),
    }),
    Type.Object({
      kind: Type.Literal("cron"),
      expr: Type.String({
        description: '5-field cron in IST, e.g. "0 9 * * 1-5" (weekdays 09:00)',
      }),
    }),
    Type.Object({
      kind: Type.Literal("interval"),
      minutes: Type.Integer({ minimum: 15, maximum: 1440, description: "Every N minutes" }),
    }),
  ]),
);

function resolveSchedule(schedule: ScheduleInput, now: () => Date): RoutineSchedule {
  if (schedule.kind !== "in") return schedule;
  return { kind: "once", at: new Date(now().getTime() + schedule.minutes * 60_000).toISOString() };
}

const ok = (text: string): ToolExecutionResult => ({
  output: [{ type: "text", text }],
});
const fail = (text: string): ToolExecutionResult => ({
  output: [{ type: "text", text }],
  isError: true,
});

async function attempt(work: () => Promise<ToolExecutionResult>): Promise<ToolExecutionResult> {
  try {
    return await work();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return fail(reason);
  }
}

function confirmationCard(routine: RoutineRecord): string {
  const fires =
    routine.nextFireTimes.length > 0
      ? routine.nextFireTimes.map((time) => `- ${time}`).join("\n")
      : "- none yet";
  return [
    `${routine.id} "${routine.name}"`,
    `Schedule: ${routine.sentence}${routine.enabled ? "" : " (paused)"}`,
    "Next runs (IST):",
    fires,
    `Prompt: ${routine.prompt.length > 200 ? `${routine.prompt.slice(0, 200)}...` : routine.prompt}`,
  ].join("\n");
}

function present(routine: RoutineRecord): string {
  const next = routine.nextFireTimes[0] ?? routine.nextRunAt ?? "no next run (paused)";
  return `[${routine.id}] ${routine.name}${routine.enabled ? "" : " (paused)"}: ${routine.sentence}, next ${next}`;
}

const notFound = (id: string) => fail(`No routine with id "${id}".`);

export function createRoutinesToolkit(
  store: RoutineStore,
  options: { now?: () => Date } = {},
): Capability {
  const now = options.now ?? (() => new Date());
  const createRoutine = tool({
    name: "create_routine",
    label: "Created routine",
    askLabel: "create a routine",
    summary: "Create a routine",
    description:
      "Create a routine: this bot runs the prompt on a schedule (reminders, recurring work) and replies here. " +
      "Show the owner the returned card to confirm the schedule.",
    parameters: Type.Object({
      name: nameSchema,
      prompt: promptSchema,
      schedule: scheduleSchema,
    }),
    replay: "safe",
    execute: async (args, api, context) =>
      attempt(async () => {
        const idempotencyKey = await toolIdempotencyKey(api, context);
        const routine = await store.create(Number(api.conversationId), {
          idempotencyKey,
          ...args,
          schedule: resolveSchedule(args.schedule, now),
        });
        return ok(`Created routine ${confirmationCard(routine)}`);
      }),
  });

  const listRoutines = tool({
    name: "list_routines",
    label: "Listed routines",
    askLabel: "list routines",
    summary: "List routines",
    policy: { readOnly: true },
    description: "List the owner's routines with their schedules and next runs.",
    parameters: Type.Object({}),
    replay: "safe",
    execute: async (_args, api) =>
      attempt(async () => {
        const routines = await store.list(Number(api.conversationId));
        return ok(routines.length === 0 ? "No routines." : routines.map(present).join("\n"));
      }),
  });

  const updateRoutine = tool({
    name: "update_routine",
    label: "Updated routine",
    askLabel: "update a routine",
    summary: "Update a routine",
    description:
      "Update a routine by id; omit fields that stay. enabled false pauses, true resumes.",
    parameters: Type.Object({
      id: idSchema,
      name: Type.Optional(nameSchema),
      prompt: Type.Optional(promptSchema),
      schedule: Type.Optional(scheduleSchema),
      enabled: Type.Optional(Type.Boolean()),
    }),
    replay: "safe",
    execute: async (args, api) =>
      attempt(async () => {
        const { id, schedule, ...rest } = args;
        const input = schedule ? { ...rest, schedule: resolveSchedule(schedule, now) } : rest;
        const routine = await store.update(Number(api.conversationId), id, input);
        return routine ? ok(`Updated routine ${confirmationCard(routine)}`) : notFound(id);
      }),
  });

  const report = (id: string, removed: boolean) =>
    removed ? ok(`Deleted routine ${id}.`) : notFound(id);
  const deleteRoutine = tool({
    name: "delete_routine",
    label: "Deleted routine",
    askLabel: "delete a routine",
    summary: "Delete a routine",
    description: "Permanently delete a routine (and its run history) by id.",
    parameters: Type.Object({ id: idSchema }),
    replay: "safe",
    execute: async (args, api, context) =>
      attempt(async () => {
        const outcome = await api.memo<boolean>("delete_routine:removed", context);
        if (outcome !== undefined) return report(args.id, outcome);
        const resumed = (await api.memo<boolean>("delete_routine:started", context)) === true;
        await api.memo("delete_routine:started", true, context);
        const removed = (await store.remove(Number(api.conversationId), args.id)) || resumed;
        return report(args.id, await api.memo("delete_routine:removed", removed, context));
      }),
  });

  const runRoutineNow = tool({
    name: "run_routine_now",
    label: "Ran routine now",
    askLabel: "run a routine now",
    summary: "Run a routine now",
    description: "Run a routine once now, e.g. to test it.",
    parameters: Type.Object({ id: idSchema }),
    replay: "safe",
    execute: async (args, api) =>
      attempt(async () => {
        const { runId } = await store.runNow(Number(api.conversationId), args.id);
        return ok(
          `Routine ${args.id} is running now (run ${runId}); its reply lands in this chat.`,
        );
      }),
  });

  const reportBlocked = tool({
    name: REPORT_ROUTINE_BLOCKED,
    label: "Reported the routine blocked",
    askLabel: "report this routine run blocked",
    summary: "Flag a routine run that can't do its job",
    policy: { readOnly: true, unattendedOnly: true },
    description:
      "Only in a scheduled routine run: report that this run cannot do its job until the owner " +
      "fixes something (a missing vault login, an approval routines can't get, an account it " +
      "can't reach). Give the reason as what the owner must do, e.g. \"Needs a vault login for " +
      'the Gmail account". The run shows as needing attention, and the routine pauses after ' +
      "3 blocked runs in a row. Don't use it when there was simply nothing to do.",
    parameters: Type.Object({
      reason: Type.String({ minLength: 1, maxLength: MAX_BLOCKED_REASON }),
    }),
    replay: "safe",
    execute: async (_args, api, context) => {
      if (!(await isUnattendedConversation(api, context))) {
        return fail("Only a scheduled routine run can report itself blocked.");
      }
      return ok(
        "Recorded: this run needs the owner's attention. Finish with a short reply saying what is needed.",
      );
    },
  });

  const saveProgress = tool({
    name: "save_routine_progress",
    label: "Saved routine progress",
    askLabel: "save this routine's progress note",
    summary: "Keep notes for this routine's next run",
    policy: { allowByDefault: true, unattendedOnly: true },
    description:
      "Only in a routine run: replace this routine's progress note, which the next run reads " +
      "instead of earlier results. Keep what the next run needs and can't look up again: what is " +
      "done, what is left, values to compare against. Send the whole note; empty clears it.",
    parameters: Type.Object({
      note: Type.String({ maxLength: MAX_ROUTINE_PROGRESS }),
    }),
    replay: "safe",
    execute: async (args, api) =>
      attempt(async () =>
        (await store.saveProgress(Number(api.conversationId), args.note))
          ? ok(args.note.trim() ? "Saved for the next run." : "Cleared the progress note.")
          : fail("Only a routine run has a progress note."),
      ),
  });

  return defineToolkit({
    id: "routines",
    name: "Routines",
    description: "Schedule recurring or one-time routines for the owner",
    tools: [
      createRoutine,
      listRoutines,
      updateRoutine,
      deleteRoutine,
      runRoutineNow,
      reportBlocked,
      saveProgress,
    ],
  });
}
