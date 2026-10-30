import { useAuthStore } from "@groot/shell/store/auth";

/**
 * Standard API response envelope (mirrors the server's `api-response.utils`).
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  metadata?: {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
  };
}

/** Thrown for non-2xx responses and for envelopes without data. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly url: string;
  /**
   * True when `message` came from the server's error envelope; false when it
   * is the client's fallback (the HTTP status line), which says little.
   */
  readonly fromServer: boolean;

  constructor(init: {
    status: number;
    code: string;
    message: string;
    details?: unknown;
    url: string;
    fromServer?: boolean;
  }) {
    super(init.message);
    this.name = "ApiError";
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
    this.url = init.url;
    this.fromServer = init.fromServer ?? false;
  }
}

type Params = Record<string, unknown>;

const BASE_URL = "/api/v1";

function buildUrl(path: string, params?: Params): string {
  const url = /^https?:/.test(path) ? path : `${BASE_URL}${path.startsWith("/") ? "" : "/"}${path}`;
  if (!params) return url;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${url}?${query}` : url;
}

/**
 * API client — the single surface for backend calls, on plain `fetch`. Unwraps
 * the `{ success, data }` envelope and throws an `ApiError` on failure so
 * callers get typed values directly. Auth state lives in the Zustand store
 * (`useAuthStore`), not here; the cookie travels with every request.
 *
 * Note: this module imports `useAuthStore` for the 401 handler, and the store
 * imports `apiClient` for its actions. That cycle is safe — neither references
 * the other at module load, only inside functions called later.
 */
class ApiClient {
  private async send(
    method: string,
    path: string,
    options: { params?: Params; body?: unknown } = {},
  ): Promise<Response> {
    // Stamp the request with the current auth generation so a delayed 401
    // from a previous session (issued before a logout / re-login) is ignored
    // instead of clearing the freshly authenticated session.
    const generation = useAuthStore.getState().generation;

    const headers = new Headers({ accept: "application/json" });
    let body: BodyInit | undefined;
    if (options.body instanceof FormData) {
      body = options.body; // the browser sets multipart/form-data with the boundary
    } else if (options.body !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(options.body);
    }

    const response = await fetch(buildUrl(path, options.params), {
      method,
      headers,
      body,
      credentials: "include",
    });

    // On a real 401 (session expired mid-session) clear auth so <ProtectedRoute>
    // navigates to /login. Skip the initial auth probe, login calls and stale 401s.
    if (response.status === 401) {
      const isAuthEndpoint = path.includes("/auth/me") || path.includes("/auth/login");
      const onLoginPage = window.location.pathname === "/login";
      const isStale = generation !== useAuthStore.getState().generation;
      if (!isAuthEndpoint && !onLoginPage && !isStale) {
        useAuthStore.getState().clearAuth();
      }
    }
    return response;
  }

  /** Parse the envelope; throw an `ApiError` for non-2xx responses. */
  private async envelope<T>(response: Response, path: string): Promise<ApiResponse<T>> {
    const text = await response.text();
    let parsed: ApiResponse<T> | undefined;
    if (text) {
      try {
        parsed = JSON.parse(text) as ApiResponse<T>;
      } catch {
        parsed = undefined;
      }
    }
    if (!response.ok) {
      throw new ApiError({
        status: response.status,
        code: parsed?.error?.code ?? `HTTP_${response.status}`,
        message:
          parsed?.error?.message ??
          (response.statusText || `Request failed with status ${response.status}`),
        details: parsed?.error?.details,
        url: path,
        fromServer: typeof parsed?.error?.message === "string",
      });
    }
    return parsed ?? { success: true };
  }

  private unwrap<T>(envelope: ApiResponse<T>, path: string): T {
    if (envelope.data === undefined || envelope.data === null) {
      throw new ApiError({
        status: 200,
        code: envelope.error?.code ?? "NO_DATA",
        message: envelope.error?.message ?? "No data returned",
        url: path,
      });
    }
    return envelope.data;
  }

  private async call<T>(
    method: string,
    path: string,
    options?: { params?: Params; body?: unknown },
  ): Promise<T> {
    return this.unwrap<T>(
      await this.envelope<T>(await this.send(method, path, options), path),
      path,
    );
  }

  async get<T>(url: string, params?: Params): Promise<T> {
    return this.call<T>("GET", url, { params });
  }

  async post<T>(url: string, data?: unknown): Promise<T> {
    return this.call<T>("POST", url, { body: data });
  }

  async put<T>(url: string, data?: unknown): Promise<T> {
    return this.call<T>("PUT", url, { body: data });
  }

  async patch<T>(url: string, data?: unknown): Promise<T> {
    return this.call<T>("PATCH", url, { body: data });
  }

  /**
   * DELETE. Unlike the other verbs, DELETE may legitimately return no body
   * (204 No Content), so this does not throw on missing data — it returns
   * whatever data is present (typed by the caller) or `undefined`.
   */
  async delete<T = unknown>(url: string, data?: unknown): Promise<T> {
    const envelope = await this.envelope<T>(await this.send("DELETE", url, { body: data }), url);
    return envelope.data as T;
  }

  /** Upload `FormData` — the browser sets the multipart Content-Type + boundary. */
  async postForm<T>(url: string, formData: FormData): Promise<T> {
    return this.call<T>("POST", url, { body: formData });
  }

  /** Download a binary file as a `Blob` (no envelope unwrapping). */
  async getBlob(url: string, params?: Params): Promise<Blob> {
    const response = await this.send("GET", url, { params });
    if (!response.ok) await this.envelope(response, url); // throws with the server's message
    return response.blob();
  }

  /** Login with email and password. Server sets the HttpOnly cookie. */
  async login(
    email: string,
    password: string,
  ): Promise<{ token: string; user: { id: number; email: string; name: string | null } }> {
    return this.post("/auth/login", { email, password });
  }

  /** Logout — clears the server cookie. */
  async logout(): Promise<void> {
    await this.envelope(await this.send("POST", "/auth/logout"), "/auth/logout");
  }

  /** Get the current authenticated user, or null if not signed in. */
  async getCurrentUser(): Promise<{ id: number; email: string; name: string | null } | null> {
    try {
      const envelope = await this.envelope<{ id: number; email: string; name: string | null }>(
        await this.send("GET", "/auth/me"),
        "/auth/me",
      );
      return envelope.data ?? null;
    } catch {
      return null;
    }
  }
}

export const apiClient = new ApiClient();
