import { Hono } from "hono";
import { createApp, type CreateAppOptions } from "@groot/core/app";
import type { AppEnv } from "@groot/core/types";
import { requireSession } from "@groot/core/session";
import { vaultNoStore } from "./api/vault/vault.routes";
import appLinksRouter from "./api/system/app-links";
import oidcRouter from "./api/system/oidc";
import { guestGuard } from "./api/people/guest.guard";
import { FEATURES } from "./api/features";

export function registerJobHandlers(): void {
  for (const feature of FEATURES) feature.jobs?.();
}

export function createWebApp(options: Omit<CreateAppOptions, "routes"> = {}) {
  return createApp({
    ...options,
    routes(app) {
      const api = new Hono<AppEnv>();
      api.use(requireSession);
      api.use(guestGuard());
      api.use("/vault/*", vaultNoStore);
      for (const feature of FEATURES) {
        if (feature.open) app.route(`/api/v1${feature.openAt ?? ""}`, feature.open);
        if (feature.routes) api.route(feature.at ?? "/", feature.routes);
      }
      app.route("/", appLinksRouter);
      app.route("/", oidcRouter);
      app.route("/api/v1", api);
    },
  });
}
