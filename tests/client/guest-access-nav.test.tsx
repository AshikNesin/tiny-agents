import { describe, expect, it } from "vite-plus/test";
import type { RouteObject } from "react-router-dom";
import { appRoutes } from "../../apps/web/src/client/App";
import { GUEST_ACCESS, isGuestPage } from "../../apps/web/src/shared/guest-access";

const TABLE = "GUEST_ACCESS (apps/web/src/shared/guest-access.ts)";

const UNGATED_PATHS = ["/login", "/setup", "*"];

function flatten(routes: RouteObject[], gated = false): { path: string; gated: boolean }[] {
  return routes.flatMap((route) => {
    const inside = gated || route.id === "guest-gate";
    const own = route.path ? [{ path: route.path, gated: inside }] : [];
    return [...own, ...flatten(route.children ?? [], inside)];
  });
}

const routes = flatten(appRoutes);
const gatedPaths = routes.filter((route) => route.gated).map((route) => route.path);

describe("guest access table", () => {
  it("keeps every signed-in page behind the guest gate", () => {
    expect(gatedPaths, 'App.tsx has no route with id "guest-gate"').toContain("/chats");
    for (const { path } of routes.filter((route) => !route.gated)) {
      expect(
        UNGATED_PATHS,
        `Route "${path}" sits outside the guest gate in App.tsx, so a guest opens it without ${TABLE}. Move it under the gate, and add its feature to ${TABLE} if guests may open it.`,
      ).toContain(path);
    }
  });

  it("names a real page for every guest feature", () => {
    for (const [name, feature] of Object.entries(GUEST_ACCESS)) {
      if (!feature.page) continue;
      const served = gatedPaths.some(
        (path) => path === feature.page || path === `${feature.page}/*`,
      );
      expect(
        served,
        `${TABLE} gives ${name} the page "${feature.page}", which no route under the guest gate in App.tsx serves.`,
      ).toBe(true);
    }
  });

  it("opens a listed page and every page beneath it, nothing else", () => {
    expect(isGuestPage("/chats/b1/history/c1")).toBe(true);
    expect(isGuestPage("/code")).toBe(false);
    expect(isGuestPage("/code/t/abc")).toBe(false);
    expect(isGuestPage("/settings")).toBe(true);
    expect(isGuestPage("/codex")).toBe(false);
    expect(isGuestPage("/vault/new/login")).toBe(false);
    expect(isGuestPage("/")).toBe(false);
  });
});
