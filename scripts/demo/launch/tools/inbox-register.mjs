// Preload for the inbox staging instance (stage-inbox.mjs starts the server
// with `tsx --import` this file). Staging only: product code is untouched.
//
// 1. Points pi-ai's fake provider at inbox-director.mjs, so the fake model
//    says the CAST.md lines and makes the CAST tool calls.
// 2. Lets the staging script set the server's clock back while it seeds a
//    chat, so the bots' last-activity times differ (12m, 1h, 3h, 5h) without
//    touching a database. The offset in milliseconds is read from the file
//    named by INBOX_CLOCK_FILE; an empty or missing file means real time.
import { register } from "node:module";
import { readFileSync } from "node:fs";

register("./inbox-hooks.mjs", import.meta.url);

const file = process.env.INBOX_CLOCK_FILE;
if (file) {
  let offset = 0;
  const read = () => {
    try {
      offset = Number(readFileSync(file, "utf8").trim()) || 0;
    } catch {
      offset = 0;
    }
  };
  read();
  setInterval(read, 100).unref();
  const RealDate = Date;
  class ShiftedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(RealDate.now() + offset);
      else super(...args);
    }
    static now() {
      return RealDate.now() + offset;
    }
  }
  globalThis.Date = ShiftedDate;
  // The staging script reads this back to know a new offset is in effect.
  globalThis.__inboxClockOffset = () => offset;
}
