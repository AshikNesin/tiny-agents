import { existsSync, mkdirSync, readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getRequestListener } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { serveStatic } from "@hono/node-server/serve-static";
import { bootstrap } from "@groot/core/bootstrap";
import { env } from "@groot/core/env";
import { config } from "@groot/core/config";
import { logger, scrubValue } from "@groot/core/logger";
import { redactSecretPath } from "@groot/core/utils/redact-path";
import { markShuttingDown } from "@groot/core/app";
import { memoryRateLimitStore } from "@groot/core/rate-limit/store";
import { peerClientAddress } from "@groot/core/utils/client-ip";
import type { ErrorReporter } from "@groot/core/errors";
import { localStorage, uploadsRoot } from "@groot/core/storage/node";
import { notificationService } from "@groot/core/notification/notification.service";
import { startWorkers, stopWorkers } from "@groot/jobs/server/worker";
import { AgentRuntime } from "@tiny-agents/agent";
import { closeAllBrowserSessions } from "@tiny-agents/sandbox/browser";
import { closeAllComputerSessions } from "@tiny-agents/sandbox/computer";
import { appConfig } from "./config";
import { agentDbPath, fauxMode } from "./env";
import { createWebApp, registerJobHandlers } from "./app";
import { applyDatabaseDefaults, openNodeAppDatabase } from "./db/open";
import { createLifecycle } from "./lifecycle";
import { startNotifications, notifyVaultAlert } from "./api/notifications/notifications.wiring";
import { extractionSweep } from "./api/uploads/uploads.extraction";
import { systemStarted } from "./api/notifications/notifications.events";
import { attachWebPush } from "./api/notifications/push.channel";
import {
  closeAgentRuntime,
  openAgentRuntime,
  openFauxAgentRuntime,
  agentRuntimeReady,
} from "./api/bots/bots.runtime";
import { endAllSse } from "./api/bots/bots.sse";
import { getConnectionManager } from "./api/connections/connections.manager";
import { startSettledPipeline } from "./api/bots/bots.settled";
import { sweepBotReleases } from "./api/bots/bot-resources";
import { setVaultAlertSink } from "./api/vault/vault.alerts";
import { importStoredSecrets } from "./api/vault/vault.import";
import {
  startBundledConnectFromEnv,
  stopBundledConnect,
} from "./api/vault/connect/bundled-connect";
import { setChatTitler } from "./api/bots/chats.title";
import { setCodeBranchNamer } from "./api/code/code.naming";
import { createSideCaller, type SideCaller } from "./api/bots/side-call";
import { scheduleMemoryTidy, setMemoryTidier } from "./api/bots/memories.tidy";
import { attachBrowserVnc } from "./api/bots/browser.vnc";
import { attachComputerVnc } from "./api/bots/computer.vnc";
import { closeSandboxConnections } from "./api/bots/sandbox-host";
import { attachTerminalWs } from "./api/terminal/terminal.ws";
import { startCode } from "./api/code/code.boot";
import { isAssetRequest } from "./static-assets";
import { processChannel, startUpdates, SUPERVISED_ENV } from "./api/system/updates.service";
import { installFixedClock } from "./fixed-clock";
import { rearmRoutinesOnBoot } from "./api/routines/routines.arming";

if (existsSync(".env")) process.loadEnvFile(".env");
const fixedNow = installFixedClock(process.env);

const here = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === "production";

applyDatabaseDefaults();

let captureException: ErrorReporter | undefined;

bootstrap({
  env: process.env,
  config: appConfig,
  db: (validated) => openNodeAppDatabase(validated, { besideBundle: here }),
  storage: (validated) => localStorage(uploadsRoot(validated)),
  reportError: (error, context) => captureException?.(error, context),
});

if (config.sentry.dsn) {
  const Sentry = await import("@sentry/node");
  Sentry.init({
    dsn: config.sentry.dsn,
    release: config.sentry.release,
    environment: env.NODE_ENV,
    integrations: [Sentry.zodErrorsIntegration()],
    beforeSend(event) {
      if (event.request?.url?.includes("/vault/")) delete event.request.data;
      if (event.request?.url) event.request.url = redactSecretPath(event.request.url);
      return scrubValue(event);
    },
    beforeBreadcrumb: (breadcrumb) => scrubValue(breadcrumb),
  });
  captureException = (error, extra) => Sentry.captureException(error, { extra });
}

registerJobHandlers();
const app = createWebApp({
  clientAddress: peerClientAddress((c) => getConnInfo(c).remote.address),
  rateLimitStore: memoryRateLimitStore(),
  readiness: () => (agentRuntimeReady() ? undefined : "agent-runtime-starting"),
});
const port = config.app.port;
const clientRoot = path.resolve(process.cwd(), "apps/web");

