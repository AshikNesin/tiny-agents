import { defineMachine } from "../state-machine";
import type { StatusLabels } from "./status-label";

export const pushSubscriptionMachine = defineMachine({
  name: "push subscription",
  states: ["active", "failing", "revoked"],
  initial: ["active"],
  transitions: {
    active: ["failing", "revoked"],
    failing: ["active", "revoked"],
    revoked: ["active"],
  },
});

export type PushSubscriptionStatus = (typeof pushSubscriptionMachine.states)[number];

export const pushSubscriptionLabels: StatusLabels<PushSubscriptionStatus> = {
  active: { label: "Receiving", tone: "success" },
  failing: { label: "Failing", tone: "warning" },
  revoked: { label: "Signed out", tone: "danger" },
};
