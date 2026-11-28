import authRoutes from "@groot/core/auth/auth.routes";
import passkeyRoutes from "@groot/core/passkey/passkey.routes";
import storageRoutes from "@groot/core/storage/storage.routes";
import appSettingsRoutes from "@groot/core/settings/app-settings.routes";
import notificationRoutes from "@groot/core/notification/notification.routes";
import { jobRoutes } from "@groot/jobs/server/routes";
import tasksRoutes from "./tasks/task.routes";
import routinesRoutes from "./routines/routines.routes";
import { hookRouter as routineHookRoutes } from "./routines/routines.hooks";
import botsRoutes from "./bots/bots.routes";
import memoriesRoutes from "./bots/memories.routes";
import tracesRoutes from "./traces/traces.routes";
import liveRoutes from "./live/live.routes";
import terminalRoutes from "./terminal/terminal.routes";
import uploadsRoutes from "./uploads/uploads.routes";
import skillsRoutes from "./skills/skills.routes";
import connectionsRoutes, { publicConnectionsRouter } from "./connections/connections.routes";
import vaultRoutes from "./vault/vault.routes";
import modelsRoutes from "./models/models.routes";
import codeRoutes from "./code/code.routes";
import codeProjectRoutes from "./code/code.projects.routes";
import codeWebhookRoutes from "./code/code.webhook";
import { registerCodeJobs } from "./code/code.pulls";
import peopleRoutes from "./people/people.routes";
import updatesRoutes from "./system/updates.routes";
import pushRoutes from "./notifications/push.routes";
import { registerRoutineJobs } from "./routines/routines.jobs";
import { registerMemoryTidyJob } from "./bots/memories.tidy";
import { registerReviewPruneJob } from "./code/code.reviews.prune";
import { kitRoutes, type Routes } from "./routes";
import {
  AUTH_ACCESS,
  JOBS_ACCESS,
  NOTIFICATIONS_ACCESS,
  PASSKEY_ACCESS,
  SETTINGS_ACCESS,
  STORAGE_ACCESS,
} from "./kit-access";

export interface Feature {
  name: string;
  routes?: Routes["hono"];
  at?: `/${string}`;
  open?: Routes["hono"];
  openAt?: `/${string}`;
  jobs?: () => void;
}

export const FEATURES: readonly Feature[] = [
  { name: "auth", open: kitRoutes(authRoutes, AUTH_ACCESS), openAt: "/auth" },
  { name: "passkey", open: kitRoutes(passkeyRoutes, PASSKEY_ACCESS), openAt: "/passkey" },
  { name: "people", routes: peopleRoutes },
  { name: "bots", routes: botsRoutes },
  { name: "memories", routes: memoriesRoutes, jobs: registerMemoryTidyJob },
  { name: "traces", routes: tracesRoutes },
  { name: "live", routes: liveRoutes },
  { name: "terminal", routes: terminalRoutes },
  { name: "uploads", routes: uploadsRoutes },
  { name: "tasks", routes: tasksRoutes },
  {
    name: "routines",
    routes: routinesRoutes,
    open: routineHookRoutes.hono,
    jobs: registerRoutineJobs,
  },
  { name: "skills", routes: skillsRoutes },
  { name: "connections", routes: connectionsRoutes, open: publicConnectionsRouter.hono },
  { name: "code", routes: codeRoutes, open: codeWebhookRoutes, jobs: registerCodeJobs },
  { name: "code projects", routes: codeProjectRoutes, jobs: registerReviewPruneJob },
  { name: "models", routes: modelsRoutes },
  { name: "updates", routes: updatesRoutes },
  { name: "vault", routes: vaultRoutes },
  { name: "jobs", routes: kitRoutes(jobRoutes, JOBS_ACCESS), at: "/jobs" },
  { name: "storage", routes: kitRoutes(storageRoutes, STORAGE_ACCESS), at: "/storage" },
  { name: "settings", routes: kitRoutes(appSettingsRoutes, SETTINGS_ACCESS), at: "/settings" },
  { name: "push", routes: pushRoutes },
  {
    name: "notifications",
    routes: kitRoutes(notificationRoutes, NOTIFICATIONS_ACCESS),
    at: "/notifications",
  },
];
