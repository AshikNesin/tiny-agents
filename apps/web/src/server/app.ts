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
import { hookRouter as routineHookRoutes } from "./api/routines/routines.hooks";
import botsRoutes from "./api/bots/bots.routes";
import memoriesRoutes from "./api/bots/memories.routes";
import tracesRoutes from "./api/traces/traces.routes";
import liveRoutes from "./api/live/live.routes";
import terminalRoutes from "./api/terminal/terminal.routes";
import uploadsRoutes from "./api/uploads/uploads.routes";
import skillsRoutes from "./api/skills/skills.routes";
import connectionsRoutes, { publicConnectionsRouter } from "./api/connections/connections.routes";
import vaultRoutes, { vaultNoStore } from "./api/vault/vault.routes";
import modelsRoutes from "./api/models/models.routes";
import codeRoutes from "./api/code/code.routes";
import codeProjectRoutes from "./api/code/code.projects.routes";
import codeWebhookRoutes from "./api/code/code.webhook";
import { registerCodeJobs } from "./api/code/code.pulls";
import peopleRoutes from "./api/people/people.routes";
import updatesRoutes from "./api/system/updates.routes";
import appLinksRouter from "./api/system/app-links";
import { guestGuard } from "./api/people/guest.guard";
import { kitRoutes } from "./api/routes";
import {
  AUTH_ACCESS,
  JOBS_ACCESS,
  NOTIFICATIONS_ACCESS,
  PASSKEY_ACCESS,
  SETTINGS_ACCESS,
  STORAGE_ACCESS,
} from "./api/kit-access";
import pushRoutes from "./api/notifications/push.routes";
import { registerRoutineJobs } from "./api/routines/routines.jobs";
import { registerMemoryTidyJob } from "./api/bots/memories.tidy";
import { registerReviewPruneJob } from "./api/code/code.reviews.prune";

export function registerJobHandlers(): void {
  registerRoutineJobs();
  registerMemoryTidyJob();
  registerCodeJobs();
  registerReviewPruneJob();
}

export function createWebApp(options: Omit<CreateAppOptions, "routes"> = {}) {
  return createApp({
    ...options,
    routes(app) {
      app.route("/api/v1/auth", kitRoutes(authRoutes, AUTH_ACCESS));
      app.route("/api/v1/passkey", kitRoutes(passkeyRoutes, PASSKEY_ACCESS));
      app.route("/api/v1", publicConnectionsRouter.hono);
      app.route("/api/v1", codeWebhookRoutes);
      app.route("/api/v1", routineHookRoutes.hono);
      app.route("/", appLinksRouter);

      const api = new Hono<AppEnv>();
      api.use(requireSession);
      api.use(guestGuard());
      api.use("/vault/*", vaultNoStore);
      api.route("/", peopleRoutes);
      api.route("/", botsRoutes);
      api.route("/", memoriesRoutes);
      api.route("/", tracesRoutes);
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
      api.route("/", vaultRoutes);
      api.route("/jobs", kitRoutes(jobRoutes, JOBS_ACCESS));
      api.route("/storage", kitRoutes(storageRoutes, STORAGE_ACCESS));
      api.route("/settings", kitRoutes(appSettingsRoutes, SETTINGS_ACCESS));
      api.route("/", pushRoutes);
      api.route("/notifications", kitRoutes(notificationRoutes, NOTIFICATIONS_ACCESS));
      app.route("/api/v1", api);
    },
  });
}
