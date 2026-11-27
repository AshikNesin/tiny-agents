import { Hono } from "hono";
import type { H, MiddlewareHandler } from "hono/types";
import type { AppEnv } from "@groot/core/types";
import { assertStepUp } from "./vault/vault.stepup";

export type RouteAccess = "public" | "signedIn" | "stepUp" | "stepUpForSome";

type WriteMethod = "post" | "put" | "patch" | "delete";

type AccessGuard = MiddlewareHandler<AppEnv> & { access: RouteAccess };

function accessGuard(access: RouteAccess): AccessGuard {
  const guard: MiddlewareHandler<AppEnv> = async (c, next) => {
    if (access === "stepUp") assertStepUp(c);
    await next();
  };
  return Object.assign(guard, { access });
}

export function isAccessGuard(handler: unknown): handler is AccessGuard {
  return typeof handler === "function" && "access" in handler;
}

export function routes() {
  const hono = new Hono<AppEnv>();
  const register = hono.on.bind(hono) as (method: string, path: string, ...handlers: H[]) => void;
  const read =
    (method: "get") =>
    <P extends string>(path: P, ...handlers: H<AppEnv, P>[]): void =>
      register(method, path, ...(handlers as H[]));
  const write =
    (method: WriteMethod) =>
    <P extends string>(path: P, access: RouteAccess, ...handlers: H<AppEnv, P>[]): void =>
      register(method, path, accessGuard(access) as H, ...(handlers as H[]));
  return {
    hono,
    use: hono.use.bind(hono) as (typeof hono)["use"],
    get: read("get"),
    post: write("post"),
    put: write("put"),
    patch: write("patch"),
    delete: write("delete"),
  };
}

export function kitRoutes(
  kit: Hono<AppEnv>,
  access: Readonly<Record<string, RouteAccess>>,
): Hono<AppEnv> {
  const guarded = new Hono<AppEnv>();
  for (const [route, tier] of Object.entries(access)) {
    const [method, path] = route.split(" ") as [string, string];
    guarded.on(method, path, accessGuard(tier));
  }
  guarded.route("/", kit);
  return guarded;
}
export type Routes = ReturnType<typeof routes>;
