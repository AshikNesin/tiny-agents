import { Router, type Express } from "express";
import { jwtAuthMiddleware } from "@groot/core/middlewares/jwt-auth.middleware";

// Feature routes
import authRoutes from "@groot/core/auth/auth.routes";
import passkeyRoutes from "@groot/core/passkey/passkey.routes";
import tasksRoutes from "./api/tasks/task.routes";
import routinesRoutes from "./api/routines/routines.routes";
import botsRoutes from "./api/bots/bots.routes";
import memoriesRoutes from "./api/bots/memories.routes";
import browserRoutes from "./api/bots/browser.routes";
import terminalRoutes from "./api/terminal/terminal.routes";
import uploadsRoutes from "./api/uploads/uploads.routes";
import skillsRoutes from "./api/skills/skills.routes";
import connectionsRoutes, { publicConnectionsRouter } from "./api/connections/connections.routes";
import vaultRoutes, { vaultNoStore } from "./api/vault/vault.routes";
import { jobRoutes } from "@groot/jobs/server/routes";
import storageRoutes from "@groot/core/storage/storage.routes";
import appSettingsRoutes from "@groot/core/settings/app-settings.routes";

// Feature job registrations
import { registerRoutineJobs } from "./api/routines/routines.jobs";

/**
 * Register all feature job handlers.
 * Call this before startWorkers() so every queue name is known upfront.
 */
export function registerJobHandlers(): void {
  registerRoutineJobs();
}

export function registerRoutes(app: Express): void {
  // Public auth routes (no auth required)
  app.use("/api/v1/auth", authRoutes);
  app.use("/api/v1/passkey", passkeyRoutes);
  // OAuth client metadata document: fetched by authorization servers.
  app.use("/api/v1", publicConnectionsRouter);

  // Protected routes (JWT auth required)
  const protectedRouter = Router();
  // Bots routes own /models, /events, and /bots — registered before the todo
  // router so its /:id pattern cannot swallow them.
  protectedRouter.use(botsRoutes);
  protectedRouter.use(memoriesRoutes);
  protectedRouter.use(browserRoutes);
  protectedRouter.use(terminalRoutes);
  protectedRouter.use(uploadsRoutes);
  protectedRouter.use(tasksRoutes);
  protectedRouter.use(routinesRoutes);
  protectedRouter.use(skillsRoutes);
  protectedRouter.use(connectionsRoutes);
  protectedRouter.use(vaultNoStore);
  protectedRouter.use(vaultRoutes);
  protectedRouter.use("/jobs", jobRoutes);
  protectedRouter.use("/storage", storageRoutes);
  protectedRouter.use("/settings", appSettingsRoutes);

  app.use("/api/v1", jwtAuthMiddleware, protectedRouter);
}
