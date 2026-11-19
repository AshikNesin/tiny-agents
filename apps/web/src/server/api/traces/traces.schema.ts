import { z } from "zod";

const before = z.coerce.number().int().positive().optional();

export const listSessionsSchema = z.object({
  kind: z.enum(["chats", "routine", "delivery"]).optional(),
  before,
});

export const listSideCallsSchema = z.object({ before });
