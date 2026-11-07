import { describe, expect, it } from "vite-plus/test";
import { matchGuestRoute } from "../../../apps/web/src/server/api/people/guest.guard";
import { GUEST_ACCESS } from "../../../apps/web/src/shared/guest-access";
import { createTestApp } from "../helpers";

const TABLE = "GUEST_ACCESS (apps/web/src/shared/guest-access.ts)";
const API = "/api/v1";

const fillPathParams = (pattern: string) => pattern.replace(/:[^/]+/g, "1").replace(/\*/g, "x");

const mounted = createTestApp()
  .routes.filter((route) => route.method !== "ALL" && route.path.startsWith(`${API}/`))
  .map((route) => ({ method: route.method, path: fillPathParams(route.path.slice(API.length)) }));

const rules = Object.entries(GUEST_ACCESS).flatMap(([name, feature]) =>
  feature.api.map((rule, index) => ({ label: `${name}.api[${index}]`, ...rule })),
);

const tableAllows = (method: string, path: string) =>
  rules.some(
    (rule) => (rule.methods === "*" || rule.methods.includes(method)) && rule.path.test(path),
  );

describe("guest access table", () => {
  it("lets the guard admit a guest to exactly the routes the table lists", () => {
    expect(mounted.length).toBeGreaterThan(50);
    for (const { method, path } of mounted) {
      expect(
        matchGuestRoute(method, path) !== undefined,
        `The guest guard and ${TABLE} disagree on ${method} ${path}. Grant guest access only through ${TABLE}.`,
      ).toBe(tableAllows(method, path));
    }
  });

  it("matches a mounted route with every rule in the table", () => {
    for (const rule of rules) {
      const served = mounted.some(
        ({ method, path }) =>
          (rule.methods === "*" || rule.methods.includes(method)) && rule.path.test(path),
      );
      expect(
        served,
        `${TABLE} ${rule.label} (${rule.path}) matches no route the server mounts.`,
      ).toBe(true);
    }
  });
});
