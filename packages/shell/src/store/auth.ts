import { create } from "zustand";
import { startAuthentication } from "@simplewebauthn/browser";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { ApiError, apiClient } from "@groot/shell/lib/api";
import { describeError } from "@groot/shell/lib/feedback";
import type { SessionUser } from "@groot/core/auth/auth.schema";

/** The signed-in user, as `/auth/me` and both sign-in routes return it.
 *  Defined once in `@groot/core` (type-only import, erased at build). */
export type { SessionUser };

/**
 * The client session as one value: not yet known (the first `checkAuth()` has
 * not settled), signed out, or signed in as `user`. Read it with
 * `selectAuthStatus`; the store's fields are its storage.
 */
export type AuthStatus =
  | { status: "unknown" }
  | { status: "signedOut" }
  | { status: "signedIn"; user: SessionUser };

interface AuthState {
  user: SessionUser | null;
  /** Always `user !== null`; prefer `selectAuthStatus`. */
  isAuthenticated: boolean;
  /** False until the first `checkAuth()` settles. */
  hasCheckedAuth: boolean;
  /** Bumped on every sign-in and sign-out. */
  generation: number;

  /** Sign in with email and password. Word a rejection with `loginErrorDescription`. */
  login: (email: string, password: string) => Promise<SessionUser>;
  /**
   * First-run setup: create the first account and sign in as it. The server
   * refuses (403) once any account exists.
   */
  setup: (values: { email: string; password: string; name?: string }) => Promise<SessionUser>;
  /** Sign in with a passkey (WebAuthn). Word a rejection with `loginErrorDescription`. */
  loginWithPasskey: () => Promise<SessionUser>;
  /** Clear the server cookie and the local session. Never rejects. */
  logout: () => Promise<void>;
  /** Resolve the session from the cookie on app load. */
  checkAuth: () => Promise<void>;
  /** End the local session without a server call (the cookie is already gone). */
  clearAuth: () => void;
}

/**
 * The wording a person sees when sign-in fails: `describeError`
 * (`@groot/shell/lib/feedback`), except that a 401 always means "wrong
 * credentials" for the person typing.
 */
export function loginErrorDescription(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.status === 401) return "Invalid email or password.";
  return describeError(error, fallback);
}

async function passkeySignIn(): Promise<SessionUser> {
  const optionsJSON = await apiClient.post<PublicKeyCredentialRequestOptionsJSON>(
    "/passkey/login/options",
    {},
  );
  const response = await startAuthentication({ optionsJSON });
  try {
    const { user } = await apiClient.post<{ user: SessionUser }>("/passkey/login/verify", {
      response,
    });
    return user;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      throw new Error("This passkey could not be verified. Try another one or use your password.", {
        cause: error,
      });
    }
    throw error;
  }
}

/** The session as one tagged value, derived from `user` and `hasCheckedAuth`. */
export function selectAuthStatus(state: Pick<AuthState, "user" | "hasCheckedAuth">): AuthStatus {
  if (state.user) return { status: "signedIn", user: state.user };
  return state.hasCheckedAuth ? { status: "signedOut" } : { status: "unknown" };
}

/** When `generation` last changed (`performance.now()`), for the 401 hook below. */
let generationChangedAt = 0;

/**
 * The client session: who is signed in, how they sign in and out, and what
 * the session guard's 401 means. The server keeps the session in an HttpOnly
 * cookie, so this holds only the user.
 */
export const useAuthStore = create<AuthState>((set, get) => {
  /**
   * The one transition: every sign-in and sign-out lands here, so `user`,
   * `isAuthenticated` and `generation` always move together, and once a
   * session is known (either way) the state is no longer `unknown`.
   */
  const change = (user: SessionUser | null) => {
    generationChangedAt = performance.now();
    set((s) => ({
      user,
      isAuthenticated: user !== null,
      hasCheckedAuth: true,
      generation: s.generation + 1,
    }));
  };

  // A failed sign-in changes nothing: the server kept whatever session it had,
  // so a signed-in user stays signed in.
  const signIn = async (run: () => Promise<SessionUser>) => {
    const user = await run();
    change(user);
    return user;
  };

  return {
    user: null,
    isAuthenticated: false,
    hasCheckedAuth: false,
    generation: 0,

    login: (email, password) =>
      signIn(async () => {
        const { user } = await apiClient.post<{ user: SessionUser }>("/auth/login", {
          email,
          password,
        });
        return user;
      }),

    setup: (values) =>
      signIn(async () => {
        const { user } = await apiClient.post<{ user: SessionUser }>("/auth/setup", values);
        return user;
      }),

    loginWithPasskey: () => signIn(passkeySignIn),

    logout: async () => {
      try {
        await apiClient.post("/auth/logout");
      } catch {
        // An expired cookie answers 401; the local session ends either way.
      }
      change(null);
    },

    checkAuth: async () => {
      const startedAt = get().generation;
      let user: SessionUser | null = null;
      try {
        user = await apiClient.get<SessionUser>("/auth/me");
      } catch {
        // No session cookie, or an expired one.
      }
      // A sign-in or sign-out while the check ran is newer than its answer.
      if (get().generation !== startedAt) return;
      change(user);
    },

    clearAuth: () => change(null),
  };
});

apiClient.onUnauthorized(({ sentAt }) => {
  if (useAuthStore.getState().user !== null && sentAt >= generationChangedAt) {
    useAuthStore.getState().clearAuth();
  }
});
