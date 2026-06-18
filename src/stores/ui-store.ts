import { create } from "zustand";

/**
 * UI-only state, replacing the transient bits the Android `SplitSyncViewModel`
 * held (validation errors + a global "syncing" flag). Server data itself lives
 * in the Firestore real-time hooks, not here.
 */
interface UiState {
  validationError: string | null;
  isSyncing: boolean;
  setValidationError: (msg: string | null) => void;
  clearValidationError: () => void;
  setSyncing: (syncing: boolean) => void;
  /** Wraps an async write so the global sync indicator reflects in-flight ops. */
  runSyncing: <T>(fn: () => Promise<T>) => Promise<T>;
}

export const useUiStore = create<UiState>((set) => ({
  validationError: null,
  isSyncing: false,
  setValidationError: (msg) => set({ validationError: msg }),
  clearValidationError: () => set({ validationError: null }),
  setSyncing: (syncing) => set({ isSyncing: syncing }),
  runSyncing: async (fn) => {
    set({ isSyncing: true });
    try {
      return await fn();
    } finally {
      set({ isSyncing: false });
    }
  },
}));
