/** A bearer token for `api()`, one per email, made once per test database. */
import { generateToken } from "@groot/core/utils/jwt.utils";
import { db as currentDatabase } from "@groot/core/database";
import { db, users } from "../../../apps/web/src/server/db";

// Keyed by the database: each test file gets its own, and its users with it.
const tokensByDatabase = new WeakMap<object, Map<string, Promise<string>>>();

export function authToken(email = "test@example.com", userId = 1): Promise<string> {
  let tokens = tokensByDatabase.get(currentDatabase);
  if (!tokens) tokensByDatabase.set(currentDatabase, (tokens = new Map()));
  let token = tokens.get(email);
  if (!token) {
    token = db
      .insert(users)
      .values({ id: userId, email, password: "!" })
      .onConflictDoNothing()
      .then(() => generateToken({ userId, email }));
    tokens.set(email, token);
  }
  return token;
}
