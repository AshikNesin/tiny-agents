/**
 * Remote-chromium transport: the browser runs on the sandbox VM
 * (tiny-agents-vm over Tailscale SSH), not in the app's container.
 *
 * Per bot profile, over the app's sandbox connection: make sure the browser
 * stack is installed (first run only), then start a headful Chrome on a
 * private X display served by Xtigervnc. Both the DevTools port (driven by
 * playwright-core) and the VNC port (watched and driven by the owner's
 * noVNC viewer) bind to 127.0.0.1 on the VM and are reached through forwards
 * on that connection. No ports are exposed beyond the tailnet; closing a
 * session kills the remote processes.
 */
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
  /** The app's connection to the sandbox VM, which runs the browser. */
  connection: SandboxConnection;
  /** The language Chrome reports, e.g. `en-IN`. */
  locale?: string;
  /** The IANA time zone of Chrome's clock, e.g. `Asia/Kolkata`. */
  timezone?: string;
}

/** A stalled link must not hang the viewer's resize request. */
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

/**
 * A local TCP listener that pipes each connection through its own channel to
 * the sandbox (CDP, the Claude worker). Opening the channel can take a dial
 * (~50ms, more over the tailnet), and it must not lose the socket's first
 * bytes (CDP clients write their HTTP request immediately), so they are
 * buffered until the channel exists and replayed.
 *
 * A raw TCP server on purpose: `node:http`'s server cuts any connection that
 * has not sent a full request header within 60 s (headersTimeout), which
 * killed Playwright's idle CDP websocket and left a "live" session that could
 * no longer resize or drive the browser.
 */
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

/**
 * Fits Chrome's window to a size in CSS pixels, one call at a time and in
 * order (two in flight can land swapped and leave the window at a stale
 * size). The window's DevTools session is kept between calls: over a slow
 * link a resize is then one round trip instead of four (attach, look up the
 * window, set it, detach), so the window keeps up with the viewer.
 */
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
        // The tab or its window may have gone since the last resize: look
        // them up again once before giving up.
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

/** GET /json/version through the local tunnel port. */
async function fetchJsonVersion(localPort: number): Promise<{ webSocketDebuggerUrl?: string }> {
  const response = await fetch(`http://127.0.0.1:${localPort}/json/version`, {
    headers: { Host: `127.0.0.1:${localPort}` },
  });
  if (!response.ok) throw new Error(`Chromium /json/version: HTTP ${response.status}`);
  return (await response.json()) as { webSocketDebuggerUrl?: string };
}

export function createRemoteCdpTransport(options: RemoteCdpTransportOptions): BrowserTransport {
  const { connection } = options;

  /** Run one command; resolves with its trimmed stdout, rejects on a nonzero exit. */
  const exec = async (command: string, timeoutMs: number, label: string): Promise<string> => {
    let result;
    try {
      // Backgrounded commands never close the channel; settle after exit.
      result = await connection.exec(command, { timeoutMs, settleOnExit: true });
    } catch (error) {
      if (error instanceof SandboxTimeoutError)
        throw new Error(`VM exec timed out: ${label}`, { cause: error });
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
    // Kill the remote processes (pids recorded at launch) and close the
    // tunnels; used both by session close and by failed setup.
    const cleanup = async () => {
      for (const tunnel of live) tunnel.destroy();
      live.clear();
      server?.close();
      await stack.stop(profileDir).catch(() => {});
    };

    /** A forward to a VM-local port, closed with the session. */
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

      // connectOverCDP uses webSocketDebuggerUrl from /json/version verbatim —
      // it names the VM-side port, unreachable here. Fetch it through the
      // tunnel, rewrite to the local port, pass ws:// (used as-is).
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
        // Chrome's window defines the viewport on a real desktop, so fitting
        // a viewer means resizing the window (CSS pixels). The timeout also
        // covers the wait behind an earlier resize that is still stuck.
        resize: (width, height) =>
          withTimeout(setWindowSize(width, height), RESIZE_TIMEOUT_MS, "Resizing the browser"),
      };

      return pageSession(page, open, {
        // Chrome resolves names on the VM, so this server's DNS answers
        // say nothing about where it connects: literals and local names only.
        guard: await navigationGuard(browser, { resolveHost: null }),
        vnc,
        onDisconnect: (listener) => {
          // Already gone before anyone could listen: report it after the
          // caller has registered the session.
          if (browser.isConnected()) browser.once("disconnected", listener);
          else setTimeout(listener, 0);
        },
        close: async () => {
          // Detach playwright, then kill the remote processes explicitly
          // (closing a CDP-attached browser does not terminate it).
          await browser.close().catch(() => {});
          await cleanup().catch(() => {});
        },
      });
    } catch (error) {
      // Setup failed after the stack launched and/or the tunnel bound —
      // tear both down instead of leaking them.
      await cleanup().catch(() => {});
      throw error;
    }
  };

  return Object.assign(openBrowser, {
    wipe: (profileDir: string) => stack.wipe(profileDir),
  });
}
