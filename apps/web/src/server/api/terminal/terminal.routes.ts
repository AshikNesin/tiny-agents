/**
 * Terminal REST routes (issue #28): tab lifecycle over the TerminalService.
 * All JWT-protected, mounted under /api/v1/terminal. Bytes never appear
 * here — attach traffic goes through the ticketed WebSocket bridge in
 * `terminal.ws.ts`.
 */
import { Hono } from "hono";
import { z } from "zod";
import { Boom } from "@groot/core/errors";
import type { AppEnv } from "@groot/core/types";
import { ok } from "@groot/core/utils/api-response.utils";
import { parseBody, parseStringParam, requireUser } from "@groot/core/utils/controller.utils";
import {
  parseSessionName,
  type SessionName,
  type TerminalSessionRow,
  type TerminalStatus,
} from "@tiny-agents/agent";
import {
  SessionBusyError,
  SessionLimitError,
  SessionNotFoundError,
  TmuxMissingError,
  TerminalUnreachableError,
} from "@tiny-agents/agent";
import { issueTerminalTicket } from "./terminal.ws";
import { getTerminalService } from "./terminal.instance";

const router = new Hono<AppEnv>();

// xterm.js is legible from 2x2 up; the ceilings bound a hostile client.
const createSchema = z.object({
  cols: z.number().int().min(2).max(500).optional(),
  rows: z.number().int().min(2).max(300).optional(),
});

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 34;

const nameParam = (raw: string): SessionName => {
  const parsed = parseSessionName(raw);
  if (!parsed) throw Boom.badRequest(`Invalid terminal session name: ${raw}`);
  return parsed;
};

/** One tab as the client sees it (the frozen wire DTO). */
function sessionDto(row: TerminalSessionRow) {
  return {
    name: row.name,
    process: row.foreground,
    attached: row.attached,
    createdAt: new Date(row.createdAt * 1000).toISOString(),
  };
}

const statusDto = (status: TerminalStatus) =>
  status.kind === "tmux-missing"
    ? { kind: status.kind, installCommand: status.installCommand }
    : status.kind === "unreachable"
      ? { kind: status.kind, message: status.message }
      : { kind: status.kind };

router.get("/terminal/sessions", async (c) => {
  const { status, sessions } = await getTerminalService().list();
  return ok(c, { status: statusDto(status), sessions: sessions.map(sessionDto) });
});

router.post("/terminal/sessions", async (c) => {
  const body = await parseBody(c, createSchema);
  try {
    const created = await getTerminalService().create(
      body.cols ?? DEFAULT_COLS,
      body.rows ?? DEFAULT_ROWS,
    );
    return ok(c, sessionDto(created), 201);
  } catch (error) {
    throw mapCreateError(error);
  }
});

router.delete("/terminal/sessions/:name", async (c) => {
  const name = nameParam(parseStringParam(c.req.param("name"), "name"));
  const force = c.req.query("force") === "1";
  try {
    await getTerminalService().kill(name, { force });
    return ok(c, { deleted: true });
  } catch (error) {
    if (error instanceof SessionNotFoundError) throw Boom.notFound(error.message);
    if (error instanceof SessionBusyError) {
      // The confirm dialog reads the process name from error.details.process.
      throw Boom.conflict(error.message, { process: error.foreground });
    }
    throw mapServiceError(error);
  }
});

// No has-session pre-check: it cost a full SSH round trip before the socket
// could open (issue #84). Attaching to a missing tab ends the pty at once,
// tmux prints why, and the bridge closes 1000, so the client stops.
router.post("/terminal/sessions/:name/ticket", async (c) => {
  const name = nameParam(parseStringParam(c.req.param("name"), "name"));
  return ok(c, {
    path: `/api/v1/terminal/ws/${encodeURIComponent(name)}?ticket=${issueTerminalTicket({
      userId: requireUser(c).userId,
      name,
    })}`,
  });
});

function mapCreateError(error: unknown): unknown {
  if (error instanceof SessionLimitError) throw Boom.conflict(error.message);
  if (error instanceof TmuxMissingError) {
    throw Boom.unavailable(`tmux is not installed on the sandbox. Run: ${error.installCommand}`, {
      installCommand: error.installCommand,
    });
  }
  return mapServiceError(error);
}

function mapServiceError(error: unknown): unknown {
  if (error instanceof TerminalUnreachableError) {
    throw Boom.unavailable(error.message);
  }
  throw error;
}

export default router;
