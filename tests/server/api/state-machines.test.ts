import { describe, expect, expectTypeOf, it } from "vite-plus/test";
import type { AttachmentStatus, TaskRecord } from "@tiny-agents/agent";
import { defineMachine, type StateMachine } from "../../../apps/web/src/shared/state-machine";
import {
  extractionMachine,
  type ExtractStatus,
} from "../../../apps/web/src/shared/machines/extraction";
import { autofixMachine } from "../../../apps/web/src/shared/machines/autofix";
import { autofixPassMachine } from "../../../apps/web/src/shared/machines/autofix-pass";
import { handoffMachine } from "../../../apps/web/src/shared/machines/handoff";
import { memoryMachine } from "../../../apps/web/src/shared/machines/memory";
import { pushSubscriptionMachine } from "../../../apps/web/src/shared/machines/push-subscription";
import { routineRunMachine } from "../../../apps/web/src/shared/machines/routine-run";
import { runMachine } from "../../../apps/web/src/shared/machines/run";
import { taskMachine, type TaskStatus } from "../../../apps/web/src/shared/machines/task";
import { routineState } from "../../../apps/web/src/shared/machines/routine";

const MACHINES: StateMachine<string>[] = [
  routineRunMachine,
  memoryMachine,
  extractionMachine,
  taskMachine,
  handoffMachine,
  autofixMachine,
  autofixPassMachine,
  pushSubscriptionMachine,
  runMachine,
];

describe.each(MACHINES.map((machine) => [machine.name, machine] as const))(
  "the %s machine",
  (_, machine) => {
    it("names each state once and gives every state its moves", () => {
      expect(new Set(machine.states).size).toBe(machine.states.length);
      expect(Object.keys(machine.transitions).sort()).toEqual([...machine.states].sort());
    });

    it("moves only between its own states, never to the same state", () => {
      for (const [from, targets] of Object.entries(machine.transitions)) {
        for (const to of targets) {
          expect(machine.is(to)).toBe(true);
          expect(to).not.toBe(from);
        }
      }
      for (const state of machine.initial) expect(machine.is(state)).toBe(true);
    });

    it("reaches every state from a state a row starts in", () => {
      const seen = new Set<string>(machine.initial);
      const queue = [...machine.initial];
      while (queue.length > 0) {
        for (const next of machine.transitions[queue.shift()!]!) {
          if (seen.has(next)) continue;
          seen.add(next);
          queue.push(next);
        }
      }
      expect([...seen].sort()).toEqual([...machine.states].sort());
    });
  },
);

describe("defineMachine", () => {
  const machine = defineMachine({
    name: "door",
    states: ["open", "closed", "gone"],
    initial: ["closed"],
    transitions: { open: ["closed", "gone"], closed: ["open", "gone"], gone: [] },
  });

  it("derives terminal states, guards and narrowing from the graph", () => {
    expect(machine.terminal).toEqual(["gone"]);
    expect(machine.can("open", "closed")).toBe(true);
    expect(machine.can("gone", "open")).toBe(false);
    expect(machine.sourcesOf("gone")).toEqual(["open", "closed"]);
    expect(machine.sourcesOf("open")).toEqual(["closed"]);
    expect(machine.is("open")).toBe(true);
    expect(machine.is("ajar")).toBe(false);
    expect(machine.is(undefined)).toBe(false);
  });
});

describe("the app's machines", () => {
  it("settle a routine run only out of awaiting", () => {
    expect(routineRunMachine.terminal).toEqual([
      "succeeded",
      "blocked",
      "failed",
      "missed",
      "cancelled",
    ]);
    for (const to of routineRunMachine.terminal) {
      expect(routineRunMachine.sourcesOf(to)).toEqual(to === "missed" ? [] : ["awaiting"]);
    }
  });

  it("bring a tombstoned memory back only to active, and expire only an active one", () => {
    expect(memoryMachine.transitions.deleted).toEqual(["active"]);
    expect(memoryMachine.sourcesOf("expired")).toEqual(["active"]);
    expect(memoryMachine.sourcesOf("deleted")).toEqual([
      "active",
      "superseded",
      "archived",
      "expired",
    ]);
  });

  it("settle an extraction only while it is pending", () => {
    for (const to of extractionMachine.terminal) {
      expect(extractionMachine.sourcesOf(to)).toEqual(["pending"]);
    }
  });

  it("agree with the agent package's names for the same states", () => {
    expectTypeOf<ExtractStatus>().toEqualTypeOf<AttachmentStatus>();
    expectTypeOf<TaskStatus>().toEqualTypeOf<TaskRecord["status"]>();
  });
});

describe("routineState", () => {
  const base = { enabled: true, pausedReason: null, blockedStreak: 0, done: false };

  it.each([
    [{}, "scheduled"],
    [{ blockedStreak: 2 }, "struggling"],
    [{ enabled: false, pausedReason: "Blocked 3 runs in a row" }, "auto_paused"],
    [{ enabled: false, pausedReason: "Submit failed", done: true }, "auto_paused"],
    [{ enabled: false, done: true }, "done"],
    [{ enabled: false }, "paused"],
  ] as const)("%o is %s", (fields, state) => {
    expect(routineState({ ...base, ...fields })).toBe(state);
  });
});
