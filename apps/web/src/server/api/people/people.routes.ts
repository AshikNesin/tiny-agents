import { routes } from "../routes";
import { ok } from "@groot/core/utils/api-response.utils";
import { parseBody, parseId } from "@groot/core/utils/controller.utils";
import { createUserSchema } from "@groot/core/auth/auth.schema";
import * as people from "./people.service";
import type { GuestListData, PeopleMe } from "../../../shared/api/people";

const router = routes();

router.get("/people/me", (c) => {
  return ok<PeopleMe>(c, { guest: c.get("viewer").kind === "guest" });
});

router.get("/people", async (c) => {
  return ok<GuestListData>(c, { guests: await people.listGuests() });
});

router.post("/people", "signedIn", async (c) => {
  const body = await parseBody(c, createUserSchema);
  return ok(c, await people.addGuest(body), 201);
});

router.delete("/people/:userId", "signedIn", async (c) => {
  return ok(c, await people.removeGuest(parseId(c.req.param("userId"), "userId")));
});

export default router.hono;
