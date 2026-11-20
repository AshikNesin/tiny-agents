import { createServer, type Server } from "node:net";
import type { Duplex } from "node:stream";
import type { BrowserContext, CDPSession, Page } from "playwright-core";
import { chromium } from "playwright-core";
import { SandboxTimeoutError } from "./ssh/connection";
import type { SandboxConnection } from "./ssh/sandbox-connection";
import { pageSession } from "./browser-chromium";
import { navigationGuard } from "./navigation-guard";
import { failureDetail } from "./shell";
import { browserVmStack, launchedStack } from "./browser-vm-setup";
import type {
  BrowserSession,
  BrowserTransport,
  BrowserVnc,
  OpenBrowserOptions,
} from "./browser-sessions";

export interface RemoteCdpTransportOptions {
  connection: SandboxConnection;
  locale?: string;
  timezone?: string;
}

const RESIZE_TIMEOUT_MS = 10_000;

async function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000}s`)), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function createForwardingServer(openChannel: () => Promise<Duplex>): Server {
  const server = createServer();
  server.on("connection", (socket) => {
    const early: Buffer[] = [];
    const onEarly = (d: Buffer) => early.push(d);
    socket.on("data", onEarly);
    openChannel()
      .then((channel) => {
        socket.removeListener("data", onEarly);
        for (const d of early) channel.write(d);
        socket.pipe(channel);
        channel.pipe(socket);
        const done = () => {
          socket.destroy();
          channel.destroy();
        };
        socket.on("close", done);
        channel.on("close", done);
      })
      .catch(() => socket.destroy());
  });
  return server;
}

export function createWindowResizer(
  context: Pick<BrowserContext, "pages" | "newCDPSession">,
): (width: number, height: number) => Promise<void> {
  let held: { page: Page; cdp: CDPSession; windowId: number } | undefined;
  let queue: Promise<unknown> = Promise.resolve();

  const release = () => {
    const stale = held;
    held = undefined;
    void stale?.cdp.detach().catch(() => {});
  };

  const attach = async (page: Page) => {
    const cdp = await context.newCDPSession(page);
    try {
      const { windowId } = await cdp.send("Browser.getWindowForTarget");
      return { page, cdp, windowId };
    } catch (error) {
      await cdp.detach().catch(() => {});
      throw error;
    }
  };

  const fit = async (width: number, height: number): Promise<void> => {
    for (let attempt = 0; ; attempt += 1) {
      const page = context.pages()[0];
      if (!page) throw new Error("The browser has no open tab to resize.");
      try {
        if (held?.page !== page) {
          release();
          held = await attach(page);
        }
        await held.cdp.send("Browser.setWindowBounds", {
          windowId: held.windowId,
          bounds: { left: 0, top: 0, width, height, windowState: "normal" },
        });
        return;
      } catch (error) {
        release();
        if (attempt > 0) throw error;
      }
    }
  };

  return (width, height) => {
    const run = queue.then(() => fit(width, height));
    queue = run.catch(() => {});
    return run;
  };
}

async function fetchJsonVersion(localPort: number): Promise<{ webSocketDebuggerUrl?: string }> {
  const response = await fetch(`http://127.0.0.1:${localPort}/json/version`, {
    headers: { Host: `127.0.0.1:${localPort}` },
  });
  if (!response.ok) throw new Error(`Chromium /json/version: HTTP ${response.status}`);
  return (await response.json()) as { webSocketDebuggerUrl?: string };
}

export function createRemoteCdpTransport(options: RemoteCdpTransportOptions): BrowserTransport {
  const { connection } = options;

  const exec = async (command: string, timeoutMs: number, label: string): Promise<string> => {
    let result;
    try {
      result = await connection.exec(command, { timeoutMs, settleOnExit: true });
    } catch (error) {
      if (error instanceof SandboxTimeoutError) throw new Error(`VM exec timed out: ${label}`);
      throw error;
    }
    const text = result.stdout.toString("utf8");
    if (result.exitCode === 0) return text.trim();
    const detail = failureDetail(result, 600);
    throw new Error(`VM exec failed (${result.exitCode}): ${label}${detail ? `\n${detail}` : ""}`);
  };
  const stack = browserVmStack(exec);

  const openBrowser = async (
    profileDir: string,
    open: OpenBrowserOptions,
  ): Promise<BrowserSession> => {
    const scale = open.scale === 1 ? 1 : 2;

    await stack.ensureInstalled(() => open.onPhase?.("installing"));
    open.onPhase?.("starting");
    const launched = launchedStack(
      await stack.launch({
        profileDir,
        width: open.viewportWidth,
        height: open.viewportHeight,
        scale,
        ...(options.locale ? { locale: options.locale } : {}),
        ...(options.timezone ? { timezone: options.timezone } : {}),
      }),
    );

    const live = new Set<Duplex>();
    let server: Server | undefined;
    const cleanup = async () => {
      for (const tunnel of live) tunnel.destroy();
      live.clear();
      server?.close();
      await stack.stop(profileDir).catch(() => {});
    };

    const openChannel = async (targetPort: number): Promise<Duplex> => {
      const tunnel = await connection.forward(targetPort);
      live.add(tunnel);
      tunnel.once("close", () => live.delete(tunnel));
      return tunnel;
    };

    try {
      const fwd = createForwardingServer(() => openChannel(launched.cdpPort));
      server = fwd;
      const localPort = await new Promise<number>((resolve, reject) => {
        fwd.once("error", reject);
        fwd.listen(0, "127.0.0.1", () => {
          const addr = fwd.address();
          if (addr && typeof addr === "object") resolve(addr.port);
          else reject(new Error("Could not bind a local tunnel port"));
        });
      });

      const version = await fetchJsonVersion(localPort);
      const wsUrl = version.webSocketDebuggerUrl?.replace(/:(\d+)\//, `:${localPort}/`);
      if (!wsUrl) throw new Error("Chromium on the VM did not report a debugger URL");
      const browser = await chromium.connectOverCDP(wsUrl);
      const context = browser.contexts()[0] ?? (await browser.newContext());
      const page: Page = context.pages()[0] ?? (await context.newPage());

      const setWindowSize = createWindowResizer(context);
      const vnc: BrowserVnc = {
        scale,
        openStream: () => openChannel(launched.vncPort),
        resize: (width, height) =>
          withTimeout(setWindowSize(width, height), RESIZE_TIMEOUT_MS, "Resizing the browser"),
      };

      return pageSession(page, open, {
        guard: await navigationGuard(browser, { resolveHost: null }),
        vnc,
        onDisconnect: (listener) => {
          if (browser.isConnected()) browser.once("disconnected", listener);
          else setTimeout(listener, 0);
        },
        close: async () => {
          await browser.close().catch(() => {});
          await cleanup().catch(() => {});
        },
      });
    } catch (error) {
      await cleanup().catch(() => {});
      throw error;
    }
  };

  return Object.assign(openBrowser, {
    wipe: (profileDir: string) => stack.wipe(profileDir),
  });
}
