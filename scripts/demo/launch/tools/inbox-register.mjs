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
  globalThis.__inboxClockOffset = () => offset;
}
