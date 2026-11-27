import { describe, expect, it } from "vite-plus/test";
import { isAccessGuard, routes, type RouteAccess } from "../../../apps/web/src/server/api/routes";
import { api, createTestApp, signIn } from "../helpers";

const API = "/api/v1";
const app = createTestApp();

const writes = app.routes.filter(
  (route) => route.method !== "ALL" && route.method !== "GET" && route.path.startsWith(`${API}/`),
);
const key = (route: { method: string; path: string }) =>
  `${route.method} ${route.path.slice(API.length)}`;

const tiers = new Map<string, RouteAccess>();
for (const route of writes)
  if (isAccessGuard(route.handler)) tiers.set(key(route), route.handler.access);
const handled = new Set(writes.filter((route) => !isAccessGuard(route.handler)).map(key));

const fillParams = (path: string) => path.replace(/:\w+(\{[^}]+\})?/g, "1");

describe("route access", () => {
  it("gives every mounted write route a tier, and no tier to a route that is gone", () => {
    expect(handled.size).toBeGreaterThan(150);
    const missing = [...handled].filter((route) => !tiers.has(route));
    expect(
      missing,
      "Declare the route with routes() from apps/web/src/server/api/routes.ts, or add a kit route to apps/web/src/server/api/kit-access.ts.",
    ).toEqual([]);
    const stale = [...tiers.keys()].filter((route) => !handled.has(route));
    expect(
      stale,
      "Remove kit routes from apps/web/src/server/api/kit-access.ts that are no longer mounted.",
    ).toEqual([]);
  });

  it("refuses every stepUp route to a signed-in owner who has not confirmed it's them", async () => {
    const { token } = await signIn(app);
    const stepUp = [...tiers].filter(([, access]) => access === "stepUp");
    expect(stepUp.length).toBeGreaterThan(5);
    for (const [route] of stepUp) {
      const [method, path] = route.split(" ") as [string, string];
      const response = await api(app, `${API}${fillParams(path)}`, { method, token, json: {} });
      expect(response.status, route).toBe(403);
      expect(response.body.error?.details, route).toEqual({ code: "step_up_required" });
    }
  });

  it("does not compile a write route declared without a tier", () => {
    const router = routes();
    // @ts-expect-error
    router.post("/tierless", (c) => c.text("never mounted"));
    expect(router.hono.routes.filter((route) => !isAccessGuard(route.handler))).toEqual([]);
  });
});
