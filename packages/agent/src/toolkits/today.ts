import { section } from "@earendil-works/pi-durable";
import type { Capability } from "../capabilities";
import { defineToolkit } from "../toolkit";

export interface TodayOptions {
  timeZone?: string;
  now?: () => Date;
}

export function createTodayCapability(options: TodayOptions = {}): Capability {
  const now = options.now ?? (() => new Date());
  const timeZone = options.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
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
