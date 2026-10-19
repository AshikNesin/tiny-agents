/**
 * Routine tools: the chat-side bridge to the app's routines feature
 * (issue #18 phase C). The app injects a `RoutineStore` adapter over
 * routines.service when it opens the runtime; the tools run inside
 * pi-durable with `replay: "safe"`, so a call interrupted by a restart
 * re-executes on recovery. Exactly-once is the store's job: `create` takes
 * an idempotency key (the durable tool task identity, same salt as tasks),
 * so a replayed create returns the existing routine instead of a duplicate.
 *
 * The agent package stays free of cron libraries on purpose: schedule
 * validation, the plain-English sentence (cronstrue), and the next fire
 * times in IST are rendered app-side, and the store returns them as
 * pre-rendered strings the tools echo back as confirmation cards. The store
 * also rejects mutations from routine-fired turns (the recursion guard,
 * PRD 5.6): that rejection reaches the model as a plain tool error.
 */
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import type { Extension, ToolExecutionResult } from "@earendil-works/pi-durable";
import { Type } from "@earendil-works/pi-ai";
import type { Capability } from "../capabilities";
import { toolIdempotencyKey } from "./tasks";

export type RoutineSchedule =
  | { kind: "once"; at: string }
  | { kind: "cron"; expr: string }
  | { kind: "interval"; minutes: number };

/** The routine as tools see and return it. Rendering is the store's job. */
export interface RoutineRecord {
  id: string;
  name: string;
  prompt: string;
  schedule: RoutineSchedule;
  enabled: boolean;
  /** Plain-English schedule sentence (cronstrue), e.g. "At 09:00, Monday through Friday". */
  sentence: string;
  /** The next fire times pre-rendered in IST, e.g. "Wed, 21 Oct 2026, 09:00 IST". */
  nextFireTimes: string[];
  /** ISO instant of the next run; null when paused or terminal. */
  nextRunAt: string | null;
}

export interface RoutineUpdateInput {
  name?: string;
  prompt?: string;
  schedule?: RoutineSchedule;
  enabled?: boolean;
}

export interface RoutineCreateInput {
  /** Idempotency key (the durable tool task's identity) making replays return the same routine. */
  idempotencyKey: string;
  name: string;
  prompt: string;
  schedule: RoutineSchedule;
}

/**
 * What the app provides: CRUD over its routines tables (routines.service).
 * Every method sees the calling conversation so the adapter can enforce the
 * recursion guard (reject mutations when this conversation is mid-routine-run).
 */
export interface RoutineStore {
  create(conversationId: number, input: RoutineCreateInput): Promise<RoutineRecord>;
  list(conversationId: number): Promise<RoutineRecord[]>;
  update(
    conversationId: number,
    id: string,
    input: RoutineUpdateInput,
  ): Promise<RoutineRecord | undefined>;
  remove(conversationId: number, id: string): Promise<boolean>;
  /** Fire one run immediately (a manual occurrence); returns the new run's id. */
  runNow(conversationId: number, id: string): Promise<{ runId: string }>;
}

const nameSchema = Type.String({ minLength: 1, maxLength: 80 });
const promptSchema = Type.String({ minLength: 1, maxLength: 20_000 });
const idSchema = Type.String({ minLength: 1 });

const scheduleSchema = Type.Unsafe<RoutineSchedule>(
  Type.Union([
    Type.Object({
      kind: Type.Literal("once"),
      at: Type.String({
        format: "date-time",
        description: "ISO datetime with an explicit offset, e.g. 2026-11-01T09:00:00+05:30",
      }),
    }),
    Type.Object({
      kind: Type.Literal("cron"),
      expr: Type.String({
        description:
          "5-field cron (minute hour day-of-month month day-of-week), interpreted in IST",
      }),
    }),
    Type.Object({
      kind: Type.Literal("interval"),
      minutes: Type.Integer({ minimum: 15, maximum: 1440 }),
    }),
  ]),
);

const SCHEDULE_DOC =
  'Schedule object, all times IST (UTC+05:30): {"kind":"once","at":"2026-11-01T09:00:00+05:30"} ' +
  '(one time, always carry the +05:30 offset), {"kind":"cron","expr":"0 9 * * 1-5"} ' +
  "(recurring; 5-field cron: minute hour day-of-month month day-of-week, no seconds field), or " +
  '{"kind":"interval","minutes":30} (every 30 minutes; 15 to 1440). Compact forms work: ' +
  '"*/30 * * * *" is every 30 minutes, "0 9 * * 1-5" is weekdays at 09:00. Schedules may not fire ' +
  "more often than every 15 minutes.";

const ok = (text: string): ToolExecutionResult => ({
  output: [{ type: "text", text }],
});
const fail = (text: string): ToolExecutionResult => ({
  output: [{ type: "text", text }],
  isError: true,
});

