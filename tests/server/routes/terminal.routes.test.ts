import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  resetTerminalTicketsForTests,
  redeemTerminalTicket,
} from "../../../apps/web/src/server/api/terminal/terminal.ws";
import { setTerminalServiceForTests } from "../../../apps/web/src/server/api/terminal/terminal.instance";
import {
  SessionBusyError,
  SessionLimitError,
  SessionNotFoundError,
  TerminalUnreachableError,
  type TerminalService,
  type TerminalSessionRow,
} from "../../../packages/sandbox/src/terminal/terminal";
import { api, createTestApp, type TestApp } from "../helpers";
import { authToken } from "../fixtures";

const token = await authToken("t@t.dev");

interface Envelope {
  success: boolean;
  data?: any;
  error?: { code: string; message: string; details?: unknown };
}

async function call(
  app: TestApp,
  method: string,
  path: string,
  options: { json?: unknown; auth?: boolean } = {},
): Promise<{ status: number; body: Envelope }> {
  const response = await api(app, path, {
    method,
    ...(options.json !== undefined ? { json: options.json } : {}),
    ...(options.auth === false ? {} : { token }),
  });
  return { status: response.status, body: response.body as Envelope };
}

const row = (n: number, over: Partial<TerminalSessionRow> = {}): TerminalSessionRow => ({
  name: `ta-term-${n}` as TerminalSessionRow["name"],
  foreground: "bash",
  attached: false,
  createdAt: 1792605227,
  ...over,
});

function fakeService(overrides: Partial<TerminalService> = {}) {
  const calls: string[] = [];
  let sessions: TerminalSessionRow[] = [row(1)];
  const svc: TerminalService = {
    status: async () => ({ kind: "ready" }),
    list: async () => ({ status: { kind: "ready" }, sessions }),
    create: async (cols, rows, options) => {
      calls.push(`create ${cols}x${rows}${options?.typeLine ? ` typing ${options.typeLine}` : ""}`);
      sessions = [...sessions, row(sessions.length + 1)];
      return sessions.at(-1)!;
    },
    kill: async (name, options) => {
      calls.push(`kill ${name}${options?.force ? " force" : ""}`);
    },
    has: async (name) => {
      calls.push(`has ${name}`);
      return sessions.some((s) => s.name === name);
    },
    attach: async () => {
      throw new Error("not used by route tests");
    },
    ...overrides,
  };
  return {
    svc,
    calls,
    set sessions(next: TerminalSessionRow[]) {
      sessions = next;
    },
  };
}

