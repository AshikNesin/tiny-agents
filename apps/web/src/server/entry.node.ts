import { existsSync, mkdirSync, readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getRequestListener } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { bootstrap } from "@groot/core/bootstrap";
import { env } from "@groot/core/env";
import { config } from "@groot/core/config";
import { logger, scrubValue } from "@groot/core/logger";
import { markShuttingDown } from "@groot/core/app";
import type { ErrorReporter } from "@groot/core/errors";
import { localStorage, uploadsRoot } from "@groot/core/storage/node";
import { notificationService } from "@groot/core/notification/notification.service";
import { startWorkers, stopWorkers } from "@groot/jobs/server/worker";
import { AgentRuntime, closeAllBrowserSessions } from "@tiny-agents/agent";
import { appConfig } from "./config";
import { agentDbPath, appEnv, fauxMode } from "./env";
import { createWebApp, registerJobHandlers } from "./app";
import { asCoreDatabase } from "./db";
import { openAppDatabase } from "./db/legacy-copy";
import { startNotifications, notifyVaultAlert } from "./api/notifications/notifications.wiring";
import { extractionSweep } from "./api/uploads/uploads.extraction";
import { systemStarted } from "./api/notifications/notifications.events";
import {
  closeAgentRuntime,
  openAgentRuntime,
  openFauxAgentRuntime,
  agentRuntimeReady,
} from "./api/bots/bots.runtime";
import { endAllSse } from "./api/bots/bots.sse";
import { getConnectionManager } from "./api/connections/connections.manager";
import { createDeliveries } from "./api/bots/bots.delivery";
import { onConversationSettled } from "./api/bots/bots.settled";
import { setVaultAlertSink } from "./api/vault/vault.alerts";
import { startRoutinesWatcher } from "./api/routines/routines.watcher";
import { createMemoryCapture } from "./api/bots/memories.capture";
import { captureConversation } from "./api/bots/memories.runner";
import { setChatTitler } from "./api/bots/chats.title";
import { attachBrowserVnc } from "./api/bots/browser.vnc";
import { attachTerminalWs } from "./api/terminal/terminal.ws";
import { isAssetRequest } from "./static-assets";

/**
 * Node entry: SQLite on disk, uploads on the local filesystem, jobs on a
 * poller, the pi-durable agent runtime in-process. In development Vite serves
 * the client with HMR on the same port; in production the built client is
 * served from `dist/client`. tiny-agents runs on Node only (Chromium, ssh2 and
 * the agent store), so there is no Workers entry.
 */

if (existsSync(".env")) process.loadEnvFile(".env");

const here = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === "production";

// tiny-agents kept its database at /data/app.db in production before groot
// 3.0 (whose default is /data/prod.db). Keep that path when DATABASE_URL is unset.
if (isProduction && !process.env.DATABASE_URL) process.env.DATABASE_URL = "file:/data/app.db";

