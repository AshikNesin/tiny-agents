import { create } from "zustand";
import { peopleApi } from "../lib/people-api";

type ViewerRole = "owner" | "guest";

interface PeopleState {
  role: ViewerRole | null;
  load: () => Promise<void>;
}

export const usePeopleStore = create<PeopleState>((set) => ({
  role: null,
  async load() {
    try {
      const { guest } = await peopleApi.me();
      set({ role: guest ? "guest" : "owner" });
    } catch {
      set({ role: "owner" });
    }
  },
}));

export function useViewerRole(): ViewerRole | null {
  return usePeopleStore((s) => s.role);
}
