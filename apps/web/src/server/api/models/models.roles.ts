import { inArray } from "drizzle-orm";
import { Boom } from "@groot/core/errors";
import { db, modelRoles } from "../../db";
import { getAgentRuntime } from "../bots/bots.runtime";
import { reloadModels } from "./models.config";
import { ROLES } from "./models.schema";
import type { Roles, RolesResponse } from "../../../shared/api/models";
import { modelOrThrow } from "./models.records";

export async function getRoles(): Promise<RolesResponse> {
  const catalog = getAgentRuntime().catalog;
  return {
    roles: Object.fromEntries(
      ROLES.map((role) => {
        const model = catalog.forRole(role);
        return [
          role,
          {
            modelId: model?.id ?? null,
            fallback: !catalog.roleIsSet(role),
          },
        ];
      }),
    ) as Roles,
  };
}

export async function putRoles(
  input: Partial<Record<(typeof ROLES)[number], string | null>>,
): Promise<RolesResponse> {
  const entries = Object.entries(input);
  const cleared = entries.filter(([, modelId]) => !modelId).map(([role]) => role);
  const set = entries.filter((entry): entry is [string, string] => Boolean(entry[1]));
  const targets = await Promise.all(set.map(([, modelId]) => modelOrThrow(modelId)));
  set.forEach(([role], index) => {
    const wantsClassifier = role === "classifier";
    if ((targets[index]!.type === "classifier") !== wantsClassifier) {
      throw Boom.badRequest(
        wantsClassifier ? "The classifier role needs a classifier model." : "Pick a chat model.",
      );
    }
  });
  if (cleared.length > 0) await db.delete(modelRoles).where(inArray(modelRoles.role, cleared));
  await Promise.all(
    set.map(([role, modelId]) =>
      db
        .insert(modelRoles)
        .values({ role, modelId })
        .onConflictDoUpdate({
          target: modelRoles.role,
          set: { modelId, updatedAt: new Date() },
        }),
    ),
  );
  await reloadModels();
  return getRoles();
}
