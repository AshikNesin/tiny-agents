import { integer, text } from "drizzle-orm/sqlite-core";
import { createId } from "@groot/core/utils/id.utils";

export const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => createId());

export const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date());

export const ms = (name: string) => integer(name, { mode: "timestamp_ms" });
export const bool = (name: string) => integer(name, { mode: "boolean" });
