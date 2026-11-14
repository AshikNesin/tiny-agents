/**
 * The request bodies in `apps/web/src/shared/api/` are what the client sends;
 * each must be one the route's zod schema accepts (README §4.5). The server's
 * schemas stay the validators: these checks fail the typecheck when a body
 * type and its schema drift apart. Response types need no check here: the
 * handlers return them, annotated, so drift there is a type error in place.
 */
import type { z } from "zod";
import { describe, expectTypeOf, it } from "vite-plus/test";
import type { createUserSchema } from "@groot/core/auth/auth.schema";
import type * as Bots from "../../../apps/web/src/shared/api/bots";
import type * as Connections from "../../../apps/web/src/shared/api/connections";
import type * as Memories from "../../../apps/web/src/shared/api/memories";
import type * as Models from "../../../apps/web/src/shared/api/models";
import type * as People from "../../../apps/web/src/shared/api/people";
import type * as Routines from "../../../apps/web/src/shared/api/routines";
import type * as Skills from "../../../apps/web/src/shared/api/skills";
import type * as Tasks from "../../../apps/web/src/shared/api/tasks";
import type * as Vault from "../../../apps/web/src/shared/api/vault";
import type * as botsSchema from "../../../apps/web/src/server/api/bots/bots.schema";
import type * as memoriesSchema from "../../../apps/web/src/server/api/bots/memories.schema";
import type * as connectionsSchema from "../../../apps/web/src/server/api/connections/connections.schema";
import type * as modelsSchema from "../../../apps/web/src/server/api/models/models.schema";
import type * as routinesSchema from "../../../apps/web/src/server/api/routines/routines.schema";
import type { scheduleSchema } from "../../../apps/web/src/server/api/routines/routines.schedule";
import type * as skillsSchema from "../../../apps/web/src/server/api/skills/skills.schema";
import type * as tasksSchema from "../../../apps/web/src/server/api/tasks/task.schema";
import type * as vaultSchema from "../../../apps/web/src/server/api/vault/vault.schema";
import type { Bot as ServerBot } from "../../../apps/web/src/server/api/bots/bots.conversation";
import type { RoutineRun, VaultAuditEvent } from "../../../apps/web/src/server/db/schema";

type In<S extends z.ZodType> = z.input<S>;

