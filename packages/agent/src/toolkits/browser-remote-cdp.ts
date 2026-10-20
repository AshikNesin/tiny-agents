/**
 * Remote-chromium transport: the browser runs on the sandbox VM
 * (tiny-agents-vm over Tailscale SSH), not in the app's container.
 *
 * Per bot profile: SSH in (no credentials — the tailnet authenticates,
 * exactly like the sandbox toolkit), start a dedicated headless-shell with
 * --remote-debugging-port bound to 127.0.0.1, tunnel that port through a
 * dedicated SSH connection, and drive it with playwright-core over CDP. No
 * ports are exposed beyond the tailnet; closing a session kills the remote
 * chromium.
 *
 * One SSH connection per browser session: Tailscale's SSH server
 * (tailscaled) multiplexes channels less robustly than openssh — after a
 * direct-tcpip channel closes, later channels on the same connection can
 * stall. Fresh connections (~50ms) sidestep it; sessions are long-lived.
 */
import { createServer } from "node:http";
import type { Page } from "playwright-core";
import { chromium } from "playwright-core";
import ssh2, { type Client } from "ssh2";
import { pageSession } from "./browser-chromium";
import type { BrowserSession, BrowserTransport, OpenBrowserOptions } from "./browser";

export interface RemoteCdpTransportOptions {
  /** SSH host of the VM running the browser (MagicDNS name). */
  host: string;
  port?: number;
  user?: string;
  /** Binary on the VM; default /headless-shell/headless-shell. */
  executablePath?: string;
  connectTimeoutMs?: number;
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
        .once("error", fail)
        .once("close", () => fail(new Error("SSH connection closed before ready")))
        .connect({
          host: options.host,
          port: options.port ?? 22,
          username: options.user,
          keepaliveInterval: 15_000,
          readyTimeout: options.connectTimeoutMs ?? 10_000,
          // The tailnet is the auth (tag:codevm -> tag:tiny-agents-vm accept
          // rules), same trust model as the sandbox toolkit: no credentials.
        });
    });

  /** Run one command on a fresh connection and close it. */
  const exec = async (command: string, timeoutMs = 15_000): Promise<string> => {
    const client = await dial();
    try {
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`VM exec timed out: ${command}`)),
          timeoutMs,
        );
        client.exec(command, (error, channel) => {
          if (error) {
            clearTimeout(timer);
            reject(error);
            return;
          }
          let text = "";
          let exitCode = -1;
          channel.on("data", (d: Buffer) => (text += d.toString("utf8")));
          channel.on("exit", (code: number) => {
            exitCode = code;
            clearTimeout(timer);
            // Backgrounded commands never send 'close' on the channel; settle
            // shortly after exit with whatever output arrived.
            setTimeout(() => {
              if (exitCode === 0) resolve(text.trim());
              else reject(new Error(`VM exec failed (${exitCode}): ${command}`));
            }, 50);
          });
        });
      });
    } finally {
      client.end();
    }
  };

  return async (profileDir: string, open: OpenBrowserOptions): Promise<BrowserSession> => {
    const executable = options.executablePath ?? "/headless-shell/headless-shell";
    const port = Number(
      await exec(
        `python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()'`,
      ),
    );
    if (!Number.isInteger(port) || port <= 0) {
      throw new Error("Could not allocate a port on the VM");
    }

    const profile = profileDir.replaceAll("'", "'\"'\"'");
    await exec(
      `mkdir -p '${profile}' && (nohup ${executable} ` +
        `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1 ` +
        `--user-data-dir='${profile}' --no-first-run --disable-gpu --headless ` +
        `</dev/null >/dev/null 2>&1 & echo $! > '${profile}/.cdp-pid') ; exit 0`,
    );

    // Wait for CDP to answer on the VM itself (no tunnel yet).
    const up = await exec(
      `for i in $(seq 1 50); do curl -sf http://127.0.0.1:${port}/json/version >/dev/null 2>&1 && echo up && exit 0; sleep 0.2; done; exit 1`,
    ).catch(() => "");
    if (up !== "up") throw new Error("Chromium did not start on the VM within 10s");

    // Local forwarding server. Two tailscaled (Tailscale SSH) realities:
    // 1. after a direct-tcpip channel closes, later channels on the same
    //    connection stall — so each incoming socket dials its OWN connection;
    // 2. the ~50ms dial must not lose the socket's first bytes (CDP clients
    //    write their HTTP request immediately) — buffer until the channel
    //    exists and replay. CDP uses few long-lived connections; the dial
    //    cost per connection is fine.
    const server = createServer();
    const live: Client[] = [];
    server.on("connection", (socket) => {
      const early: Buffer[] = [];
      const onEarly = (d: Buffer) => early.push(d);
      socket.on("data", onEarly);
      void dial()
        .then((client) => {
          live.push(client);
          client.forwardOut(
            socket.remoteAddress ?? "127.0.0.1",
            socket.remotePort ?? 0,
            "127.0.0.1",
            port,
            (error, channel) => {
              if (error) {
                socket.destroy();
                client.end();
                return;
              }
              socket.removeListener("data", onEarly);
              for (const d of early) channel.write(d);
              socket.pipe(channel);
              channel.pipe(socket);
              const done = () => {
                socket.destroy();
                channel.close();
                client.end();
              };
              socket.on("close", done);
              channel.on("close", done);
            },
          );
        })
        .catch(() => socket.destroy());
    });
    const localPort = await new Promise<number>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
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
    await page.setViewportSize({ width: open.viewportWidth, height: open.viewportHeight });

    return pageSession(page, open, {
      close: async () => {
        // Detach playwright, then kill the remote chromium explicitly
        // (closing a CDP-attached browser does not terminate it).
        await browser.close().catch(() => {});
        server.close();
        for (const c of live) c.end();
        await exec(
          `cat '${profile}/.cdp-pid' 2>/dev/null | xargs -r kill 2>/dev/null; rm -f '${profile}/.cdp-pid'`,
        ).catch(() => {});
      },
    });
  };
}
