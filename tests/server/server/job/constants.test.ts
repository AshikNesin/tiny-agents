import { describe, it, expect } from "vite-plus/test";
import {
  isValidJobState,
  JOB_STATES,
  isReservedQueueName,
  RESERVED_QUEUE_NAMES,
} from "@groot/jobs/server/constants";

// The state set itself is exercised by the adapter integration tests; what is
// worth pinning here is the *contract of the predicates*: exact-match,
// case-sensitive membership.

describe("isValidJobState", () => {
  it.each(Object.values(JOB_STATES))("returns true for valid state: %s", (state) => {
    expect(isValidJobState(state)).toBe(true);
  });

  it("returns false for unknown state", () => {
    expect(isValidJobState("pending")).toBe(false);
    expect(isValidJobState("")).toBe(false);
    expect(isValidJobState("CREATED")).toBe(false); // case-sensitive
  });
});

describe("isReservedQueueName", () => {
  it.each(RESERVED_QUEUE_NAMES)("returns true for reserved name: %s", (name) => {
    expect(isReservedQueueName(name)).toBe(true);
  });

  it("returns false for normal queue names", () => {
    expect(isReservedQueueName("todo-cleanup")).toBe(false);
    expect(isReservedQueueName("my-custom-job")).toBe(false);
  });
});
