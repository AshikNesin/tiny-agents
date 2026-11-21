import { Hono } from "hono";
import { z } from "zod";
import { Boom } from "@groot/core/errors";
import type { AppEnv } from "@groot/core/types";
import { ok } from "@groot/core/utils/api-response.utils";
import { parseBody, parseStringParam, requireUser } from "@groot/core/utils/controller.utils";
import { claudeLoginShellLine } from "@tiny-agents/agent/claude-worker";
import {
  parseSessionName,
  SessionBusyError,
  SessionLimitError,
  SessionNotFoundError,
  TmuxMissingError,
  TerminalUnreachableError,
  type SessionName,
  type TerminalSessionRow,
  type TerminalStatus,
} from "@tiny-agents/sandbox/terminal";
import { issueTerminalTicket } from "./terminal.ws";
import { getTerminalService } from "./terminal.instance";
import type { Deleted } from "../../../shared/api/common";
import type {
  TerminalCreateBody,
  TerminalList,
  TerminalSession,
  TerminalStatusWire,
  TerminalTicket,
} from "../../../shared/api/terminal";

const router = new Hono<AppEnv>();

const createSchema: z.ZodType<TerminalCreateBody> = z.object({
  cols: z.number().int().min(2).max(500).optional(),
  rows: z.number().int().min(2).max(300).optional(),
  run: z.enum(["claude-login"]).optional(),
});

const RUN_LINES: Record<"claude-login", string> = {
  "claude-login": claudeLoginShellLine(),
};

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 34;

const nameParam = (raw: string): SessionName => {
  const parsed = parseSessionName(raw);
  if (!parsed) throw Boom.badRequest(`Invalid terminal session name: ${raw}`);
  return parsed;
};

function sessionDto(row: TerminalSessionRow): TerminalSession {
  return {
    name: row.name,
    process: row.foreground,
    attached: row.attached,
    createdAt: new Date(row.createdAt * 1000).toISOString(),
  };
}

const statusDto = (status: TerminalStatus): TerminalStatusWire =>
  status.kind === "tmux-missing"
    ? { kind: status.kind, installCommand: status.installCommand }
    : status.kind === "unreachable"
      ? { kind: status.kind, message: status.message }
      : { kind: status.kind };

router.get("/terminal/sessions", async (c) => {
  const { status, sessions } = await getTerminalService().list();
  return ok<TerminalList>(c, { status: statusDto(status), sessions: sessions.map(sessionDto) });
});

router.post("/terminal/sessions", async (c) => {
  const body = await parseBody(c, createSchema);
  try {
    const created = await getTerminalService().create(
      body.cols ?? DEFAULT_COLS,
      body.rows ?? DEFAULT_ROWS,
      body.run ? { typeLine: RUN_LINES[body.run] } : undefined,
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
    return ok<Deleted>(c, { deleted: true });
  } catch (error) {
    if (error instanceof SessionNotFoundError) throw Boom.notFound(error.message);
    if (error instanceof SessionBusyError) {
      throw Boom.conflict(error.message, { process: error.foreground });
    }
    throw mapServiceError(error);
  }
});

router.post("/terminal/sessions/:name/ticket", async (c) => {
  const name = nameParam(parseStringParam(c.req.param("name"), "name"));
  return ok<TerminalTicket>(c, {
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