describe("shared/api request bodies", () => {
  it("are accepted by their route's schema", () => {
    expectTypeOf<Bots.BotCreateBody>().toExtend<In<typeof botsSchema.createBotSchema>>();
    expectTypeOf<Bots.BotUpdateBody>().toExtend<In<typeof botsSchema.updateBotSchema>>();
    expectTypeOf<Bots.SendMessageBody>().toExtend<In<typeof botsSchema.sendMessageSchema>>();
    expectTypeOf<Bots.ApprovalBody>().toExtend<In<typeof botsSchema.approvalSchema>>();
    expectTypeOf<Bots.AnswerQuestionsBody>().toExtend<
      In<typeof botsSchema.answerQuestionsSchema>
    >();
    expectTypeOf<Bots.PinBody>().toExtend<In<typeof botsSchema.pinBotSchema>>();
    expectTypeOf<Bots.YoloBody>().toExtend<In<typeof botsSchema.yoloSchema>>();

    expectTypeOf<Memories.MemoryCreateBody>().toExtend<
      In<typeof memoriesSchema.createMemorySchema>
    >();
    expectTypeOf<Memories.MemoryUpdateBody>().toExtend<
      In<typeof memoriesSchema.updateMemorySchema>
    >();

    expectTypeOf<Connections.ConnectionCreateBody>().toExtend<
      In<typeof connectionsSchema.createConnectionSchema>
    >();
    expectTypeOf<Connections.ConnectionUpdateBody>().toExtend<
      In<typeof connectionsSchema.updateConnectionSchema>
    >();
    expectTypeOf<Connections.ConnectionTestBody>().toExtend<
      In<typeof connectionsSchema.testConnectionSchema>
    >();
    expectTypeOf<Connections.ConnectionToolUpdateBody>().toExtend<
      In<typeof connectionsSchema.updateToolSchema>
    >();
    expectTypeOf<Connections.ConnectionToolCallBody>().toExtend<
      In<typeof connectionsSchema.callToolSchema>
    >();

    expectTypeOf<Models.ModelEndpoint>().toExtend<In<typeof modelsSchema.discoverSchema>>();
    expectTypeOf<Models.AccountCreateBody>().toExtend<
      In<typeof modelsSchema.createAccountSchema>
    >();
    expectTypeOf<Models.AccountPatchBody>().toExtend<In<typeof modelsSchema.patchAccountSchema>>();
    expectTypeOf<Models.AccountConnectionBody>().toExtend<
      In<typeof modelsSchema.updateConnectionSchema>
    >();
    expectTypeOf<Models.ModelAddBody>().toExtend<In<typeof modelsSchema.addModelSchema>>();
    expectTypeOf<Models.ModelPatchBody>().toExtend<In<typeof modelsSchema.patchModelSchema>>();
    expectTypeOf<Models.ModelTestBody>().toExtend<In<typeof modelsSchema.testSchema>>();
    expectTypeOf<Models.RolesBody>().toExtend<In<typeof modelsSchema.rolesSchema>>();

    expectTypeOf<People.GuestCreateBody>().toExtend<In<typeof createUserSchema>>();

    expectTypeOf<Routines.RoutineCreateBody>().toExtend<
      In<typeof routinesSchema.createRoutineSchema>
    >();
    expectTypeOf<Routines.RoutineUpdateBody>().toExtend<
      In<typeof routinesSchema.updateRoutineSchema>
    >();

    expectTypeOf<Skills.SkillCreateBody>().toExtend<In<typeof skillsSchema.createSkillSchema>>();
    expectTypeOf<Skills.SkillUpdateBody>().toExtend<In<typeof skillsSchema.updateSkillSchema>>();
    expectTypeOf<Skills.SkillPreviewBody>().toExtend<In<typeof skillsSchema.previewSkillSchema>>();

    expectTypeOf<Tasks.TaskCreateBody>().toExtend<In<typeof tasksSchema.createTaskSchema>>();
    expectTypeOf<Tasks.TaskUpdateBody>().toExtend<In<typeof tasksSchema.updateTaskSchema>>();

    expectTypeOf<Vault.VaultItemCreateBody>().toExtend<In<typeof vaultSchema.createItemSchema>>();
    expectTypeOf<Vault.VaultLinkBody>().toExtend<In<typeof vaultSchema.linkItemSchema>>();
    expectTypeOf<Vault.VaultItemUpdateBody>().toExtend<In<typeof vaultSchema.updateItemSchema>>();
    expectTypeOf<Vault.VaultRevealBody>().toExtend<In<typeof vaultSchema.revealSchema>>();
    expectTypeOf<Vault.StepUpBody>().toExtend<In<typeof vaultSchema.stepUpSchema>>();
    expectTypeOf<Vault.CredentialSubmitBody>().toExtend<
      In<typeof vaultSchema.submitCredentialsSchema>
    >();
  });

  it("name every column a handler sends as a whole row", () => {
    expectTypeOf<keyof ServerBot>().toEqualTypeOf<keyof Bots.BotData>();
    expectTypeOf<RoutineRun>().toEqualTypeOf<Routines.RoutineRunData>();
    expectTypeOf<VaultAuditEvent>().toEqualTypeOf<Vault.VaultAuditEventData>();
  });

  it("restate the server's own unions exactly", () => {
    expectTypeOf<Routines.Schedule>().toEqualTypeOf<z.output<typeof scheduleSchema>>();
    expectTypeOf<Models.Overrides>().toEqualTypeOf<modelsSchema.Overrides>();
    expectTypeOf<Models.ModelRole>().toEqualTypeOf<(typeof modelsSchema.ROLES)[number]>();
  });
});
