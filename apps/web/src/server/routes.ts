import { Router, type Express } from "express";
import { jwtAuthMiddleware } from "@groot/core/middlewares/jwt-auth.middleware";

// Feature routes
import authRoutes from "@groot/core/auth/auth.routes";
import passkeyRoutes from "@groot/core/passkey/passkey.routes";
import tasksRoutes from "./api/tasks/task.routes";
import botsRoutes from "./api/bots/bots.routes";
import { jobRoutes } from "@groot/jobs/server/routes";
import storageRoutes from "@groot/core/storage/storage.routes";
import appSettingsRoutes from "@groot/core/settings/app-settings.routes";

// Feature job registrations

/**
 * Register all feature job handlers.
 * Call this before startWorkers() so every queue name is known upfront.
 */
export function registerJobHandlers(): void {
  // add feature job registrations here: registerPostJobs(), etc.
}

export function registerRoutes(app: Express): void {
  // Public auth routes (no auth required)
  app.use("/api/v1/auth", authRoutes);
  app.use("/api/v1/passkey", passkeyRoutes);

  // Protected routes (JWT auth required)
  const protectedRouter = Router();
  // Bots routes own /models, /events, and /bots — registered before the todo
  // router so its /:id pattern cannot swallow them.
  protectedRouter.use(botsRoutes);
  protectedRouter.use(tasksRoutes);
  protectedRouter.use("/jobs", jobRoutes);
  protectedRouter.use("/storage", storageRoutes);
  protectedRouter.use("/settings", appSettingsRoutes);

  app.use("/api/v1", jwtAuthMiddleware, protectedRouter);
}
