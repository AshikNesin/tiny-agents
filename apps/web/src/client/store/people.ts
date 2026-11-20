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
      set({ guest: false });
    }
  },
}));

export function useIsGuest(): boolean {
  return usePeopleStore((s) => s.guest === true);
}
