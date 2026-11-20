import { clearSessionCookie, readSessionToken, setSessionCookie } from "../session/cookie";

/** @deprecated Use `startSession` from `@groot/core/session`. */
export const setAuthCookie = setSessionCookie;

/** @deprecated Use `endSession` from `@groot/core/session`. */
export const clearAuthCookie = clearSessionCookie;

/** @deprecated `requireSession` from `@groot/core/session` reads the token. */
export const extractAuthToken = readSessionToken;
