import { routes } from "../routes";
import { Boom } from "@groot/core/errors";
import type { AppContext } from "@groot/core/types";
import { ok } from "@groot/core/utils/api-response.utils";
import { parseBody, parseQuery, parseStringParam } from "@groot/core/utils/controller.utils";
import {
  addModelSchema,
  createAccountSchema,
  discoverSchema,
  moveToSchema,
  patchAccountSchema,
  patchModelSchema,
  rolesSchema,
  testSchema,
  updateConnectionSchema,
} from "./models.schema";
import * as service from "./models.service";
import { discover } from "./models.discovery";
import { testModel } from "./models.probe";
import { getRoles, putRoles } from "./models.roles";
import { assertStepUp } from "../vault/vault.stepup";

const router = routes();

const MAX_BODY = 64 * 1024;
router.use("/models/*", async (c, next) => {
  const length = Number(c.req.header("content-length") ?? 0);
  if (length > MAX_BODY) throw Boom.entityTooLarge("The request is too large.");
  await next();
  c.header("Cache-Control", "no-store");
});

const idParam = (c: AppContext) => parseStringParam(c.req.param("id"), "id");

function ifMatch(c: AppContext): number | undefined {
  const raw = c.req.header("if-match")?.replace(/^W\//, "").replace(/"/g, "");
  if (!raw) return undefined;
  const version = Number(raw);
  if (!Number.isInteger(version)) throw Boom.badRequest("If-Match must be the account's version.");
  return version;
}

router.get("/models/providers", async (c) => ok(c, await service.listAccounts()));

router.post("/models/discover", "signedIn", async (c) =>
  ok(c, await discover(await parseBody(c, discoverSchema))),
);

router.post("/models/providers", "stepUp", async (c) =>
  ok(c, await service.createAccount(await parseBody(c, createAccountSchema)), 201),
);

router.patch("/models/providers/:id", "signedIn", async (c) =>
  ok(c, await service.patchAccount(idParam(c), await parseBody(c, patchAccountSchema), ifMatch(c))),
);

router.put("/models/providers/:id/connection", "stepUpForSome", async (c) => {
  const id = idParam(c);
  const payload = await parseBody(c, updateConnectionSchema);
  const { apiKey: _apiKey, ...reach } = payload;
  if (Object.values(reach).some((value) => value !== undefined)) assertStepUp(c);
  return ok(c, await service.updateConnection(id, payload));
});

router.get("/models/providers/:id/available", async (c) =>
  ok(c, { models: await service.availableModels(idParam(c)) }),
);
router.post("/models/providers/:id/refresh", "signedIn", async (c) =>
  ok(c, await service.refreshAccount(idParam(c))),
);

router.delete("/models/providers/:id", "stepUp", async (c) =>
  ok(c, await service.deleteAccount(idParam(c), parseQuery(c, moveToSchema).moveTo)),
);

router.post("/models/providers/:id/models", "signedIn", async (c) =>
  ok(c, await service.addModel(idParam(c), await parseBody(c, addModelSchema)), 201),
);

router.post("/models/test", "signedIn", async (c) =>
  ok(c, await testModel(await parseBody(c, testSchema))),
);

router.get("/models/roles", async (c) => ok(c, await getRoles()));

router.put("/models/roles", "signedIn", async (c) =>
  ok(c, await putRoles(await parseBody(c, rolesSchema))),
);

router.patch("/models/:id", "signedIn", async (c) =>
  ok(c, await service.patchModel(idParam(c), await parseBody(c, patchModelSchema))),
);

router.delete("/models/:id", "signedIn", async (c) =>
  ok(c, await service.deleteModel(idParam(c), parseQuery(c, moveToSchema).moveTo)),
);

export default router.hono;
