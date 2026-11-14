import { Hono } from "hono";
import type { AppEnv } from "@groot/core/types";
import { ok } from "@groot/core/utils/api-response.utils";
import { parseBody, parseId } from "@groot/core/utils/controller.utils";
import { createUserSchema } from "@groot/core/auth/auth.schema";
import * as people from "./people.service";
import type { GuestListData, PeopleMe } from "../../../shared/api/people";

const router = new Hono<AppEnv>();

/** Whether the signed-in account is a guest (the client shows a guest's shell). */
router.get("/people/me", (c) => {
  return ok<PeopleMe>(c, { guest: c.get("viewer").kind === "guest" });
});

// Owner only (guest.guard.ts): managing guests.
router.get("/people", async (c) => {
  return ok<GuestListData>(c, { guests: await people.listGuests() });
});

router.post("/people", async (c) => {
  const body = await parseBody(c, createUserSchema);
  return ok(c, await people.addGuest(body), 201);
});

router.delete("/people/:userId", async (c) => {
  return ok(c, await people.removeGuest(parseId(c.req.param("userId"), "userId")));
});

export default router;
