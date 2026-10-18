import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createServer,
  setupSpaFallback,
  setupErrorHandling,
  startServer,
} from "@groot/core/server";
import { env } from "@groot/core/env";
import { config } from "@groot/core/config";
import { configureLogger, logger } from "@groot/core/logger";
import { registerRoutes, registerJobHandlers } from "./routes";
import { notificationService } from "@groot/core/notification/notification.service";
import { initJobQueue, stopJobQueue } from "@groot/jobs/server/client";
import { startWorkers } from "@groot/jobs/server/worker";
import { filesPromise } from "@groot/core/storage";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  closeAgentRuntime,
  openAgentRuntime,
  openFauxAgentRuntime,
  agentRuntimeReady,
} from "./api/bots/bots.runtime";
import { endAllSse } from "./api/bots/bots.sse";
import { AgentRuntime } from "@tiny-agents/agent";

/**
 * The pi-durable agent store path. Plain path (not a file: URL) — the store
 * owns the file itself. Default mirrors .env.schema.
 */
function agentDbPath(): string {
  const raw = env.AGENT_DB_PATH?.trim();
  if (!raw) return "./data/agent.db";
  return raw.startsWith("file:") ? raw.slice(5) : raw;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const clientRoot = path.resolve(process.cwd(), "apps/web");
const distPath = path.resolve(__dirname);
const isProd = env.NODE_ENV === "production";

async function main() {
  // Configure the root logger from app config before any module uses it.
  configureLogger({
    level: config.logging.level,
    service: config.app.name,
    nodeEnv: env.NODE_ENV,
  });

  const { app, httpServer, viteServer } = await createServer({
    distPath,
    clientRoot,
    // /health stays 503 until the agent store is open and resumed, so
    // orchestrators never route traffic at a half-booted server (PRD §7.2).
    readiness: () => (agentRuntimeReady() ? undefined : "agent-runtime-starting"),
  });

  // Open the agent runtime (exclusive store lock → Harness → resume)
  // before the HTTP server accepts requests. StoreLockedError (another
  // process owns agent.db, e.g. an overlapping deploy) must exit non-zero.
  const agentDir = dirname(agentDbPath());
  mkdirSync(agentDir, { recursive: true });
  let agentRuntime: AgentRuntime | undefined;
  // pi-durable error rules: a storage error ends the Harness (fatal — exit so
  // the orchestrator restarts us and resume() picks the work back up); a
  // throwing hook/listener/tool result is only reported (log, keep running).
  const durableHandlers = {
    onFatal: (error: unknown) => {
      logger.error({ error }, "Agent runtime failed; shutting down");
      process.exit(1);
    },
    onReport: (error: unknown) => {
      logger.warn({ error }, "Agent runtime reported a non-fatal error");
    },
  };
  try {
    // process.env, not the @groot/core env wrapper: varlock's runtime ENV
    // re-resolves from .env.schema and drops -p override files, which e2e
    // uses to enable the faux provider.
    agentRuntime =
      process.env.TINY_AGENTS_FAUX === "1"
        ? // Dev/E2E escape hatch: a faux-provider runtime (no network, no
          // keys) so streaming and durability can be exercised end-to-end
          // anywhere. Never enabled implicitly — only when the env var is set.
          await openFauxAgentRuntime(agentDbPath(), durableHandlers)
        : await openAgentRuntime({ storePath: agentDbPath(), ...durableHandlers });
  } catch (error) {
    logger.error({ error }, "Failed to open agent runtime");
    process.exit(1);
  }
  const runtime = agentRuntime;
  // Fold finished replies into the bot list's denormalised fields.
  const { recordReply } = await import("./api/bots/bots.service");
  runtime.onActivity(async (change) => {
    if (change.busy) return;
    try {
      const last = await runtime.lastMessage(change.conversation);
      if (last?.role === "assistant") {
        await recordReply(String(change.conversation), last);
      }
    } catch {
      // A deleted bot's conversation is gone from app.db — nothing to update.
    }
  });

  // Register feature job handlers before routes
  registerJobHandlers();

  // Register feature routes and job handlers
  registerRoutes(app);

  // Setup SPA fallback for non-API routes
  setupSpaFallback(app, viteServer, clientRoot, distPath);

  // Setup error handling (must be last)
  setupErrorHandling(app);

  // Start server
  await startServer(httpServer, viteServer, {
    onStart: async () => {
      // Warm up the storage adapter (resolves the dynamic import in production).
      await filesPromise;

      // Initialize the job queue after the server is listening. The queue
      // adapter is selected by the DATABASE_URL scheme: pg-boss on Postgres, honker on
      // SQLite. Both implement the JobQueueAdapter interface, so the rest of
      // the app is engine-agnostic.
      if (config.jobs.enabled) {
        try {
          await initJobQueue();
          await startWorkers();
          logger.info("Job queue initialized and workers started");
        } catch (error) {
          logger.error({ error }, "Failed to initialize job queue");
        }
      } else {
        logger.info("Job queue disabled (set jobs.enabled=true in config.yml to enable)");
      }

      // Send server startup notification in production
      if (isProd) {
        try {
          await notificationService.sendServerStartupNotification(
            config.app.port,
            env.NODE_ENV || "unknown",
          );
        } catch (error) {
          logger.error({ error }, "Failed to send server startup notification");
        }
      }
    },
    onShutdown: async () => {
      // End chat/activity streams first: they hold their HTTP connections
      // open forever, and their watches must stop before the Harness closes.
      endAllSse();
      await closeAgentRuntime();
      if (config.jobs.enabled) {
        await stopJobQueue();
      }
    },
  });
}

main().catch((error) => {
  console.error("BOOT FAILURE:", error);
  logger.error({ error }, "Failed to start server");
  process.exit(1);
});
