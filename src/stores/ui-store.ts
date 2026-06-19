import { create } from "zustand";

/**
 * UI-only state, replacing the transient bits the Android `SplitSyncViewModel`
 * held (validation errors + a global "syncing" flag). Server data itself lives
 * in the Firestore real-time hooks, not here.
 */
interface UiState {
  validationError: string | null;
  isSyncing: boolean;
  statusMessage: string | null;
  setValidationError: (msg: string | null) => void;
  clearValidationError: () => void;
  setSyncing: (syncing: boolean) => void;
  setStatusMessage: (msg: string | null) => void;
  /** Wraps an async write so the global sync indicator reflects in-flight ops. */
  runSyncing: <T>(
    fn: () => Promise<T>,
    messages?: {
      loading?: string;
      success?: string;
      error?: string;
    }
  ) => Promise<T>;
}

export const useUiStore = create<UiState>((set) => ({
  validationError: null,
  isSyncing: false,
  statusMessage: null,
  setValidationError: (msg) => set({ validationError: msg }),
  clearValidationError: () => set({ validationError: null }),
  setSyncing: (syncing) => set({ isSyncing: syncing }),
  setStatusMessage: (msg) => set({ statusMessage: msg }),
  runSyncing: async (fn, messages) => {
    set({
      isSyncing: true,
      statusMessage: messages?.loading ?? "Saving changes...",
    });
    try {
      const result = await fn();
      set({ statusMessage: messages?.success ?? "Changes saved." });
      return result;
    } catch (err) {
      set({ statusMessage: messages?.error ?? "Could not save changes." });
      throw err;
    } finally {
      set({ isSyncing: false });
    }
  },
}));
