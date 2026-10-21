/**
 * Remote-chromium transport: the browser runs on the sandbox VM
 * (tiny-agents-vm over Tailscale SSH), not in the app's container.
 *
 * Per bot profile: SSH in (no credentials — the tailnet authenticates,
 * exactly like the sandbox toolkit), make sure the browser stack is
 * installed (first run only), then start a headful Chrome on a private X
 * display served by Xtigervnc. Both the DevTools port (driven by
 * playwright-core) and the VNC port (watched and driven by the owner's
 * noVNC viewer) bind to 127.0.0.1 on the VM and are reached through SSH
 * channels. No ports are exposed beyond the tailnet; closing a session kills
 * the remote processes.
 *
 * One SSH connection per stream: Tailscale's SSH server (tailscaled)
 * multiplexes channels less robustly than openssh — after a direct-tcpip
 * channel closes, later channels on the same connection can stall. Fresh
 * connections (~50ms) sidestep it; sessions are long-lived.
 */
import { createServer } from "node:http";
import type { Duplex } from "node:stream";
import type { Page } from "playwright-core";
import { chromium } from "playwright-core";
import ssh2, { type Client } from "ssh2";
import { pageSession } from "./browser-chromium";
import {
  installStackCommand,
  LAUNCH_BUDGET_MS,
  launchStackCommand,
  type LaunchedStack,
  parseLaunchOutput,
  stackReadyCommand,
  teardownStackCommand,
  wipeProfileCommand,
} from "./browser-vm-setup";
import type { BrowserSession, BrowserTransport, BrowserVnc, OpenBrowserOptions } from "./browser";

export interface RemoteCdpTransportOptions {
  /** SSH host of the VM running the browser (MagicDNS name). */
  host: string;
  port?: number;
  /** Unix user for the session; must match the ACL rule's `users`. Default `exedev`. */
  user?: string;
  connectTimeoutMs?: number;
}

/** First-run install budget: apt update + TigerVNC + the Chrome .deb. */
const INSTALL_TIMEOUT_MS = 10 * 60_000;
/**
 * The launch script ends by itself within its budget and says why it failed;
 * the margin covers the SSH dial. Giving up sooner would leave the script
 * running on the VM, and a bare timeout would hide its message.
 */
const LAUNCH_TIMEOUT_MS = LAUNCH_BUDGET_MS + 20_000;

/** GET /json/version through the local tunnel port. */
async function fetchJsonVersion(localPort: number): Promise<{ webSocketDebuggerUrl?: string }> {
  const response = await fetch(`http://127.0.0.1:${localPort}/json/version`, {
    headers: { Host: `127.0.0.1:${localPort}` },
  });
  if (!response.ok) throw new Error(`Chromium /json/version: HTTP ${response.status}`);
  return (await response.json()) as { webSocketDebuggerUrl?: string };
}

