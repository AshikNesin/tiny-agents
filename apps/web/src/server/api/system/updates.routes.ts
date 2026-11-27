import { routes } from "../routes";
import { Boom } from "@groot/core/errors";
import { ok } from "@groot/core/utils/api-response.utils";
import { requestApply, requestCheck, updateView } from "./updates.service";

const router = routes();

const NOT_SUPERVISED = "Updates from the app need the server started with `pnpm local`";

router.get("/system/update", (c) => ok(c, updateView()));

router.post("/system/update/check", "signedIn", (c) => {
  if (!requestCheck()) throw Boom.conflict(NOT_SUPERVISED);
  return ok(c, updateView(), 202);
});

router.post("/system/update/apply", "signedIn", (c) => {
  if (!requestApply()) throw Boom.conflict(NOT_SUPERVISED);
  return ok(c, updateView(), 202);
});

export default router.hono;
