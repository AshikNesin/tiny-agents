import { describe, expect, it } from "vite-plus/test";
import {
  JOB_STATES,
  VALID_JOB_STATES,
  isReservedQueueName,
  isValidJobState,
} from "@groot/jobs/server/constants";

describe("job constants", () => {
  it("exposes the five states", () => {
    expect(VALID_JOB_STATES).toEqual(["created", "active", "completed", "failed", "cancelled"]);
    expect(isValidJobState(JOB_STATES.ACTIVE)).toBe(true);
    expect(isValidJobState("retry")).toBe(false);
  });

  it("reserves dashboard path segments", () => {
    for (const name of ["schedule", "stats", "available", "state", "status", "bulk-rerun"]) {
      expect(isReservedQueueName(name)).toBe(true);
    }
    expect(isReservedQueueName("todo-cleanup")).toBe(false);
  });
});
