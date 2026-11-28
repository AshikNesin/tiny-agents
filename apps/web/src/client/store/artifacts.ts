import { create } from "zustand";

interface OpenArtifact {
  artifactId: string;
  seq: number;
}

interface ArtifactPanelState {
  open: OpenArtifact | null;
  show: (artifact: OpenArtifact) => void;
  close: () => void;
}

export const useArtifactPanel = create<ArtifactPanelState>((set) => ({
  open: null,
  show: (artifact) => set({ open: artifact }),
  close: () => set({ open: null }),
}));
