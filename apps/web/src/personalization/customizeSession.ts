import { useEffect } from "react";
import { create } from "zustand";

export type CustomizeSurface = "composer" | "thread-rows" | "thread-details";

interface CustomizeSessionState {
  available: Readonly<Record<CustomizeSurface, boolean>>;
  setAvailable: (surface: CustomizeSurface, available: boolean) => void;
  pendingOpen: CustomizeSurface | null;
  /** Replaces any earlier pending request. */
  requestOpen: (surface: CustomizeSurface) => void;
  /** True once when pendingOpen === surface, then clears it. */
  consumePendingOpen: (surface: CustomizeSurface) => boolean;
}

const INITIAL_AVAILABILITY: Record<CustomizeSurface, boolean> = {
  composer: false,
  "thread-rows": false,
  "thread-details": false,
};

/**
 * Which customize editors are mounted and which one a command or palette
 * asked to open. It holds no drafts: each surface keeps its own draft in
 * local component state, as the thread details panel does.
 */
export const useCustomizeSession = create<CustomizeSessionState>()((set) => ({
  available: INITIAL_AVAILABILITY,
  setAvailable: (surface, available) =>
    set((state) => {
      if (state.available[surface] === available) return state;
      return { available: { ...state.available, [surface]: available } };
    }),
  pendingOpen: null,
  requestOpen: (surface) => set({ pendingOpen: surface }),
  consumePendingOpen: (surface) => {
    let consumed = false;
    set((state) => {
      if (state.pendingOpen !== surface) return state;
      consumed = true;
      return { pendingOpen: null };
    });
    return consumed;
  },
}));

/** Hook for surfaces: register availability on mount, unregister on unmount. */
export function useRegisterCustomizeSurface(surface: CustomizeSurface, available = true): void {
  useEffect(() => {
    useCustomizeSession.getState().setAvailable(surface, available);
    return () => {
      useCustomizeSession.getState().setAvailable(surface, false);
    };
  }, [surface, available]);
}
