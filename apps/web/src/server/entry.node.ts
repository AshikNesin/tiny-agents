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
import { attachBrowserVnc } from "./api/bots/browser.vnc";
import { attachComputerVnc } from "./api/bots/computer.vnc";
import { closeSandboxConnections } from "./api/bots/sandbox-host";
import { attachTerminalWs } from "./api/terminal/terminal.ws";
import { startCode } from "./api/code/code.boot";
import { isAssetRequest } from "./static-assets";
import { processChannel, startUpdates, SUPERVISED_ENV } from "./api/system/updates.service";
import { installFixedClock } from "./fixed-clock";
import { rearmRoutinesOnBoot } from "./api/routines/routines.arming";

/**
 * Node entry: SQLite on disk, uploads on the local filesystem, jobs on a
 * poller, the pi-durable agent runtime in-process. In development Vite serves
 * the client with HMR on the same port; in production the built client is
 * served from `dist/client`. tiny-agents runs on Node only (Chromium, ssh2 and
 * the agent store), so there is no Workers entry.
 */

if (existsSync(".env")) process.loadEnvFile(".env");
// Deterministic verify runs only (faux mode): see fixed-clock.ts.
const fixedNow = installFixedClock(process.env);

const here = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === "production";

// The production database path default (db/open.ts) applies before bootstrap validates.
applyDatabaseDefaults();

// Sentry is loaded below only when a DSN is configured: importing @sentry/node
// costs tens of MB of RSS even with nothing to send, and most self-hosted
// instances run without error reporting. Until it initialises, this slot is a
// no-op — the same outcome as calling Sentry before init().
let captureException: ErrorReporter | undefined;

bootstrap({
  env: process.env,
  config: appConfig,
  // A database still in the pre-Drizzle (Prisma) layout is copied into a
  // fresh one on first boot; see db/legacy-copy.ts and db/open.ts.
  db: (validated) => openNodeAppDatabase(validated, { besideBundle: here }),
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
  // The socket peer, or the hop a TRUSTED_PROXIES proxy vouches for.
  clientAddress: peerClientAddress((c) => getConnInfo(c).remote.address),
  rateLimitStore: memoryRateLimitStore(),
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
        await openFauxAgentRuntime(agentDbPath(), { ...durableHandlers, env: process.env })
      : await openAgentRuntime({ storePath: agentDbPath(), ...durableHandlers, env: process.env });
  } catch (error) {
    logger.error({ error }, "Failed to open agent runtime");
    process.exit(1);
  }
}

/**
 * Boot is a flat list of parts (lifecycle.ts): they start in this order and
 * stop in reverse, each stop isolated and the whole under a deadline. To add
 * a part, add an entry; place it after what it needs.
 */
