import { create } from "zustand";
import { startAuthentication } from "@simplewebauthn/browser";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { ApiError, apiClient } from "@groot/shell/lib/api";
import { describeError } from "@groot/shell/lib/feedback";
import type { SessionUser } from "@groot/core/auth/auth.schema";

export type { SessionUser };

export type AuthStatus =
  | { status: "unknown" }
  | { status: "signedOut" }
  | { status: "signedIn"; user: SessionUser };

interface AuthState {
  user: SessionUser | null;
  isAuthenticated: boolean;
  hasCheckedAuth: boolean;
  generation: number;

  login: (email: string, password: string) => Promise<SessionUser>;
  setup: (values: { email: string; password: string; name?: string }) => Promise<SessionUser>;
  loginWithPasskey: () => Promise<SessionUser>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  clearAuth: () => void;
}

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

export function selectAuthStatus(state: Pick<AuthState, "user" | "hasCheckedAuth">): AuthStatus {
  if (state.user) return { status: "signedIn", user: state.user };
  return state.hasCheckedAuth ? { status: "signedOut" } : { status: "unknown" };
}

let generationChangedAt = 0;

export const useAuthStore = create<AuthState>((set, get) => {
  const change = (user: SessionUser | null) => {
    generationChangedAt = performance.now();
    set((s) => ({
      user,
      isAuthenticated: user !== null,
      hasCheckedAuth: true,
      generation: s.generation + 1,
    }));
  };

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
      } catch {}
      change(null);
    },

    checkAuth: async () => {
      const startedAt = get().generation;
      let user: SessionUser | null = null;
      try {
        user = await apiClient.get<SessionUser>("/auth/me");
      } catch {}
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
