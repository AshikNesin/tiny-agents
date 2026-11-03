/**
 * Whether the signed-in account is a guest (issue #145): someone the owner
 * added to chat with the bots shared with them and to use Code. A guest's
 * shell shows only those; the server refuses everything else anyway.
 * `null` until `/people/me` answers.
 */
import { create } from "zustand";
import { peopleApi } from "../lib/people-api";

interface PeopleState {
  guest: boolean | null;
  load: () => Promise<void>;
}

export const usePeopleStore = create<PeopleState>((set) => ({
  guest: null,
  async load() {
    try {
      const { guest } = await peopleApi.me();
      set({ guest });
    } catch {
      // Unknown counts as owner for the shell: the server still guards every route.
      set({ guest: false });
    }
  },
}));

/** True for a guest's shell; false for the owner (and while loading). */
export function useIsGuest(): boolean {
  return usePeopleStore((s) => s.guest === true);
}