/** Store rejections (validation, limits, recursion guard) as tool failures with the reason. */
async function attempt(work: () => Promise<ToolExecutionResult>): Promise<ToolExecutionResult> {
  try {
    return await work();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return fail(reason);
  }
}

/** The confirmation card every save path echoes: sentence, next 3 fires, prompt. */
export function confirmationCard(routine: RoutineRecord): string {
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

/**
 * The `routines` extension. `store` is the app-side adapter (see
 * apps/web routines.toolkit-store.ts). The tools are created per extension
 * so they close over the store.
 */
export function createRoutinesExtension(store: RoutineStore): Extension {
  const createRoutine = defineTool({
    name: "create_routine",
    description:
      "Create a routine: a standing instruction that this bot runs a prompt on a schedule, " +
      "firing into this chat. Use it when the owner asks for reminders or recurring work " +
      "(every weekday at 9am, in 30 minutes, every Friday 6pm). " +
      SCHEDULE_DOC +
      " The result is a confirmation card with the schedule in plain English and the next " +
      "3 fire times in IST; show it to the owner so they can confirm what was parsed.",
    parameters: Type.Object({
      name: nameSchema,
      prompt: promptSchema,
      schedule: scheduleSchema,
    }),
    replay: "safe",
    execute: async (args, api, context) =>
      attempt(async () => {
        const idempotencyKey = await toolIdempotencyKey(api, context);
        const routine = await store.create(Number(api.conversationId), { idempotencyKey, ...args });
        return ok(`Created routine ${confirmationCard(routine)}`);
      }),
  });

  const listRoutines = defineTool({
    name: "list_routines",
    description: "List the owner's routines with their schedule sentence and next run in IST.",
    parameters: Type.Object({}),
    replay: "safe",
    execute: async (_args, api) =>
      attempt(async () => {
        const routines = await store.list(Number(api.conversationId));
        return ok(routines.length === 0 ? "No routines." : routines.map(present).join("\n"));
      }),
  });

  const updateRoutine = defineTool({
    name: "update_routine",
    description:
      "Update a routine by id: name, prompt, schedule, or enabled (all optional; omit what stays). " +
      "Set enabled to false to pause a routine or true to resume it. " +
      SCHEDULE_DOC +
      " Returns the updated confirmation card with the next 3 fire times in IST.",
    parameters: Type.Object({
      id: idSchema,
      name: Type.Optional(nameSchema),
      prompt: Type.Optional(promptSchema),
      schedule: Type.Optional(scheduleSchema),
      enabled: Type.Optional(Type.Boolean({ description: "false pauses, true resumes" })),
    }),
    replay: "safe",
    execute: async (args, api) =>
      attempt(async () => {
        const { id, ...input } = args;
        const routine = await store.update(Number(api.conversationId), id, input);
        return routine ? ok(`Updated routine ${confirmationCard(routine)}`) : notFound(id);
      }),
  });

  const report = (id: string, removed: boolean) =>
    removed ? ok(`Deleted routine ${id}.`) : notFound(id);
  const deleteRoutine = defineTool({
    name: "delete_routine",
    description: "Permanently delete a routine (and its run history) by id.",
    parameters: Type.Object({ id: idSchema }),
    replay: "safe",
    execute: async (args, api, context) =>
      attempt(async () => {
        // Same memo pattern as delete_task: a rerun after a crash would find
        // the row already gone; the memos remember the real outcome.
        const outcome = await api.memo<boolean>("delete_routine:removed", context);
        if (outcome !== undefined) return report(args.id, outcome);
        const resumed = (await api.memo<boolean>("delete_routine:started", context)) === true;
        await api.memo("delete_routine:started", true, context);
        const removed = (await store.remove(Number(api.conversationId), args.id)) || resumed;
        return report(args.id, await api.memo("delete_routine:removed", removed, context));
      }),
  });

  const runRoutineNow = defineTool({
    name: "run_routine_now",
    description:
      "Run a routine once immediately, without waiting for its schedule. " +
      "Use when the owner wants to test a routine or asks for its result now.",
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

  return defineExtension({
    name: "routines",
    tools: [createRoutine, listRoutines, updateRoutine, deleteRoutine, runRoutineNow],
  });
}

/** The `routines` toolkit: schedule this bot from chat (issue #18 phase C). */
export function createRoutinesToolkit(store: RoutineStore): Capability {
  return {
    id: "routines",
    kind: "toolkit",
    name: "Routines",
    description: "Schedule recurring or one-time routines for the owner",
    extension: createRoutinesExtension(store),
    tools: [
      { name: "create_routine", label: "Created routine", description: "Create a routine" },
      {
        name: "list_routines",
        label: "Listed routines",
        description: "List routines",
        readOnly: true,
      },
      { name: "update_routine", label: "Updated routine", description: "Update a routine" },
      { name: "delete_routine", label: "Deleted routine", description: "Delete a routine" },
      { name: "run_routine_now", label: "Ran routine now", description: "Run a routine now" },
    ],
  };
}
