import { defineMachine } from "../state-machine";

/**
 * An uploaded file's text extraction, `uploads.extract_status`
 * (`uploads.extraction.ts` writes every move). Images stay `none`.
 *
 *   upload ─┬─ unsupported / failed   (settled at upload: nothing to read)
 *           └─ pending ─┬─ ready
 *                       ├─ failed
 *                       └─ unsupported
 *   none (uploaded before extraction existed) ─ pending, the first time a bot asks
 *
 * A worker only settles a row that is still `pending`.
 */
export const extractionMachine = defineMachine({
  name: "upload extraction",
  states: ["none", "pending", "ready", "failed", "unsupported"],
  initial: ["none", "pending", "failed", "unsupported"],
  transitions: {
    none: ["pending"],
    pending: ["ready", "failed", "unsupported"],
    ready: [],
    failed: [],
    unsupported: [],
  },
});

export type ExtractStatus = (typeof extractionMachine.states)[number];
