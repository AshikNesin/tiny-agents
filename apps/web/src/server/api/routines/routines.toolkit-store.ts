/**
 * RoutineStore adapter: the agent's `routines` toolkit (issue #18 phase C)
 * talks to the real routines service through this bridge. Dependency
 * direction stays one-way: `@tiny-agents/agent` defines the port, apps/web
 * implements it.
 *
 * Two things live here that the toolkit must not know:
 * - Rendering: the service parses and validates the schedule union, renders
 *   the cronstrue sentence, and pre-formats the next 3 fire times in IST, so
 *   the agent package carries no cron libraries.
 * - The recursion guard (PRD 5.6): a routine-fired turn must not manage
 *   routines. Every mutating method rejects when the calling conversation
 *   is a routine's own (issue #63); list stays open. The owner's chat is
 *   never one, so the owner can manage routines while a run is working.
 */
import { eq } from "drizzle-orm";
import type {
  RoutineRecord,
  RoutineSchedule,
  RoutineStore,
  RoutineUpdateInput,
} from "@tiny-agents/agent";
import { HttpError } from "@groot/core/errors";
import { db, routines } from "../../db";
import { conversationOwner, isRoutineConversation } from "../bots/bots.owner";
import { describeSchedule, formatIst, parseSchedule, scheduleSchema } from "./routines.schedule";
import * as service from "./routines.service";

/** All times render in IST; the app is single-owner (issue #18). */
const FIRE_TIMES = 3;

function toRecord(routine: Awaited<ReturnType<typeof service.get>>): RoutineRecord {
  const schedule = parseSchedule(routine.schedule);
  return {
    id: routine.id,
    name: routine.name,
    prompt: routine.prompt,
    schedule,
    enabled: routine.enabled,
    sentence: describeSchedule(schedule),
    nextFireTimes: routine.enabled
      ? service.previewFireTimes(schedule, new Date(), FIRE_TIMES).map(formatIst)
      : [],
    nextRunAt: routine.nextRunAt?.toISOString() ?? null,
  };
}

function reasonOf(error: unknown): string {
  if (error instanceof HttpError) return error.message;
  throw error;
}

/** Validate a model-supplied schedule exactly as the API does, with readable reasons. */
function checkedSchedule(schedule: RoutineSchedule): RoutineSchedule {
  const result = scheduleSchema.safeParse(schedule);
  if (result.success) return result.data;
  const notes = result.error.issues.map(
    (issue) => `${issue.path.join(".") || "schedule"}: ${issue.message}`,
  );
  throw new Error(`Invalid schedule. ${notes.join(" ")}`);
}

export function createRoutineStore(): RoutineStore {
  return {
    async create(conversationId, input) {
      const owner = await conversationOwner(conversationId);
      if (owner?.kind === "routine") throw new Error(RECURSION_MSG);
      if (!owner) throw new Error("No bot owns this conversation.");
      // Exactly-once across pi-durable replays: the key is the durable tool
      // task's identity (unique per agent store, stable when the call reruns).
      const existing = input.idempotencyKey
        ? await db.query.routines.findFirst({
            where: eq(routines.sourceKey, input.idempotencyKey),
            columns: { id: true },
          })
        : undefined;
      if (existing) return toRecord(await service.get(existing.id));
      const schedule = checkedSchedule(input.schedule);
      try {
        const routine = await service.create({
          botId: owner.bot.id,
          name: input.name,
          prompt: input.prompt,
          schedule,
          enabled: true,
        });
        await db
          .update(routines)
          .set({ sourceKey: input.idempotencyKey })
          .where(eq(routines.id, routine.id));
        return toRecord(routine);
      } catch (error) {
        throw new Error(reasonOf(error));
      }
    },

    async list(conversationId) {
      void conversationId;
      return (await service.list()).map(toRecord);
    },

    async update(conversationId: number, id: string, raw: RoutineUpdateInput) {
      if (await isRoutineConversation(conversationId)) throw new Error(RECURSION_MSG);
      const input = {
        ...raw,
        ...(raw.schedule !== undefined ? { schedule: checkedSchedule(raw.schedule) } : {}),
      };
      try {
        return toRecord(await service.update(id, input));
      } catch (error) {
        if (error instanceof HttpError && error.statusCode === 404) return undefined;
        throw new Error(reasonOf(error));
      }
    },

    async remove(conversationId, id) {
      if (await isRoutineConversation(conversationId)) throw new Error(RECURSION_MSG);
      const existing = await db.query.routines.findFirst({
        where: eq(routines.id, id),
        columns: { id: true },
      });
      if (!existing) return false;
      await service.remove(id);
      return true;
    },

    async runNow(conversationId, id) {
      if (await isRoutineConversation(conversationId)) throw new Error(RECURSION_MSG);
      try {
        return await service.runNow(id);
      } catch (error) {
        if (error instanceof HttpError && error.statusCode === 404)
          throw new Error(`No routine with id "${id}".`);
        throw new Error(reasonOf(error));
      }
    },
  };
}

export const RECURSION_MSG =
  "This turn is routine-fired: a scheduled routine run cannot create or manage routines. " +
  "Finish the routine's own work instead.";
