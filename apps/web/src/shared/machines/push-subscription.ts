import { defineMachine } from "../state-machine";

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
