import { describe, expect, it } from "vite-plus/test";
import { ROUTE_ACCESS } from "../../../apps/web/src/server/api/route-access";
import { api, createTestApp, signIn } from "../helpers";

const TABLE = "ROUTE_ACCESS (apps/web/src/server/api/route-access.ts)";
const API = "/api/v1";
const app = createTestApp();

const mounted = [
  ...new Set(
    app.routes
      .filter(
        (route) =>
          route.method !== "ALL" && route.method !== "GET" && route.path.startsWith(`${API}/`),
      )
      .map((route) => `${route.method} ${route.path.slice(API.length)}`),
  ),
];

const fillParams = (path: string) => path.replace(/:\w+(\{[^}]+\})?/g, "1");

describe("route access table", () => {
  it("gives every mounted write route a tier, and lists no route that is gone", () => {
    expect(mounted.length).toBeGreaterThan(150);
    const missing = mounted.filter((route) => !(route in ROUTE_ACCESS));
    expect(missing, `Add each write route to ${TABLE} with the tier it needs.`).toEqual([]);
    const stale = Object.keys(ROUTE_ACCESS).filter((route) => !mounted.includes(route));
    expect(stale, `Remove routes from ${TABLE} that are no longer mounted.`).toEqual([]);
  });

  it("refuses every stepUp route to a signed-in owner who has not confirmed it's them", async () => {
    const { token } = await signIn(app);
    const stepUp = Object.entries(ROUTE_ACCESS).filter(([, access]) => access === "stepUp");
    expect(stepUp.length).toBeGreaterThan(10);
    for (const [route] of stepUp) {
      const [method, path] = route.split(" ") as [string, string];
      const response = await api(app, `${API}${fillParams(path)}`, { method, token, json: {} });
      expect(response.status, route).toBe(403);
      expect(response.body.error?.details, route).toEqual({ code: "step_up_required" });
    }
  });
});
