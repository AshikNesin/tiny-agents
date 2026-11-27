import { afterEach, vi } from "vite-plus/test";

const BASE = "/api/v1";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface FakeRequest<Body = unknown> {
  method: Method;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  body: Body;
  headers: Headers;
}

type Reply = (request: FakeRequest) => unknown;

interface Route {
  method: Method;
  pattern: RegExp;
  names: string[];
  reply: Reply;
  once: boolean;
}

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = `HTTP_${status}`,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

function compile(path: string): { pattern: RegExp; names: string[] } {
  const names: string[] = [];
  const source = path
    .split("/")
    .map((part) => {
      if (!part.startsWith(":")) return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      names.push(part.slice(1));
      return "([^/]+)";
    })
    .join("/");
  return { pattern: new RegExp(`^${source}$`), names };
}

function bodyOf(init: RequestInit | undefined): unknown {
  if (init?.body === undefined || init.body === null) return undefined;
  if (typeof init.body === "string") return JSON.parse(init.body);
  return init.body;
}

function envelope(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function networkDown(): TypeError {
  return new TypeError("Failed to fetch");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

export function fakeApi() {
  const routes: Route[] = [];
  const requests: FakeRequest[] = [];

  const on = (method: Method) => {
    const add =
      (once: boolean) =>
      <Body = unknown>(path: string, reply: (request: FakeRequest<Body>) => unknown) => {
        routes.unshift({ method, ...compile(path), reply: reply as Reply, once });
      };
    return Object.assign(add(false), { once: add(true) });
  };

  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.toString(), "http://app.test");
    const method = (init?.method ?? "GET").toUpperCase() as Method;
    const path = url.pathname.startsWith(BASE) ? url.pathname.slice(BASE.length) : url.pathname;
    const route = routes.find(
      (candidate) => candidate.method === method && candidate.pattern.test(path),
    );
    const match = route?.pattern.exec(path);
    const request: FakeRequest = {
      method,
      path,
      params: Object.fromEntries(
        (route?.names ?? []).map((name, at) => [name, decodeURIComponent(match![at + 1]!)]),
      ),
      query: url.searchParams,
      body: bodyOf(init),
      headers: new Headers(init?.headers),
    };
    requests.push(request);
    if (route?.once) routes.splice(routes.indexOf(route), 1);
    if (!route) {
      return envelope(501, {
        success: false,
        error: {
          code: "NO_FAKE",
          message: `No fake for ${method} ${path}. Declare it on fakeApi() in this test.`,
        },
      });
    }
    try {
      const data = await route.reply(request);
      return data === undefined
        ? new Response(null, { status: 204 })
        : envelope(200, { success: true, data });
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      return envelope(error.status, {
        success: false,
        error: { code: error.code, message: error.message, details: error.details },
      });
    }
  });

  return {
    get: on("GET"),
    post: on("POST"),
    put: on("PUT"),
    patch: on("PATCH"),
    delete: on("DELETE"),
    requests,
    sent: <Body = unknown>(method: Method, path: string) =>
      requests.filter(
        (request): request is FakeRequest<Body> =>
          request.method === method && request.path === path,
      ),
  };
}