describe("terminal routes", () => {
  let app: TestApp;
  let fake: ReturnType<typeof fakeService>;

  beforeEach(() => {
    fake = fakeService();
    setTerminalServiceForTests(fake.svc);
    resetTerminalTicketsForTests();
    app = createTestApp();
  });
  afterEach(() => setTerminalServiceForTests(undefined));

  it("requires a JWT", async () => {
    const res = await call(app, "GET", "/api/v1/terminal/sessions", { auth: false });
    expect(res.status).toBe(401);
  });

  it("lists sessions with the status envelope", async () => {
    const res = await call(app, "GET", "/api/v1/terminal/sessions");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: {
        status: { kind: "ready" },
        sessions: [
          {
            name: "ta-term-1",
            process: "bash",
            attached: false,
            createdAt: new Date(1792605227 * 1000).toISOString(),
          },
        ],
      },
    });
  });

  it("surfaces tmux-missing with the install command", async () => {
    setTerminalServiceForTests({
      ...fake.svc,
      list: async () => ({
        status: { kind: "tmux-missing", installCommand: "sudo apt-get install -y tmux" },
        sessions: [],
      }),
    });
    const res = await call(app, "GET", "/api/v1/terminal/sessions");
    expect(res.body.data.status).toEqual({
      kind: "tmux-missing",
      installCommand: "sudo apt-get install -y tmux",
    });
  });

  it("creates with default 120x34, accepts {} and clamped overrides, answers 201", async () => {
    const empty = await call(app, "POST", "/api/v1/terminal/sessions", { json: {} });
    expect(empty.status).toBe(201);
    expect(empty.body.data.name).toBe("ta-term-2");
    expect(fake.calls).toContain("create 120x34");

    const sized = await call(app, "POST", "/api/v1/terminal/sessions", {
      json: { cols: 200, rows: 50 },
    });
    expect(sized.status).toBe(201);
    expect(fake.calls).toContain("create 200x50");

    const clamped = await call(app, "POST", "/api/v1/terminal/sessions", {
      json: { cols: 9999, rows: 1 },
    });
    expect(clamped.status).toBe(400);
  });

  it("opens a Claude sign-in tab from a preset, never from free text", async () => {
    const login = await call(app, "POST", "/api/v1/terminal/sessions", {
      json: { run: "claude-login" },
    });
    expect(login.status).toBe(201);
    expect(fake.calls.at(-1)).toMatch(/^create 120x34 typing .*claude auth login$/);

    const other = await call(app, "POST", "/api/v1/terminal/sessions", {
      json: { run: "rm -rf ~" },
    });
    expect(other.status).toBe(400);
  });

  it("answers 409 at the tab cap", async () => {
    setTerminalServiceForTests({
      ...fake.svc,
      create: async () => {
        throw new SessionLimitError();
      },
    });
    const res = await call(app, "POST", "/api/v1/terminal/sessions", { json: {} });
    expect(res.status).toBe(409);
  });

  it("answers 503 when the sandbox is unreachable", async () => {
    setTerminalServiceForTests({
      ...fake.svc,
      create: async () => {
        throw new TerminalUnreachableError("Cannot reach the sandbox (down).");
      },
    });
    const res = await call(app, "POST", "/api/v1/terminal/sessions", { json: {} });
    expect(res.status).toBe(503);
    expect(res.body.error?.message).toContain("Cannot reach the sandbox");
  });

  it("deletes a session, honors ?force=1, 404s unknown names", async () => {
    const ok = await call(app, "DELETE", "/api/v1/terminal/sessions/ta-term-1");
    expect(ok.status).toBe(200);
    expect(ok.body.data).toEqual({ deleted: true });
    expect(fake.calls).toContain("kill ta-term-1");

    const forced = await call(app, "DELETE", "/api/v1/terminal/sessions/ta-term-1?force=1");
    expect(forced.status).toBe(200);
    expect(fake.calls).toContain("kill ta-term-1 force");

    setTerminalServiceForTests({
      ...fake.svc,
      kill: async (name) => {
        throw new SessionNotFoundError(name);
      },
    });
    const missing = await call(app, "DELETE", "/api/v1/terminal/sessions/ta-term-1");
    expect(missing.status).toBe(404);
  });

  it("answers 409 with error.details.process when the pane is busy", async () => {
    setTerminalServiceForTests({
      ...fake.svc,
      kill: async () => {
        throw new SessionBusyError("ta-term-1", "vim");
      },
    });
    const res = await call(app, "DELETE", "/api/v1/terminal/sessions/ta-term-1");
    expect(res.status).toBe(409);
    expect(res.body.error?.message).toContain("vim");
    expect(res.body.error?.details).toEqual({ process: "vim" });
  });

  it("mints a single-use ticket bound to name+user, with no SSH round trip", async () => {
    const minted = await call(app, "POST", "/api/v1/terminal/sessions/ta-term-1/ticket");
    expect(minted.status).toBe(200);
    const ticket = new URL(minted.body.data.path, "http://x").searchParams.get("ticket")!;
    expect(minted.body.data.path).toBe(`/api/v1/terminal/ws/ta-term-1?ticket=${ticket}`);
    expect(redeemTerminalTicket(ticket, "ta-term-1" as never)).toMatchObject({
      userId: 1,
      name: "ta-term-1",
    });
    expect(redeemTerminalTicket(ticket, "ta-term-1" as never)).toBeUndefined();

    const unknown = await call(app, "POST", "/api/v1/terminal/sessions/ta-term-9/ticket");
    expect(unknown.status).toBe(200);
    expect(fake.calls.filter((call) => call.startsWith("has"))).toEqual([]);

    const foreign = await call(app, "POST", "/api/v1/terminal/sessions/notours/ticket");
    expect(foreign.status).toBe(400);
  });

  it("rate-limits ticket mints with 429, never 409", async () => {
    for (let i = 0; i < 30; i++) {
      await call(app, "POST", "/api/v1/terminal/sessions/ta-term-1/ticket");
    }
    const limited = await call(app, "POST", "/api/v1/terminal/sessions/ta-term-1/ticket");
    expect(limited.status).toBe(429);
  });
});
