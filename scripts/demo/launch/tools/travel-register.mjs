import { register } from "node:module";

register("./travel-hooks.mjs", import.meta.url);

const offset = Number(process.env.TRAVEL_CLOCK_OFFSET_MS) || 0;
if (offset) {
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
}
