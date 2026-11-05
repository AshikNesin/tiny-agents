import { Hono } from "hono";
import { createApp, type CreateAppOptions } from "@groot/core/app";
import type { AppEnv } from "@groot/core/types";
import { jwtAuthMiddleware } from "@groot/core/middlewares/jwt-auth.middleware";
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
import browserRoutes from "./api/bots/browser.routes";
import computerRoutes from "./api/bots/computer.routes";
import computerPageRoutes from "./api/bots/computer.page.routes";
import terminalRoutes from "./api/terminal/terminal.routes";
import uploadsRoutes from "./api/uploads/uploads.routes";
import skillsRoutes from "./api/skills/skills.routes";
import connectionsRoutes, { publicConnectionsRouter } from "./api/connections/connections.routes";
import vaultRoutes, { vaultNoStore } from "./api/vault/vault.routes";
import codeRoutes from "./api/code/code.routes";
import peopleRoutes from "./api/people/people.routes";
import { guestGuard } from "./api/people/guest.guard";
import { registerRoutineJobs } from "./api/routines/routines.jobs";

/** Register every feature's job handlers. Call before `startWorkers()` / the first tick. */
export function registerJobHandlers(): void {
  registerRoutineJobs();
}

/**
 * Upload routes take multipart bodies far larger than the JSON limit; they
 * enforce their own size caps.
 */
const UPLOAD_PATHS = ["/api/v1/uploads*", "/api/v1/code/uploads/*"];

/** The HTTP app. Feature routers declare full paths (`/bots/:id`) and mount at the API root. */
export function createWebApp(options: Omit<CreateAppOptions, "routes"> = {}) {
  return createApp({
    ...options,
    uploadPaths: UPLOAD_PATHS,
    routes(app) {
      // Public
      app.route("/api/v1/auth", authRoutes);
      app.route("/api/v1/passkey", passkeyRoutes);
      // OAuth client metadata document: fetched by authorization servers.
      app.route("/api/v1", publicConnectionsRouter);

      // Protected (JWT cookie or bearer token)
      const api = new Hono<AppEnv>();
      api.use(jwtAuthMiddleware);
      // Guests reach only the bots shared with them and Code (issue #145).
      api.use(guestGuard());
      api.route("/", peopleRoutes);
      api.route("/", botsRoutes);
      api.route("/", memoriesRoutes);
      api.route("/", browserRoutes);
      api.route("/", computerRoutes);
      api.route("/", computerPageRoutes);
      api.route("/", terminalRoutes);
      api.route("/", uploadsRoutes);
      api.route("/", tasksRoutes);
      api.route("/", routinesRoutes);
      api.route("/", skillsRoutes);
      api.route("/", connectionsRoutes);
      api.route("/", codeRoutes);
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
