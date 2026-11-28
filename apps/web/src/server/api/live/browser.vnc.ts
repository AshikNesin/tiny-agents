import type { IncomingMessage, Server } from "node:http";
import type { BrowserTarget } from "@tiny-agents/sandbox/browser";
import { getBrowserSessions } from "../bots/browser.sessions";
import { attachVncBridge, type VncTarget } from "./desktop.vnc";
import { createTicketStore } from "../ws/upgrade";

const PATH = /^\/api\/v1\/bots\/([^/]+)\/browser\/vnc$/;
const PAGE_PATH = /^\/api\/v1\/browser\/([^/]+)\/vnc$/;
const TICKET_RATE_LIMIT = 10;

interface Ticket {
  userId: number;
  botId: string;
  target: BrowserTarget;
  viewOnly?: boolean;
}

interface PageTicket {
  userId: number;
  profile: string;
  target: BrowserTarget;
}

const tickets = createTicketStore<Ticket>({
  perUserLimit: TICKET_RATE_LIMIT,
  limitMessage: "Too many VNC tickets requested. Wait a moment.",
});
const pageTickets = createTicketStore<PageTicket>({
  perUserLimit: TICKET_RATE_LIMIT,
  limitMessage: "Too many VNC tickets requested. Wait a moment.",
});

export function issueVncTicket(input: Ticket): string {
  return tickets.issue(input);
}

export function issueBrowserPageVncTicket(input: PageTicket): string {
  return pageTickets.issue(input);
}

export function redeemVncTicket(ticket: string, botId: string): Ticket | undefined {
  return tickets.redeem(ticket, (found) => found.botId === botId);
}

export function redeemBrowserPageVncTicket(
  ticket: string,
  profile: string,
): PageTicket | undefined {
  return pageTickets.redeem(ticket, (found) => found.profile === profile);
}

export function resetVncTicketsForTests(): void {
  tickets.reset();
  pageTickets.reset();
}

function browserTarget(target: BrowserTarget): VncTarget | undefined {
  const vnc = getBrowserSessions().get(target)?.session.vnc;
  if (!vnc) return undefined;
  return {
    openStream: vnc.openStream,
    touch() {
      const live = getBrowserSessions().get(target);
      if (live) live.lastActivity = Date.now();
    },
    ownerInput: () => getBrowserSessions().ownerInput(target.profile),
  };
}

export interface BrowserVncOptions {
  isOriginAllowed?: (req: IncomingMessage) => boolean;
}

export function attachBrowserVnc(
  httpServer: Server,
  options: BrowserVncOptions = {},
): { close(): void } {
  const bots = attachVncBridge(httpServer, {
    path: PATH,
    tickets,
    scope: (ticket) => ticket.botId,
    kind: "browser",
    isOriginAllowed: options.isOriginAllowed,
    resolve: (ticket) => browserTarget(ticket.target),
  });
  const page = attachVncBridge(httpServer, {
    path: PAGE_PATH,
    tickets: pageTickets,
    scope: (ticket) => ticket.profile,
    kind: "browser",
    isOriginAllowed: options.isOriginAllowed,
    resolve: (ticket) => browserTarget(ticket.target),
  });
  return {
    close() {
      bots.close();
      page.close();
    },
  };
}