async function main(): Promise<void> {
  const lifecycle = createLifecycle({
    log: {
      info: (message) => logger.info(message),
      warn: (context, message) => logger.warn(context, message),
    },
  });
  const add = lifecycle.add;

  // The one SSH connection to the sandbox: first in, so it stops last, after
  // the runtime, the browsers and the desktops ran their teardown over it.
  add({ name: "sandbox connection", stop: () => closeSandboxConnections() });

  // Secrets an older version kept in the KV store or on a connection row move
  // into the vault's tables (Q4) before anything resolves one. Never fails boot.
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

  // The bundled 1Password Connect server (ADR 0027), when OP_CONNECT_CREDENTIALS
  // asks for it. Starts in the background (the first start pulls its binaries);
  // vault uses fail closed until it answers. Stops after everything using it.
  add({
    name: "1password connect",
    start: () => startBundledConnectFromEnv(),
    stop: () => stopBundledConnect(),
  });

  let runtime!: AgentRuntime;
  // Side-calls (memory capture, chat titles) run on the opened runtime's
  // models. Faux mode makes none: no capture, first-message titles.
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

  // Browsers drive agent work, so they close before the runtime and after
  // everything that could still ask for a page.
  add({
    name: "browser sessions",
    needs: ["agent runtime"],
    stop: () => closeAllBrowserSessions(),
  });
  // Desktops on the VM stop with the app; one left by a crash is reattached
  // by the next launch for its profile.
  add({
    name: "computer sessions",
    needs: ["agent runtime"],
    stop: () => closeAllComputerSessions(),
  });

  // Remote MCP connections: install cached tools now, connect in the
  // background (never blocks /health or boot).
  add({
    name: "mcp connections",
    needs: ["agent runtime"],
    start: () =>
      getConnectionManager()
        .start(runtime)
        .catch((error: unknown) => logger.error({ error }, "Failed to start MCP connections")),
    stop: () => getConnectionManager().close(),
  });

  // Push notifications (issue #57): approvals, questions, failed or long runs
  // and routine results reach the owner's phone. A no-op without Pushover
  // credentials; never blocks the agent. The vault raises owner alerts
  // through a port; pushes are their destination.
  let notifications!: ReturnType<typeof startNotifications>;
  let unsetVaultAlerts = () => {};
  let detachWebPush = () => {};
  add({
    name: "notifications",
    needs: ["agent runtime"],
    start: () => {
      notifications = startNotifications(runtime);
      // Phones registered through the app (issue #306), beside Pushover.
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

  // Upload extraction (issue #58): files a restart interrupted extract again.
  add({
    name: "upload extraction sweep",
    start: () =>
      void extractionSweep().catch((error: unknown) =>
        logger.warn({ error }, "Upload extraction sweep failed"),
      ),
  });

  // After the agent runtime: it stops a deleted bot's chat that resume() picked back up.
  add({
    name: "bot release sweep",
    needs: ["agent runtime"],
    start: () =>
      void sweepBotReleases(runtime).catch((error: unknown) =>
        logger.warn({ error }, "Bot release sweep failed"),
      ),
  });

  // A conversation that settles (its reply finished) answers its Deliveries
  // (issue #12), resolves its awaiting routine runs (issue #63), updates the
  // bot list, pushes and arms memory capture (issue #22), in that order, and
  // the steps' boot sweeps run once it listens (bots.settled.ts). Faux mode
  // has no side-caller, so it never makes capture calls.
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

  // Armed routines whose fire job is gone get it back (routines.arming.ts),
  // in the background like the settling sweeps just above, and before the
  // job workers that run those jobs.
  add({
    name: "routine re-arm",
    needs: ["agent runtime"],
    start: () => void rearmRoutinesOnBoot(),
  });

  // Code (issue #143, ADR 0011): one live connection per coding agent
  // (Shelley, Claude Code); hand-off finishes go into bots' chats and
  // followed threads push. Empty without a configured harness.
  let stopCode = () => {};
  add({
    name: "code",
    needs: ["agent runtime"],
    start: () => {
      stopCode = startCode(runtime);
    },
    stop: () => stopCode(),
  });

  // Past-chat titles (issue #101): one lightweight side-call per "New chat"
  // names the chat that ended. Faux mode keeps the first-message titles.
  add({
    name: "chat titles",
    needs: ["agent runtime"],
    start: () => {
      setChatTitler(sideCaller && { sideCaller });
      setCodeBranchNamer(sideCaller && { sideCaller });
    },
  });

  // HTTP last to start, first to stop: new connections are refused, then the
  // long-lived ones (SSE streams, VNC and terminal sockets) are ended so
  // close() can finish, while everything they used is still up.
  let server!: http.Server;
  let browserVnc!: ReturnType<typeof attachBrowserVnc>;
  let computerVnc!: ReturnType<typeof attachComputerVnc>;
  let terminalWs!: ReturnType<typeof attachTerminalWs>;
  add({
    name: "http server",
    needs: ["agent runtime", "settled conversations", "code"],
    start: async () => {
      server = isProduction ? await createProductionServer() : await createDevServer();
      // VNC viewers for bot browsers and terminal tabs connect over WebSocket
      // on the same server; each handles only its own upgrade path.
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
      // Give the load balancer a moment to stop routing traffic here.
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

  // A silent startup ping in production.
  add({
    name: "startup ping",
    needs: ["notifications"],
    start: () => {
      if (isProduction) notificationService.notify(systemStarted(env.NODE_ENV));
    },
  });

  // Under `pnpm local` (scripts/local.ts): tells the supervisor the server is
  // up and relays update checks and restarts (docs/guides/local-updates.md).
  // Last, so "ready" means everything above started.
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
