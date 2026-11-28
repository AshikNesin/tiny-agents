import type { IncomingMessage, Server } from "node:http";
import { getComputerSessions } from "../bots/computer.sessions";
import { attachVncBridge, type VncTarget } from "./desktop.vnc";
import { createTicketStore } from "../ws/upgrade";

const BOT_PATH = /^\/api\/v1\/bots\/([^/]+)\/computer\/vnc$/;
const PAGE_PATH = /^\/api\/v1\/computer\/([^/]+)\/vnc$/;
const TICKET_RATE_LIMIT = 10;

interface BotTicket {
  userId: number;
  botId: string;
  profile: string;
  viewOnly?: boolean;
}

interface PageTicket {
  userId: number;
  profile: string;
}

const botTickets = createTicketStore<BotTicket>({
  perUserLimit: TICKET_RATE_LIMIT,
  limitMessage: "Too many VNC tickets requested. Wait a moment.",
});
const pageTickets = createTicketStore<PageTicket>({
  perUserLimit: TICKET_RATE_LIMIT,
  limitMessage: "Too many VNC tickets requested. Wait a moment.",
});

export function issueComputerVncTicket(input: BotTicket): string {
  return botTickets.issue(input);
}

export function issueDesktopVncTicket(input: PageTicket): string {
  return pageTickets.issue(input);
}

export function resetComputerVncTicketsForTests(): void {
  botTickets.reset();
  pageTickets.reset();
}

function desktopTarget(profile: string): VncTarget | undefined {
  const vnc = getComputerSessions()?.get(profile)?.desktop.vnc;
  if (!vnc) return undefined;
  return {
    openStream: () => vnc.openStream(),
    touch() {
      const live = getComputerSessions()?.get(profile);
      if (live) live.lastActivity = Date.now();
    },
    ownerInput: () => getComputerSessions()?.ownerInput(profile),
  };
}

export function attachComputerVnc(
  httpServer: Server,
  options: { isOriginAllowed?: (req: IncomingMessage) => boolean } = {},
): { close(): void } {
  const bots = attachVncBridge(httpServer, {
    path: BOT_PATH,
    tickets: botTickets,
    scope: (ticket) => ticket.botId,
    kind: "computer",
    isOriginAllowed: options.isOriginAllowed,
    resolve: (ticket) => desktopTarget(ticket.profile),
  });
  const page = attachVncBridge(httpServer, {
    path: PAGE_PATH,
    tickets: pageTickets,
    scope: (ticket) => ticket.profile,
    kind: "computer",
    isOriginAllowed: options.isOriginAllowed,
    resolve: (ticket) => desktopTarget(ticket.profile),
  });
  return {
    close() {
      bots.close();
      page.close();
    },
  };
}
