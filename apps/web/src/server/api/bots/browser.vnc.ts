/**
 * VNC bridge for the bot browser: the shared desktop bridge
 * (`desktop.vnc.ts`) pointed at the RFB server of the bot's browser on the
 * sandbox VM, through the SSH channel the browser session already owns.
 *
 * The viewer first calls the authenticated `POST /bots/:id/browser/vnc-ticket`
 * and presents the ticket here.
 */
import type { IncomingMessage, Server } from "node:http";
import type { BrowserTarget } from "@tiny-agents/agent";
import { getBrowserSessions } from "./browser.sessions";
import { attachVncBridge } from "./desktop.vnc";
import { createTicketStore } from "../ws/upgrade";

const PATH = /^\/api\/v1\/bots\/([^/]+)\/browser\/vnc$/;

interface Ticket {
  userId: number;
  botId: string;
  /** The bot's browser (its profile) and tab. */
  target: BrowserTarget;
}

const tickets = createTicketStore<Ticket>();

export function issueVncTicket(input: Ticket): string {
  return tickets.issue(input);
}

/** Single use: a redeemed (or expired) ticket is gone either way. */
export function redeemVncTicket(ticket: string, botId: string): Ticket | undefined {
  return tickets.redeem(ticket, (found) => found.botId === botId);
}

export function resetVncTicketsForTests(): void {
  tickets.reset();
}

export interface BrowserVncOptions {
  isOriginAllowed?: (req: IncomingMessage) => boolean;
}

/** Bridge `/bots/:id/browser/vnc`; returns a closer for graceful shutdown. */
export function attachBrowserVnc(
  httpServer: Server,
  options: BrowserVncOptions = {},
): { close(): void } {
  return attachVncBridge(httpServer, {
    path: PATH,
    tickets,
    scope: (ticket) => ticket.botId,
    kind: "browser",
    isOriginAllowed: options.isOriginAllowed,
    resolve(ticket) {
      const vnc = getBrowserSessions().get(ticket.target)?.session.vnc;
      if (!vnc) return undefined;
      return {
        openStream: vnc.openStream,
        // An open viewer counts as activity: the idle sweeper must not close
        // a browser someone is watching.
        touch() {
          const live = getBrowserSessions().get(ticket.target);
          if (live) live.lastActivity = Date.now();
        },
      };
    },
  });
}
