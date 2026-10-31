/** A bearer token for `api()`, one per email, made once. */
import { generateToken } from "@groot/core/utils/jwt.utils";

const tokens = new Map<string, Promise<string>>();

export function authToken(email = "test@example.com", userId = 1): Promise<string> {
  let token = tokens.get(email);
  if (!token) {
    token = generateToken({ userId, email });
    tokens.set(email, token);
  }
  return token;
}
