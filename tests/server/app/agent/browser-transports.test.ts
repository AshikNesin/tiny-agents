/**
 * The parts of the browser transports that need neither a browser nor a VM:
 * the local forwarder that carries CDP over SSH, how a page session reports
 * its browser dying, and how the remote window is fitted to the viewer.
 */
import { Server as HttpServer } from "node:http";
import net from "node:net";
import type { BrowserContext, Page } from "playwright-core";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { pageSession } from "../../../../packages/agent/src/toolkits/browser-chromium";
import {
  createForwardingServer,
  createWindowResizer,
} from "../../../../packages/agent/src/toolkits/browser-remote-cdp";

describe("CDP forwarder", () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  const listen = async (server: net.Server): Promise<number> => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return (server.address() as net.AddressInfo).port;
  };

  /** An echo service standing in for Chrome on the VM, behind a channel that takes `dialMs` to open. */
  async function forwarderToEcho(dialMs: number) {
    const vmSide: net.Socket[] = [];
    const echo = net.createServer((socket) => {
      vmSide.push(socket);
      socket.pipe(socket);
    });
    const echoPort = await listen(echo);
    const forwarder = createForwardingServer(async () => {
      await new Promise((resolve) => setTimeout(resolve, dialMs));
      return net.connect(echoPort, "127.0.0.1");
    });
    const port = await listen(forwarder);
    cleanups.push(() => {
      forwarder.close();
      echo.close();
      for (const socket of vmSide) socket.destroy();
    });
    return { port, vmSide, forwarder };
  }

  const nextData = (socket: net.Socket) =>
    new Promise<string>((resolve) => socket.once("data", (data) => resolve(data.toString())));

  /** Resolves on close; a reset on the way (an `error` event) is part of closing, not a failure. */
  const closed = (socket: net.Socket) =>
    new Promise<void>((resolve) => {
      if (socket.destroyed) resolve();
      else socket.once("close", () => resolve());
    });

  /** A client; resets from the far side are part of the scenario, not failures. */
  const connect = (port: number) => {
    const socket = net.connect(port, "127.0.0.1").on("error", () => {});
    cleanups.push(() => socket.destroy());
    return socket;
  };

  it("replays what the client wrote before the channel was open, then carries both ways", async () => {
    const { port } = await forwarderToEcho(60);
    const client = connect(port);

    client.write("GET /json/version HTTP/1.1\r\n\r\n"); // the dial is still in flight
    expect(await nextData(client)).toBe("GET /json/version HTTP/1.1\r\n\r\n");
    client.write("later");
    expect(await nextData(client)).toBe("later");
  });

  it("closes the client when the VM side closes, and the VM side when the client does", async () => {
    const { port, vmSide } = await forwarderToEcho(0);
    const first = connect(port);
    first.write("a");
    await nextData(first);
    vmSide[0]!.destroy();
    await closed(first);

    const second = connect(port);
    second.write("b");
    await nextData(second);
    second.destroy();
    await closed(vmSide[1]!);
  });

  it("drops a client whose channel could not be opened", async () => {
    const forwarder = createForwardingServer(async () => {
      throw new Error("no route to the VM");
    });
    const port = await listen(forwarder);
    cleanups.push(() => forwarder.close());

    const client = connect(port);
    client.write("hello");
    await closed(client);
  });

  it("is a plain TCP server: an HTTP server would cut idle CDP websockets after 60 s", () => {
    // Playwright holds one CDP websocket for the whole session. An
    // `http.Server` applies headersTimeout to every connection that has not
    // finished a request header, and destroyed it after about a minute of
    // quiet, leaving a "live" session whose window could no longer resize.
    const forwarder = createForwardingServer(async () => {
      throw new Error("not dialed by this test");
    });
    expect(forwarder).toBeInstanceOf(net.Server);
    expect(forwarder).not.toBeInstanceOf(HttpServer);
  });
});

