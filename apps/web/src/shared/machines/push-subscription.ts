import { defineMachine } from "../state-machine";

/**
 * A phone's (or browser's) Web Push registration, `push_subscriptions.status`
 * (`push-subscriptions.store.ts` writes every move, issue #306).
 *
 *   register ─ active ─┬─ failing   (consecutive failed sends reached the limit)
 *                      └─ revoked   (the push service answered 404 or 410)
 *              failing ─┬─ active   (a send got through again)
 *                       └─ revoked
 *              revoked ─ active     (the device registered the same endpoint again)
 *
 * Every state but `revoked` is sent to: a failing device recovers by
 * receiving. Removing a device deletes its row.
 */
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
