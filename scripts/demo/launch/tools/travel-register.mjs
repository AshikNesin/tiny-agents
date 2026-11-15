// Preload for the travel staging instance (stage-travel.mjs starts the server
// with `tsx --import` this file). Staging only: product code is untouched.
//
// 1. Points pi-ai's fake provider at travel-director.mjs, so the fake model
//    says the CAST.md lines and makes the CAST tool calls.
// 2. Runs the server's clock at a fixed offset from real time, read once from
//    TRAVEL_CLOCK_OFFSET_MS, so the instance starts just before 7:00 AM IST and
//    the "Morning fare check" routine fires on its real schedule.
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
