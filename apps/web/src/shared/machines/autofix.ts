import { defineMachine } from "../state-machine";
import type { StatusLabels } from "./status-label";

export const autofixMachine = defineMachine({
  name: "code PR Auto-fix",
  states: ["watching", "fixing", "needs_input", "green", "paused", "merged", "off"],
  initial: ["watching", "off"],
  transitions: {
    watching: ["fixing", "green", "paused", "needs_input", "merged", "off"],
    fixing: ["watching", "needs_input", "merged", "off"],
    needs_input: ["watching", "merged", "off"],
    green: ["watching", "merged", "off"],
    paused: ["watching", "merged", "off"],
    merged: [],
    off: ["watching", "merged"],
  },
});

export type AutofixStatus = (typeof autofixMachine.states)[number];

export const autofixLabels: StatusLabels<AutofixStatus> = {
  watching: { label: "Watching", tone: "neutral" },
  fixing: { label: "Fixing", tone: "strong" },
  needs_input: { label: "Needs you", tone: "warning" },
  green: { label: "Checks pass", tone: "success" },
  paused: { label: "Paused", tone: "neutral" },
  merged: { label: "Merged", tone: "neutral" },
  off: { label: "Off", tone: "neutral" },
};