/** Migrations ship next to the bundle in production and live in apps/web/drizzle in the repo. */
function findMigrationsFolder(): string {
  const candidates = [
    process.env.GROOT_MIGRATIONS_DIR,
    path.resolve(here, "drizzle"),
    path.resolve(process.cwd(), "apps/web/drizzle"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found)
    throw new Error(`Drizzle migrations folder not found. Looked in: ${candidates.join(", ")}`);
  return found;
}

// Sentry is loaded below only when a DSN is configured: importing @sentry/node
// costs tens of MB of RSS even with nothing to send, and most self-hosted
// instances run without error reporting. Until it initialises, this slot is a
// no-op — the same outcome as calling Sentry before init().
let captureException: ErrorReporter | undefined;

bootstrap({
  env: process.env,
  config: appConfig,
  // A database still in the pre-Drizzle (Prisma) layout is copied into a
  // fresh one on first boot; see db/legacy-copy.ts.
  db: (validated) =>
    asCoreDatabase(
      openAppDatabase(validated.DATABASE_URL, {
        migrationsFolder: findMigrationsFolder(),
        uploadsRoot: uploadsRoot(validated),
      }),
    ),
  storage: (validated) => localStorage(uploadsRoot(validated)),
  reportError: (error, context) => captureException?.(error, context),
});

if (config.sentry.dsn) {
  const Sentry = await import("@sentry/node");
  Sentry.init({
    dsn: config.sentry.dsn,
    // scripts/build.mjs bakes the same release name it uploads source maps under.
    release: config.sentry.release,
    environment: env.NODE_ENV,
    integrations: [Sentry.zodErrorsIntegration()],
    // Values the app registered as secret never leave in an event; request
    // bodies of the vault routes are dropped outright.
    beforeSend(event) {
      if (event.request?.url?.includes("/vault/")) delete event.request.data;
      return scrubValue(event);
    },
    beforeBreadcrumb: (breadcrumb) => scrubValue(breadcrumb),
  });
  captureException = (error, extra) => Sentry.captureException(error, { extra });
}

registerJobHandlers();
const app = createWebApp({
  // /health stays 503 until the agent store is open and resumed, so
  // orchestrators never route traffic at a half-booted server (PRD §7.2).
  readiness: () => (agentRuntimeReady() ? undefined : "agent-runtime-starting"),
});
const port = config.app.port;
const clientRoot = path.resolve(process.cwd(), "apps/web");

/**
 * Open the agent runtime (exclusive store lock → Harness → resume) before the
 * HTTP server accepts requests. StoreLockedError (another process owns
 * agent.db, e.g. an overlapping deploy) exits non-zero.
 */
async function openRuntime(): Promise<AgentRuntime> {
  mkdirSync(path.dirname(agentDbPath()), { recursive: true });
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
    return fauxMode()
      ? // Dev/E2E escape hatch: a faux-provider runtime (no network, no keys)
        // so streaming and durability can be exercised end-to-end anywhere.
        await openFauxAgentRuntime(agentDbPath(), durableHandlers)
      : await openAgentRuntime({ storePath: agentDbPath(), ...durableHandlers });
  } catch (error) {
    logger.error({ error }, "Failed to open agent runtime");
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const runtime = await openRuntime();

  // Remote MCP connections: install cached tools now, connect in the
  // background (never blocks /health or boot).
  await getConnectionManager()
    .start(runtime)
    .catch((error: unknown) => logger.error({ error }, "Failed to start MCP connections"));

  // Push notifications (issue #57): approvals, questions, failed or long runs
  // and routine results reach the owner's phone. A no-op without Pushover
  // credentials; never blocks the agent.
  const notifications = startNotifications(runtime);
  notificationService.start();
  // The vault raises owner alerts through a port; pushes are their destination.
  setVaultAlertSink((kind, title, message) => notifyVaultAlert(kind, title, message));

  // Upload extraction (issue #58): files a restart interrupted extract again.
  void extractionSweep().catch((error: unknown) =>
    logger.warn({ error }, "Upload extraction sweep failed"),
  );

  // A conversation that settles (its reply finished) answers its Deliveries
  // (issue #12), resolves its awaiting routine runs (issue #63) and updates
  // the bot list, in that order (bots.settled.ts). The boot sweeps pick up
  // what a restart interrupted.
  const { recordReply } = await import("./api/bots/bots.service");
  const deliveries = createDeliveries(runtime);
  const routineRuns = startRoutinesWatcher(runtime);
  void deliveries.sweep().catch(() => undefined);
  // Memory capture (issue #22 phase B): settled Turns arm a debounce; the
  // quiet window or 6 turns later one side-call extracts durable facts off
  // the reply path. Faux mode never makes capture calls.
  const memoryCapture = fauxMode()
    ? undefined
    : createMemoryCapture({
        captureNow: (conversationId) =>
          captureConversation(conversationId, {
            sideCall: {
              models: runtime.models,
              hasModel: (id) => runtime.hasModel(id),
              modelId: appEnv().MEMORY_CAPTURE_MODEL,
            },
            readTranscript: async (id) => (await runtime.readChat(id)).messages,
          }),
      });
  onConversationSettled(runtime, [
    { name: "deliveries", run: (c) => deliveries.answer(c.conversationId, c.chat) },
    { name: "routine runs", run: (c) => routineRuns.resolveConversation(c.conversationId, c.chat) },
    {
      name: "bot list",
      run: async (c) => {
        const last = await runtime.lastMessage(c.conversationId);
        // A routine's or a Past chat's conversation matches no bot row: nothing to update.
        if (last?.role === "assistant") await recordReply(String(c.conversationId), last);
      },
    },
    notifications.onSettled,
    ...(memoryCapture ? [memoryCapture.onSettled] : []),
  ]);

  // Past-chat titles (issue #101): one lightweight side-call per "New chat"
  // names the chat that ended. Faux mode keeps the first-message titles.
  if (!fauxMode()) {
    setChatTitler({
      models: runtime.models,
      hasModel: (id) => runtime.hasModel(id),
      modelId: appEnv().CHAT_TITLE_MODEL,
    });
  }

  const server = isProduction ? await createProductionServer() : await createDevServer();

  // VNC viewers for bot browsers and terminal tabs connect over WebSocket on
  // the same server; each handles only its own upgrade path.
  const browserVnc = attachBrowserVnc(server);
  const terminalWs = attachTerminalWs(server);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", resolve);
  });
  logger.info(`Server is running on http://localhost:${port}`);

  if (config.jobs.enabled) {
    await startWorkers();
  } else {
    logger.info("Job queue disabled (config.jobs.enabled = false)");
  }

  // A silent startup ping in production.
  if (isProduction) notificationService.notify(systemStarted(env.NODE_ENV));

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received. Shutting down gracefully...`);
    markShuttingDown();
    // Give the load balancer a moment to stop routing traffic here.
    if (isProduction) await new Promise((r) => setTimeout(r, 2000));
    // End chat/activity streams first: they hold their HTTP connections open
    // forever, and their watches must stop before the Harness closes.
    endAllSse();
    // Viewers first, then the remote browsers they were watching.
    browserVnc.close();
    terminalWs.close();
    await closeAllBrowserSessions();
    // Disarm capture debounce timers before the runtime closes: a firing
    // timer would call into a closed store.
    memoryCapture?.stop();
    notifications.stop();
    notificationService.stop();
    await getConnectionManager().close();
    await stopWorkers();
    await closeAgentRuntime();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    process.exit(0);
  };
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => void shutdown(signal));
  }
}

/** Production: Hono serves the API and the built client (SPA fallback to index.html). */
async function createProductionServer(): Promise<http.Server> {
  const clientDist = [
    path.resolve(here, "../client"),
    path.resolve(process.cwd(), "dist/client"),
  ].find((candidate) => existsSync(path.join(candidate, "index.html")));
  if (!clientDist) throw new Error("Client build not found. Run `pnpm build` first.");
  const indexHtml = readFileSync(path.join(clientDist, "index.html"), "utf8");

  app.use(
    "/*",
    serveStatic({
      root: path.relative(process.cwd(), clientDist) || ".",
      onFound: (filePath, c) => {
        // Hashed assets can be cached forever; everything else must revalidate.
        c.header(
          "Cache-Control",
          filePath.includes("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
        );
      },
    }),
  );
  app.get("*", (c) => {
    if (c.req.path.startsWith("/api/")) return c.notFound();
    // A missing build file must 404, not get index.html with a 200: a stale
    // tab importing an old chunk would run HTML as JS, and a CDN would cache
    // that HTML under the asset's URL.
    if (isAssetRequest(c.req.path)) {
      return c.text("Not found", 404, { "Cache-Control": "no-store" });
    }
    return c.html(indexHtml, 200, { "Cache-Control": "no-cache" });
  });

  // Created without listening (unlike `serve()`, which listens at once): main()
  // attaches the WebSocket handlers, then listens exactly once.
  return http.createServer(getRequestListener(app.fetch));
}

/** Development: Vite in middleware mode handles everything that is not the API. */
async function createDevServer(): Promise<http.Server> {
  const { createServer: createViteServer } = await import("vite-plus");
  const server = http.createServer();
  const api = getRequestListener(app.fetch);

  let ws: Record<string, unknown> = { port: port + 1 };
  const tunnel = process.env.VITE_HMR_URL;
  const portless = process.env.PORTLESS_URL;
  if (tunnel) {
    ws = { server, protocol: "wss", host: tunnel, clientPort: 443 };
  } else if (portless) {
    try {
      const url = new URL(portless);
      ws = {
        server,
        protocol: url.protocol === "https:" ? "wss" : "ws",
        host: url.hostname,
        clientPort: url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
      };
    } catch (error) {
      logger.warn({ err: error }, "Failed to parse PORTLESS_URL for HMR config");
    }
  }

  const vite = await createViteServer({
    root: clientRoot,
    configFile: path.resolve(process.cwd(), "vite.config.ts"),
    server: { middlewareMode: { server }, ws } as never,
    appType: "custom",
  });

  const template = () => readFileSync(path.join(clientRoot, "index.html"), "utf8");
  server.on("request", (req, res) => {
    const url = req.url ?? "/";
    if (url.startsWith("/api/") || url === "/health" || url === "/ready") {
      void api(req, res);
      return;
    }
    vite.middlewares(req, res, () => {
      vite
        .transformIndexHtml(url, template())
        .then((html) => {
          res.setHeader("Content-Type", "text/html");
          res.end(html);
        })
        .catch((error: unknown) => {
          res.statusCode = 500;
          res.end(error instanceof Error ? error.stack : String(error));
        });
    });
  });

  logger.info("Vite dev middleware enabled");
  return server;
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, "Failed to start server");
  process.exit(1);
});
