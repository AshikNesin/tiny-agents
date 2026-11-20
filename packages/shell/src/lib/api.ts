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

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly url: string;
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

export class NetworkError extends TypeError {
  readonly url: string;

  constructor(url: string, options?: { cause?: unknown }) {
    super(`Could not reach ${url}`, options);
    this.name = "NetworkError";
    this.url = url;
  }
}

export interface UnauthorizedEvent {
  path: string;
  sentAt: number;
}

const SESSION_INVALID = "SESSION_INVALID";

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

export interface ExtraOptions {
  headers?: Record<string, string>;
}

export interface RequestOptions extends ExtraOptions {
  params?: Params;
  body?: unknown;
  emptyOk?: boolean;
}

async function readEnvelope<T>(response: Response): Promise<ApiResponse<T> | undefined> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as ApiResponse<T>;
  } catch {
    return undefined;
  }
}

class ApiClient {
  private readonly unauthorizedHandlers = new Set<(event: UnauthorizedEvent) => void>();

  onUnauthorized(handler: (event: UnauthorizedEvent) => void): () => void {
    this.unauthorizedHandlers.add(handler);
    return () => {
      this.unauthorizedHandlers.delete(handler);
    };
  }

  private async send(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<Response> {
    const headers = new Headers({ accept: "application/json", ...options.headers });
    let body: BodyInit | undefined;
    if (options.body instanceof FormData) {
      body = options.body;
    } else if (options.body !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(options.body);
    }

    const sentAt = performance.now();
    let response: Response;
    try {
      response = await fetch(buildUrl(path, options.params), {
        method,
        headers,
        body,
        credentials: "include",
      });
    } catch (error) {
      if (error instanceof TypeError) throw new NetworkError(path, { cause: error });
      throw error;
    }
    if (response.ok) return response;
    const parsed = await readEnvelope(response);
    const error = new ApiError({
      status: response.status,
      code: parsed?.error?.code ?? `HTTP_${response.status}`,
      message:
        parsed?.error?.message ??
        (response.statusText || `Request failed with status ${response.status}`),
      details: parsed?.error?.details,
      url: path,
      fromServer: typeof parsed?.error?.message === "string",
    });
    if (error.code === SESSION_INVALID) {
      for (const handler of this.unauthorizedHandlers) handler({ path, sentAt });
    }
    throw error;
  }

  private async envelope<T>(response: Response): Promise<ApiResponse<T>> {
    return (await readEnvelope<T>(response)) ?? { success: true };
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

  private async call<T>(method: string, path: string, options?: RequestOptions): Promise<T> {
    return this.unwrap<T>(await this.envelope<T>(await this.send(method, path, options)), path);
  }

  async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const verb = method.toUpperCase();
    if (!options.emptyOk) return this.call<T>(verb, path, options);
    const envelope = await this.envelope<T>(await this.send(verb, path, options));
    return envelope.data as T;
  }

  async get<T>(url: string, params?: Params, options?: ExtraOptions): Promise<T> {
    return this.call<T>("GET", url, { ...options, params });
  }

  async post<T>(url: string, data?: unknown, options?: ExtraOptions): Promise<T> {
    return this.call<T>("POST", url, { ...options, body: data });
  }

  async put<T>(url: string, data?: unknown, options?: ExtraOptions): Promise<T> {
    return this.call<T>("PUT", url, { ...options, body: data });
  }

  async patch<T>(url: string, data?: unknown, options?: ExtraOptions): Promise<T> {
    return this.call<T>("PATCH", url, { ...options, body: data });
  }

  async delete<T = unknown>(url: string, data?: unknown, options?: ExtraOptions): Promise<T> {
    return this.request<T>("DELETE", url, { ...options, body: data, emptyOk: true });
  }

  async postForm<T>(url: string, formData: FormData): Promise<T> {
    return this.call<T>("POST", url, { body: formData });
  }

  async getBlob(url: string, params?: Params): Promise<Blob> {
    const response = await this.send("GET", url, { params });
    return response.blob();
  }
}

export const apiClient = new ApiClient();