export function createRemoteCdpTransport(options: RemoteCdpTransportOptions): BrowserTransport {
  const dial = (): Promise<Client> =>
    new Promise((resolve, reject) => {
      const client = new ssh2.Client();
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        client.end();
        reject(error);
      };
      client
        .on("ready", () => {
          if (settled) return;
          settled = true;
          resolve(client);
        })
        // Stay subscribed for the connection's whole life: after a handshake
        // timeout ssh2 emits a second, fatal "Connection lost" error, and an
        // unhandled 'error' event would take the whole server down.
        .on("error", fail)
        .once("close", () => fail(new Error("SSH connection closed before ready")))
        .connect({
          host: options.host,
          port: options.port ?? 22,
          username: options.user ?? "exedev",
          keepaliveInterval: 15_000,
          readyTimeout: options.connectTimeoutMs ?? 10_000,
          // The tailnet is the auth (tag:codevm -> tag:tiny-agents-vm accept
          // rules), same trust model as the sandbox toolkit: no credentials.
        });
    });

  /** Run one command on a fresh connection and close it. */
  const exec = async (
    command: string,
    timeoutMs = 15_000,
    label = command.slice(0, 80),
  ): Promise<string> => {
    const client = await dial();
    try {
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`VM exec timed out: ${label}`)), timeoutMs);
        client.exec(command, (error, channel) => {
          if (error) {
            clearTimeout(timer);
            reject(error);
            return;
          }
          let text = "";
          let errText = "";
          let exitCode = -1;
          channel.on("data", (d: Buffer) => (text += d.toString("utf8")));
          channel.stderr.on("data", (d: Buffer) => (errText += d.toString("utf8")));
          channel.on("exit", (code: number) => {
            exitCode = code;
            clearTimeout(timer);
            // Backgrounded commands never send 'close' on the channel; settle
            // shortly after exit with whatever output arrived.
            setTimeout(() => {
              if (exitCode === 0) {
                resolve(text.trim());
                return;
              }
              const detail = (errText || text).trim().slice(-600);
              reject(
                new Error(`VM exec failed (${exitCode}): ${label}${detail ? `\n${detail}` : ""}`),
              );
            }, 50);
          });
        });
      });
    } finally {
      client.end();
    }
  };

  return async (profileDir: string, open: OpenBrowserOptions): Promise<BrowserSession> => {
    const scale = open.scale === 1 ? 1 : 2;

    const ready = await exec(stackReadyCommand(), 15_000, "check the browser stack");
    if (ready !== "ready") {
      open.onPhase?.("installing");
      await exec(installStackCommand(), INSTALL_TIMEOUT_MS, "install the browser stack");
    }
    open.onPhase?.("starting");

    const launchStack = async (): Promise<LaunchedStack> => {
      try {
        return parseLaunchOutput(
          await exec(
            launchStackCommand({
              profileDir,
              width: open.viewportWidth,
              height: open.viewportHeight,
              scale,
            }),
            LAUNCH_TIMEOUT_MS,
            "start the browser",
          ),
        );
      } catch (error) {
        // A launch that broke after starting Xtigervnc or Chrome (a dropped
        // connection, an unreadable report) leaves them running with nothing
        // to stop them.
        await exec(teardownStackCommand(profileDir), 15_000, "stop the browser").catch(() => {});
        throw error;
      }
    };
    const launched = await launchStack();

    const live = new Set<Client>();
    let server: ReturnType<typeof createServer> | undefined;
    // Kill the remote processes (pids recorded at launch) and drop the tunnel
    // connections; used both by session close and by failed setup.
    const cleanup = async () => {
      for (const c of live) c.end();
      live.clear();
      server?.close();
      await exec(teardownStackCommand(profileDir), 15_000, "stop the browser").catch(() => {});
    };

    /** A fresh SSH connection with one direct-tcpip channel to a VM-local port. */
    const openChannel = async (targetPort: number): Promise<Duplex> => {
      // Tailscale SSH handshakes occasionally stall; one retry hides it from
      // the viewer, who would otherwise sit on "Connecting" until the backoff.
      const client = await dial().catch(() => dial());
      live.add(client);
      return new Promise<Duplex>((resolve, reject) => {
        client.forwardOut("127.0.0.1", 0, "127.0.0.1", targetPort, (error, channel) => {
          if (error) {
            live.delete(client);
            client.end();
            reject(error);
            return;
          }
          channel.once("close", () => {
            live.delete(client);
            client.end();
          });
          resolve(channel);
        });
      });
    };

    try {
      // Local forwarding server for CDP. Two tailscaled (Tailscale SSH) realities:
      // 1. after a direct-tcpip channel closes, later channels on the same
      //    connection stall — so each incoming socket dials its OWN connection;
      // 2. the ~50ms dial must not lose the socket's first bytes (CDP clients
      //    write their HTTP request immediately) — buffer until the channel
      //    exists and replay. CDP uses few long-lived connections; the dial
      //    cost per connection is fine.
      const fwd = createServer();
      server = fwd;
      fwd.on("connection", (socket) => {
        const early: Buffer[] = [];
        const onEarly = (d: Buffer) => early.push(d);
        socket.on("data", onEarly);
        openChannel(launched.cdpPort)
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

      const vnc: BrowserVnc = {
        scale,
        openStream: () => openChannel(launched.vncPort),
        // Chrome's window defines the viewport on a real desktop, so fitting
        // a viewer means resizing the window (CSS pixels).
        resize: async (width, height) => {
          const target = context.pages()[0];
          if (!target) return;
          const cdp = await context.newCDPSession(target);
          try {
            const { windowId } = await cdp.send("Browser.getWindowForTarget");
            await cdp.send("Browser.setWindowBounds", {
              windowId,
              bounds: { left: 0, top: 0, width, height, windowState: "normal" },
            });
          } finally {
            await cdp.detach().catch(() => {});
          }
        },
      };

      return pageSession(page, open, {
        vnc,
        close: async () => {
          // Detach playwright, then kill the remote processes explicitly
          // (closing a CDP-attached browser does not terminate it).
          await browser.close().catch(() => {});
          await cleanup().catch(() => {});
        },
        wipeProfile: async () => {
          await exec(wipeProfileCommand(profileDir), 30_000, "reset the profile").catch(() => {});
        },
      });
    } catch (error) {
      // Setup failed after the stack launched and/or the tunnel bound —
      // tear both down instead of leaking them.
      await cleanup().catch(() => {});
      throw error;
    }
  };
}