async function openRuntime(): Promise<AgentRuntime> {
  mkdirSync(path.dirname(agentDbPath()), { recursive: true });
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
      ? await openFauxAgentRuntime(agentDbPath(), { ...durableHandlers, env: process.env })
      : await openAgentRuntime({ storePath: agentDbPath(), ...durableHandlers, env: process.env });
  } catch (error) {
    logger.error({ error }, "Failed to open agent runtime");
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const lifecycle = createLifecycle({
    log: {
      info: (message) => logger.info(message),
      warn: (context, message) => logger.warn(context, message),
    },
  });
  const add = lifecycle.add;

  add({ name: "sandbox connection", stop: () => closeSandboxConnections() });

  add({
    name: "vault import",
    start: () => {
      try {
        importStoredSecrets();
      } catch (error) {
        logger.error({ error }, "Moving stored secrets into the vault failed");
      }
    },
  });

  add({
    name: "1password connect",
    start: () => startBundledConnectFromEnv(),
    stop: () => stopBundledConnect(),
  });

  let runtime!: AgentRuntime;
  let sideCaller: SideCaller | undefined;
  add({
    name: "agent runtime",
    needs: ["sandbox connection"],
    start: async () => {
      runtime = await openRuntime();
      sideCaller = fauxMode() ? undefined : createSideCaller(runtime);
    },
    stop: () => closeAgentRuntime(),
  });

  add({
    name: "browser sessions",
    needs: ["agent runtime"],
    stop: () => closeAllBrowserSessions(),
  });
  add({
    name: "computer sessions",
    needs: ["agent runtime"],
    stop: () => closeAllComputerSessions(),
  });

  add({
    name: "mcp connections",
    needs: ["agent runtime"],
    start: () =>
      getConnectionManager()
        .start(runtime)
        .catch((error: unknown) => logger.error({ error }, "Failed to start MCP connections")),
    stop: () => getConnectionManager().close(),
  });

  let notifications!: ReturnType<typeof startNotifications>;
  let unsetVaultAlerts = () => {};
  let detachWebPush = () => {};
  add({
    name: "notifications",
    needs: ["agent runtime"],
    start: () => {
      notifications = startNotifications(runtime);
      detachWebPush = attachWebPush();
      notificationService.start();
      unsetVaultAlerts = setVaultAlertSink((kind, title, message) =>
        notifyVaultAlert(kind, title, message),
      );
    },
    stop: () => {
      unsetVaultAlerts();
      notifications.stop();
      notificationService.stop();
      detachWebPush();
    },
  });

  add({
    name: "upload extraction sweep",
    start: () =>
      void extractionSweep().catch((error: unknown) =>
        logger.warn({ error }, "Upload extraction sweep failed"),
      ),
  });

  add({
    name: "bot release sweep",
    needs: ["agent runtime"],
    start: () =>
      void sweepBotReleases(runtime).catch((error: unknown) =>
        logger.warn({ error }, "Bot release sweep failed"),
      ),
  });

  let stopSettled = () => {};
  add({
    name: "settled conversations",
    needs: ["agent runtime", "notifications"],
    start: () => {
      stopSettled = startSettledPipeline(
        runtime,
        sideCaller ? { memoryCapture: { sideCaller } } : {},
      );
    },
    stop: () => stopSettled(),
  });

  add({
    name: "routine re-arm",
    needs: ["agent runtime"],
    start: () => void rearmRoutinesOnBoot(),
  });

  let stopCode = () => {};
  add({
    name: "code",
    needs: ["agent runtime"],
    start: () => {
      stopCode = startCode(runtime);
    },
    stop: () => stopCode(),
  });

  add({
    name: "memory tidy",
    needs: ["agent runtime"],
    start: () => {
      setMemoryTidier(sideCaller && { sideCaller });
      void scheduleMemoryTidy().catch((error: unknown) =>
        logger.warn({ error }, "Scheduling the weekly memory tidy failed"),
      );
    },
  });

  add({
    name: "chat titles",
    needs: ["agent runtime"],
    start: () => {
      setChatTitler(sideCaller && { sideCaller });
      setCodeBranchNamer(sideCaller && { sideCaller });
    },
  });

  let server!: http.Server;
  let browserVnc!: ReturnType<typeof attachBrowserVnc>;
  let computerVnc!: ReturnType<typeof attachComputerVnc>;
  let terminalWs!: ReturnType<typeof attachTerminalWs>;
  add({
    name: "http server",
    needs: ["agent runtime", "settled conversations", "code"],
    start: async () => {
      server = isProduction ? await createProductionServer() : await createDevServer();
      browserVnc = attachBrowserVnc(server);
      computerVnc = attachComputerVnc(server);
      terminalWs = attachTerminalWs(server);
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "0.0.0.0", resolve);
      });
      logger.info(`Server is running on http://localhost:${port}`);
      if (fixedNow) logger.warn(`Clock frozen at ${fixedNow} (TINY_AGENTS_FIXED_NOW, faux mode)`);
    },
    stop: async () => {
      markShuttingDown();
      if (isProduction) await new Promise((r) => setTimeout(r, 2000));
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeIdleConnections();
      endAllSse();
      browserVnc.close();
      computerVnc.close();
      terminalWs.close();
      await closed;
    },
  });

  add({
    name: "job workers",
    needs: ["agent runtime", "routine re-arm"],
    start: async () => {
      if (config.jobs.enabled) await startWorkers();
      else logger.info("Job queue disabled (config.jobs.enabled = false)");
    },
    stop: () => stopWorkers(),
  });

  add({
    name: "startup ping",
    needs: ["notifications"],
    start: () => {
      if (isProduction) notificationService.notify(systemStarted(env.NODE_ENV));
    },
  });

  let stopUpdates = () => {};
  add({
    name: "local updates",
    needs: ["http server", "job workers"],
    start: () => {
      stopUpdates = startUpdates(processChannel(process.env[SUPERVISED_ENV] === "1"));
    },
    stop: () => stopUpdates(),
  });

  await lifecycle.start();
  lifecycle.handleSignals(["SIGTERM", "SIGINT"]);
}

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
        c.header(
          "Cache-Control",
          filePath.includes("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
        );
      },
    }),
  );
  app.get("*", (c) => {
    if (c.req.path.startsWith("/api/")) return c.notFound();
    if (isAssetRequest(c.req.path)) {
      return c.text("Not found", 404, { "Cache-Control": "no-store" });
    }
    return c.html(indexHtml, 200, { "Cache-Control": "no-cache" });
  });

  return http.createServer(getRequestListener(app.fetch));
}

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
    if (
      url.startsWith("/api/") ||
      url.startsWith("/.well-known/") ||
      url === "/health" ||
      url === "/ready"
    ) {
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
