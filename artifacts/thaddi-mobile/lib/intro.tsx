import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "thaddi_intro_seen";

type IntroContextValue = {
  /** True once the persisted flag has been read (avoid intro/sign-in flicker). */
  ready: boolean;
  /** True when the launch intro has already been completed/skipped. */
  hasSeenIntro: boolean;
  /** Mark the intro as seen — updates shared state immediately, persists async. */
  markIntroSeen: () => void;
};

const IntroContext = createContext<IntroContextValue | undefined>(undefined);

/**
 * Holds the "has the user seen the launch intro?" flag as shared, reactive
 * state so BOTH the (tabs) and (auth) layout gates and the intro screen agree
 * on it. Reading AsyncStorage per-component would let the (auth) gate keep a
 * stale `false` after the intro screen marks it seen and redirect straight back
 * to the intro — an infinite loop. A single provider avoids that.
 */
export function IntroProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [hasSeenIntro, setHasSeenIntro] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        if (active && saved === "1") setHasSeenIntro(true);
      } catch {
        // Best-effort: if storage is unavailable, default to showing the intro.
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const markIntroSeen = useCallback(() => {
    setHasSeenIntro(true);
    void AsyncStorage.setItem(STORAGE_KEY, "1").catch(() => {});
  }, []);

  const value = useMemo<IntroContextValue>(
    () => ({ ready, hasSeenIntro, markIntroSeen }),
    [ready, hasSeenIntro, markIntroSeen],
  );

  return <IntroContext.Provider value={value}>{children}</IntroContext.Provider>;
}

export function useIntro(): IntroContextValue {
  const ctx = useContext(IntroContext);
  if (!ctx) throw new Error("useIntro must be used within an IntroProvider");
  return ctx;
}
