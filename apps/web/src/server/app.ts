import { Hono } from "hono";
import { createApp, type CreateAppOptions } from "@groot/core/app";
import type { AppEnv } from "@groot/core/types";
import { requireSession } from "@groot/core/session";
import authRoutes from "@groot/core/auth/auth.routes";
import passkeyRoutes from "@groot/core/passkey/passkey.routes";
import storageRoutes from "@groot/core/storage/storage.routes";
import appSettingsRoutes from "@groot/core/settings/app-settings.routes";
import notificationRoutes from "@groot/core/notification/notification.routes";
import { jobRoutes } from "@groot/jobs/server/routes";
import tasksRoutes from "./api/tasks/task.routes";
import routinesRoutes from "./api/routines/routines.routes";
import botsRoutes from "./api/bots/bots.routes";
import memoriesRoutes from "./api/bots/memories.routes";
import liveRoutes from "./api/live/live.routes";
import terminalRoutes from "./api/terminal/terminal.routes";
import uploadsRoutes from "./api/uploads/uploads.routes";
import skillsRoutes from "./api/skills/skills.routes";
import connectionsRoutes, { publicConnectionsRouter } from "./api/connections/connections.routes";
import vaultRoutes, { vaultNoStore } from "./api/vault/vault.routes";
import modelsRoutes from "./api/models/models.routes";
import codeRoutes from "./api/code/code.routes";
import codeProjectRoutes from "./api/code/code.projects.routes";
import { registerCodeJobs } from "./api/code/code.pulls";
import peopleRoutes from "./api/people/people.routes";
import updatesRoutes from "./api/system/updates.routes";
import appLinksRouter from "./api/system/app-links";
import { guestGuard } from "./api/people/guest.guard";
import { registerRoutineJobs } from "./api/routines/routines.jobs";

/** Register every feature's job handlers. Call before `startWorkers()` / the first tick. */
export function registerJobHandlers(): void {
  registerRoutineJobs();
  registerCodeJobs();
}

/** The HTTP app. Feature routers declare full paths (`/bots/:id`) and mount at the API root. */
export function createWebApp(options: Omit<CreateAppOptions, "routes"> = {}) {
  return createApp({
    ...options,
    routes(app) {
      // Public
      app.route("/api/v1/auth", authRoutes);
      app.route("/api/v1/passkey", passkeyRoutes);
      // OAuth client metadata document: fetched by authorization servers.
      app.route("/api/v1", publicConnectionsRouter);
      // Android App Links: lets the Android app open this server's notification links.
      app.route("/", appLinksRouter);

      // Protected (JWT cookie or bearer token)
      const api = new Hono<AppEnv>();
      api.use(requireSession);
      // Guests reach only the bots shared with them and Code (issue #145).
      api.use(guestGuard());
      api.route("/", peopleRoutes);
      api.route("/", botsRoutes);
      api.route("/", memoriesRoutes);
      api.route("/", liveRoutes);
      api.route("/", terminalRoutes);
      api.route("/", uploadsRoutes);
      api.route("/", tasksRoutes);
      api.route("/", routinesRoutes);
      api.route("/", skillsRoutes);
      api.route("/", connectionsRoutes);
      api.route("/", codeRoutes);
      api.route("/", codeProjectRoutes);
      api.route("/", modelsRoutes);
      api.route("/", updatesRoutes);
      api.use("/vault/*", vaultNoStore);
      api.route("/", vaultRoutes);
      api.route("/jobs", jobRoutes);
      api.route("/storage", storageRoutes);
      api.route("/settings", appSettingsRoutes);
      api.route("/notifications", notificationRoutes);
      app.route("/api/v1", api);
    },
  });
}