describe("page session disconnects", () => {
  const stubPage = { once: () => undefined } as unknown as Page;
  const open = { viewportWidth: 1280, viewportHeight: 800 };

  function sessionWithDeath() {
    let die: () => void = () => {
      throw new Error("the transport was never asked to listen");
    };
    const session = pageSession(stubPage, open, {
      close: async () => {},
      onDisconnect: (listener) => {
        die = listener;
      },
    });
    return { session, die: () => die() };
  }

  it("tells the listener when the browser dies", () => {
    const { session, die } = sessionWithDeath();
    const listener = vi.fn();
    session.onDisconnect?.(listener);
    die();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("stays quiet about a browser the app closed itself", async () => {
    const { session, die } = sessionWithDeath();
    const listener = vi.fn();
    session.onDisconnect?.(listener);
    await session.close();
    die(); // closing the browser fires the transport's own disconnect event
    expect(listener).not.toHaveBeenCalled();
  });

  it("has nothing to report for a transport that cannot tell", () => {
    const session = pageSession(stubPage, open, { close: async () => {} });
    const listener = vi.fn();
    expect(() => session.onDisconnect?.(listener)).not.toThrow();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("window resizer", () => {
  const tab = (name: string) => ({ name }) as unknown as Page;

  /**
   * A browser context whose DevTools sessions are numbered in the order they
   * open; `calls` is the whole conversation, `detached` the sessions let go.
   */
  function fakeChrome(
    pages: Page[],
    onSend: (session: number, method: string, params: unknown) => Promise<unknown> = async (
      _session,
      method,
    ) => (method === "Browser.getWindowForTarget" ? { windowId: 7 } : {}),
  ) {
    const calls: string[] = [];
    const detached: number[] = [];
    let opened = 0;
    const context = {
      pages: () => pages,
      newCDPSession: async () => {
        const session = ++opened;
        calls.push(`attach ${session}`);
        return {
          send: async (method: string, params?: unknown) => {
            calls.push(`${session} ${method}`);
            return onSend(session, method, params);
          },
          detach: async () => {
            detached.push(session);
          },
        };
      },
    } as unknown as Pick<BrowserContext, "pages" | "newCDPSession">;
    return { context, calls, detached };
  }

  it("keeps the window's DevTools session between resizes: one round trip each", async () => {
    // Over a slow link every round trip is felt in the viewer, so a resize
    // must not attach, look the window up and detach again each time.
    const sent: unknown[] = [];
    const { context, calls, detached } = fakeChrome(
      [tab("a")],
      async (_session, method, params) => {
        if (method === "Browser.setWindowBounds") sent.push(params);
        return { windowId: 7 };
      },
    );
    const resize = createWindowResizer(context);

    await resize(1440, 844);
    await resize(632, 828);
    await resize(1000, 700);

    expect(calls).toEqual([
      "attach 1",
      "1 Browser.getWindowForTarget",
      "1 Browser.setWindowBounds",
      "1 Browser.setWindowBounds",
      "1 Browser.setWindowBounds",
    ]);
    expect(detached).toEqual([]);
    expect(sent).toEqual([
      { windowId: 7, bounds: { left: 0, top: 0, width: 1440, height: 844, windowState: "normal" } },
      { windowId: 7, bounds: { left: 0, top: 0, width: 632, height: 828, windowState: "normal" } },
      { windowId: 7, bounds: { left: 0, top: 0, width: 1000, height: 700, windowState: "normal" } },
    ]);
  });

  it("looks the window up again when the first tab is another one", async () => {
    const pages = [tab("a")];
    const { context, calls, detached } = fakeChrome(pages);
    const resize = createWindowResizer(context);

    await resize(800, 600);
    pages.splice(0, 1, tab("b")); // the owner closed the first tab
    await resize(900, 700);

    expect(calls).toEqual([
      "attach 1",
      "1 Browser.getWindowForTarget",
      "1 Browser.setWindowBounds",
      "attach 2",
      "2 Browser.getWindowForTarget",
      "2 Browser.setWindowBounds",
    ]);
    expect(detached).toEqual([1]);
  });

  it("retries once on a fresh session when the held one has gone stale", async () => {
    let stale = false;
    const { context, calls, detached } = fakeChrome([tab("a")], async (session, method) => {
      if (stale && session === 1 && method === "Browser.setWindowBounds") {
        throw new Error("Target closed");
      }
      return { windowId: 7 };
    });
    const resize = createWindowResizer(context);

    await resize(800, 600);
    stale = true;
    await expect(resize(900, 700)).resolves.toBeUndefined();

    expect(calls.slice(3)).toEqual([
      "1 Browser.setWindowBounds",
      "attach 2",
      "2 Browser.getWindowForTarget",
      "2 Browser.setWindowBounds",
    ]);
    expect(detached).toEqual([1]);
  });

  it("gives up when a fresh session fails too, and tries from scratch next time", async () => {
    let broken = true;
    const { context, calls, detached } = fakeChrome([tab("a")], async (_session, method) => {
      if (broken && method === "Browser.getWindowForTarget") throw new Error("link is down");
      return { windowId: 7 };
    });
    const resize = createWindowResizer(context);

    await expect(resize(800, 600)).rejects.toThrow("link is down");
    expect(detached).toEqual([1, 2]); // no session is left attached

    broken = false;
    await resize(800, 600);
    expect(calls.at(-1)).toBe("3 Browser.setWindowBounds");
  });

  it("runs resizes one at a time and in order", async () => {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const applied: number[] = [];
    const { context } = fakeChrome([tab("a")], async (_session, method, params) => {
      if (method === "Browser.setWindowBounds") {
        const { width } = (params as { bounds: { width: number } }).bounds;
        if (width === 1440) await gate; // the first one is slow
        applied.push(width);
      }
      return { windowId: 7 };
    });
    const resize = createWindowResizer(context);

    const first = resize(1440, 844);
    const second = resize(632, 828);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(applied).toEqual([]); // the second waits for the first, not past it

    open();
    await Promise.all([first, second]);
    expect(applied).toEqual([1440, 632]); // the last request wins
  });

  it("keeps working after a resize failed", async () => {
    let fail = true;
    const { context } = fakeChrome([tab("a")], async (_session, method) => {
      if (fail && method === "Browser.setWindowBounds") throw new Error("nope");
      return { windowId: 7 };
    });
    const resize = createWindowResizer(context);

    await expect(resize(800, 600)).rejects.toThrow("nope");
    fail = false;
    await expect(resize(800, 600)).resolves.toBeUndefined();
  });

  it("says so when the browser has no tab", async () => {
    const { context } = fakeChrome([]);
    await expect(createWindowResizer(context)(800, 600)).rejects.toThrow(
      "The browser has no open tab to resize.",
    );
  });
});

describe("page session tabs (shared profiles)", () => {
  const open = { viewportWidth: 1280, viewportHeight: 800 };

  /** A browser context of stub tabs named p0, p1, ...; `visible` is the tab in front. */
  function fakeContext() {
    const pages: { name: string; closed: boolean }[] = [];
    let visible = "";
    const context = {
      pages: () => pages.filter((p) => !p.closed),
      newPage: async () => make(),
    };
    function make() {
      const handlers: (() => void)[] = [];
      const page = {
        name: `p${pages.length}`,
        closed: false,
        once: (_event: string, handler: () => void) => void handlers.push(handler),
        context: () => context,
        url: () => page.name,
        bringToFront: vi.fn(async () => {}),
        evaluate: async () => (page.name === visible ? "visible" : "hidden"),
        close: async () => {
          page.closed = true;
          handlers.splice(0).forEach((handler) => handler());
        },
      };
      pages.push(page);
      return page as typeof page & Page;
    }
    return { make, context, show: (name: string) => (visible = name) };
  }
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it("moves an agent whose tab closed to a tab no other agent holds", async () => {
    const chrome = fakeContext();
    const first = pageSession(chrome.make(), open, { close: async () => {} });
    const second = await first.openTab!(); // p1, another agent's
    const spare = chrome.make(); // p2, a tab the owner opened
    await (chrome.context.pages()[0] as unknown as Page).close();
    await settle();
    expect(first.url()).toBe("p2");
    expect(second.url()).toBe("p1");

    await spare.close(); // nothing unclaimed is left: a fresh tab
    await settle();
    expect(first.url()).toBe("p3");
  });

  it("does not adopt another agent's tab the owner left in front", async () => {
    const chrome = fakeContext();
    const first = pageSession(chrome.make(), open, { close: async () => {} });
    const second = await first.openTab!();
    chrome.show("p1");
    await first.adoptActiveTab!();
    expect(first.url()).toBe("p0");
    await second.adoptActiveTab!();
    expect(second.url()).toBe("p1");
  });

  it("closes only its own tab, and brings it to the front on focus", async () => {
    const chrome = fakeContext();
    const browserClose = vi.fn(async () => {});
    const first = pageSession(chrome.make(), open, { close: browserClose });
    const second = await first.openTab!();
    await second.focus!();
    const [p0, p1] = chrome.context.pages() as unknown as { bringToFront: () => void }[];
    expect(p1!.bringToFront).toHaveBeenCalledTimes(1);
    expect(p0!.bringToFront).not.toHaveBeenCalled();

    await second.close();
    expect(chrome.context.pages().map((p) => (p as unknown as { name: string }).name)).toEqual([
      "p0",
    ]);
    expect(browserClose).not.toHaveBeenCalled();
  });
});

describe("page snapshot", () => {
  it("reads Playwright's AI accessibility snapshot", async () => {
    const seen: { selector?: string; mode?: string } = {};
    const page = {
      once: () => undefined,
      locator: (selector: string) => ({
        ariaSnapshot: async (options: { mode?: string }) => {
          seen.selector = selector;
          seen.mode = options.mode;
          return '- button "Sign in" [ref=e2]';
        },
      }),
    } as unknown as Page;
    const session = pageSession(
      page,
      { viewportWidth: 1, viewportHeight: 1 },
      { close: async () => {} },
    );
    expect(await session.snapshot()).toContain("[ref=e2]");
    expect(seen).toEqual({ selector: "body", mode: "ai" });
  });
});

describe("page interaction", () => {
  const open = { viewportWidth: 1280, viewportHeight: 800 };

  /** Records the Playwright calls click and type make against a stub element. */
  function harness(element: Record<string, unknown>) {
    const calls: string[] = [];
    const page = {
      once: () => undefined,
      url: () => "https://example.com/form",
      viewportSize: () => null,
      getByRef: (ref: string) => {
        calls.push(`ref:${ref}`);
        return {
          evaluate: async (fn: (el: unknown) => string) => {
            calls.push("eval");
            return fn(element);
          },
          click: async () => {
            calls.push("click");
          },
          fill: async (text: string) => {
            calls.push(`fill:${text}`);
          },
        };
      },
      mouse: {
        move: async (x: number, y: number) => {
          calls.push(`move:${x},${y}`);
        },
        wheel: async (_x: number, y: number) => {
          calls.push(`wheel:${y}`);
        },
      },
      keyboard: {
        type: async () => {
          calls.push("key-type");
        },
        insertText: async () => {
          calls.push("insert");
        },
        press: async () => {
          calls.push("press");
        },
      },
    } as unknown as Page;
    return { calls, session: pageSession(page, open, { close: async () => {} }) };
  }

  const input = (type = "text", extra: Record<string, unknown> = {}) => ({
    tagName: "INPUT",
    type,
    disabled: false,
    readOnly: false,
    isContentEditable: false,
    ...extra,
  });

  it("clicks a ref through Playwright", async () => {
    const { calls, session } = harness(input());
    expect(await session.click("e2")).toEqual({ url: "https://example.com/form" });
    expect(calls).toEqual(["ref:e2", "click"]);
  });

  it("clicks a text field, then fills the whole string in one call", async () => {
    const text = 'a whole sentence, "quoted"\nstill one insert';
    const { calls, session } = harness(input());
    expect(await session.type("e2", text)).toEqual({ url: "https://example.com/form" });
    expect(calls).toEqual(["ref:e2", "eval", "click", `fill:${text}`]);
  });

  it("fills a date field without opening the picker", async () => {
    const { calls, session } = harness(input("date"));
    expect(await session.type("e4", "2026-10-28")).toEqual({ url: "https://example.com/form" });
    expect(calls).toEqual(["ref:e4", "eval", "fill:2026-10-28"]);
  });

  it("fills a select without opening the dropdown", async () => {
    const { calls, session } = harness({
      tagName: "SELECT",
      disabled: false,
      isContentEditable: false,
    });
    expect(await session.type("e5", "Beta")).toEqual({ url: "https://example.com/form" });
    expect(calls).toEqual(["ref:e5", "eval", "fill:Beta"]);
  });

  it("accepts a frame ref and fills that field", async () => {
    const { calls, session } = harness(input());
    await session.type("f1e3", "inside");
    expect(calls).toEqual(["ref:f1e3", "eval", "click", "fill:inside"]);
  });

  it("does not click a control that cannot take text", async () => {
    const { calls, session } = harness({
      tagName: "BUTTON",
      disabled: false,
      isContentEditable: false,
    });
    await expect(session.type("e3", "hello")).rejects.toThrow("not an editable field");
    expect(calls).toEqual(["ref:e3", "eval"]);
  });

  it("rejects a ref that is not from a snapshot", async () => {
    const { calls, session } = harness(input());
    await expect(session.click("nope!")).rejects.toThrow("Invalid ref");
    expect(calls).toEqual([]);
  });

  it("parks the cursor in the page before a wheel scroll", async () => {
    const { calls, session } = harness(input());
    await session.scroll("down", 600);
    await session.scroll("up", 200);
    expect(calls).toEqual(["move:640,400", "wheel:600", "move:640,400", "wheel:-200"]);
  });
});
