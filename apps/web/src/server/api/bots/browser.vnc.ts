/**
 * VNC bridges for the browser: the shared desktop bridge (`desktop.vnc.ts`)
 * pointed at the RFB server of a browser on the sandbox VM, through the SSH
 * channel the browser session already owns, on two paths:
 * - `/bots/:id/browser/vnc`, the chat's Browser panel, after
 *   `POST /bots/:id/browser/vnc-ticket`;
 * - `/browser/:profile/vnc`, the Browser page (issue #160), after
 *   `POST /browser/:profile/vnc-ticket`.
 * Each path has its own ticket store, so a ticket only opens the path it was
 * minted for.
 */
import type { IncomingMessage, Server } from "node:http";
import type { BrowserTarget } from "@tiny-agents/sandbox/browser";
import { getBrowserSessions } from "./browser.sessions";
import { attachVncBridge, type VncTarget } from "./desktop.vnc";
import { createTicketStore } from "../ws/upgrade";

const PATH = /^\/api\/v1\/bots\/([^/]+)\/browser\/vnc$/;
const PAGE_PATH = /^\/api\/v1\/browser\/([^/]+)\/vnc$/;

interface Ticket {
  userId: number;
  botId: string;
  /** The bot's browser (its profile) and tab. */
  target: BrowserTarget;
  /** A guest's ticket: watch only (S2). */
  viewOnly?: boolean;
}

interface PageTicket {
  userId: number;
  /** The browser profile the Browser page streams. */
  profile: string;
  /** The owner's tab in it. */
  target: BrowserTarget;
}

const tickets = createTicketStore<Ticket>();
const pageTickets = createTicketStore<PageTicket>();

export function issueVncTicket(input: Ticket): string {
  return tickets.issue(input);
}

/** A ticket for the Browser page's viewer of one profile's browser. */
export function issueBrowserPageVncTicket(input: PageTicket): string {
  return pageTickets.issue(input);
}

/** Single use: a redeemed (or expired) ticket is gone either way. */
export function redeemVncTicket(ticket: string, botId: string): Ticket | undefined {
  return tickets.redeem(ticket, (found) => found.botId === botId);
}

/** Single use, and only for the profile it was minted for. */
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

/** The live browser of a target's profile, as the bridge streams it. */
function browserTarget(target: BrowserTarget): VncTarget | undefined {
  const vnc = getBrowserSessions().get(target)?.session.vnc;
  if (!vnc) return undefined;
  return {
    openStream: vnc.openStream,
    // An open viewer counts as activity: the idle sweeper must not close
    // a browser someone is watching.
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

/** Bridge both browser paths; returns a closer for graceful shutdown. */
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
