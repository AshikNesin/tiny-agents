/**
 * Today's date in every bot's prompt, in the owner's timezone, so a bot
 * never has to call a tool to know what day it is. Day resolution on
 * purpose: the section re-renders on every send, and a line that changed
 * every minute would defeat the provider's prompt cache for the whole
 * conversation. Relative reminders ("in 30 minutes") are resolved by the
 * routines tool itself.
 */
import { section } from "@earendil-works/pi-durable";
import type { Capability } from "../capabilities";
import { defineToolkit } from "../toolkit";

export interface TodayOptions {
  /** IANA zone for the date. Default: the server's zone. */
  timeZone?: string;
  /** Clock override (tests). */
  now?: () => Date;
}

export function createTodayCapability(options: TodayOptions = {}): Capability {
  const now = options.now ?? (() => new Date());
  const timeZone = options.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  // The configured name, not ICU's resolved one (which reports Asia/Kolkata
  // as the old alias Asia/Calcutta); an unknown zone falls back to UTC.
  let zone = timeZone;
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat("en-GB", { timeZone, dateStyle: "full" });
  } catch {
    zone = "UTC";
    format = new Intl.DateTimeFormat("en-GB", { timeZone: zone, dateStyle: "full" });
  }

  return defineToolkit({
    id: "today",
    name: "Today",
    description: "Today's date in the owner's timezone",
    auto: true,
    sections: [section("today", async () => `Today is ${format.format(now())} (${zone}).`)],
  });
}
